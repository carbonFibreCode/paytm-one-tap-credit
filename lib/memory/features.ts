/**
 * Feature extraction — the "warm information" layer.
 *
 * Takes a raw transaction ledger and derives the behavioural signals the
 * decision engine runs on. Salary and recurring obligations are *detected* from
 * the rows by looking for repetition, not read off a config — so the UI can show
 * a judge the ledger, the detection, and the resulting score as one chain.
 */

import type {
  BehaviouralFeatures,
  LedgerEntry,
  MerchantCategory,
  RecurringObligation,
} from '../types';
import { dayOfMonth, daysBetween, monthKey } from '../dates';

/** Repayment record lives with the lender, not in the payment ledger. */
export interface CreditRecord {
  priorRepayments: number;
  latePayments: number;
}

/** Discretionary categories — the ones a credit nudge could plausibly apply to. */
const DISCRETIONARY: MerchantCategory[] = [
  'electronics',
  'travel',
  'jewellery',
  'apparel',
  'healthcare',
];

/** A charge must repeat across at least this many months to count as recurring. */
const RECURRENCE_THRESHOLD = 3;

/** Regulatory convention: cap total EMI load at 40% of disposable income. */
export const FOIR_CAP = 0.4;

const BIG_TICKET_FLOOR = 10_000;

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Find salary-like credits: repeated inflows of a similar amount arriving in
 * most months. Returns the monthly average and how predictable the date is.
 */
export function detectSalary(entries: LedgerEntry[]): {
  avgMonthlyInflow: number;
  inflowRegularity: number;
  salaryEntries: LedgerEntry[];
} {
  const credits = entries.filter((entry) => entry.direction === 'credit');
  if (credits.length === 0) {
    return { avgMonthlyInflow: 0, inflowRegularity: 0, salaryEntries: [] };
  }

  // Anchor on the median credit, then keep everything clustered around it.
  const sorted = [...credits].sort((a, b) => a.amount - b.amount);
  const median = sorted[Math.floor(sorted.length / 2)].amount;
  const salaryEntries = credits.filter(
    (entry) => Math.abs(entry.amount - median) <= median * 0.15,
  );

  const months = new Set(salaryEntries.map((entry) => monthKey(entry.date)));
  if (salaryEntries.length === 0 || months.size < RECURRENCE_THRESHOLD) {
    // Not enough repetition to call it income.
    return { avgMonthlyInflow: 0, inflowRegularity: 0, salaryEntries: [] };
  }

  const avgMonthlyInflow = Math.round(sum(salaryEntries.map((e) => e.amount)) / months.size);

  // Predictability of payday: a drift of ~10 days or more reads as irregular.
  const daySpread = stdDev(salaryEntries.map((entry) => dayOfMonth(entry.date)));
  const inflowRegularity = clamp(1 - daySpread / 10);

  return { avgMonthlyInflow, inflowRegularity, salaryEntries };
}

/**
 * Detect recurring obligations: the same merchant charging the same amount
 * across three or more distinct months.
 */
export function detectRecurringObligations(entries: LedgerEntry[]): RecurringObligation[] {
  const groups = new Map<string, { entry: LedgerEntry; months: Set<string> }>();

  for (const entry of entries) {
    if (entry.direction !== 'debit') continue;
    const key = `${entry.merchant}|${entry.amount}`;
    const group = groups.get(key);
    if (group) {
      group.months.add(monthKey(entry.date));
    } else {
      groups.set(key, { entry, months: new Set([monthKey(entry.date)]) });
    }
  }

  return [...groups.values()]
    .filter((group) => group.months.size >= RECURRENCE_THRESHOLD)
    .map((group) => ({
      merchant: group.entry.merchant,
      amount: group.entry.amount,
      category: group.entry.category,
      occurrences: group.months.size,
    }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Roll a ledger up into the feature vector the engine consumes.
 *
 * `liveObligations` are credit accounts this system itself opened — too new to
 * show up as three months of repeated charges, but every bit as real. They join
 * the detected ones so a loan taken a minute ago tightens the next check.
 */
export function computeFeatures(
  entries: LedgerEntry[],
  asOf: string,
  creditRecord: CreditRecord,
  liveObligations: RecurringObligation[] = [],
): BehaviouralFeatures {
  const asOfDate = asOf.slice(0, 10);
  const debits = entries.filter((entry) => entry.direction === 'debit');
  const months = [...new Set(entries.map((entry) => monthKey(entry.date)))].sort();
  const monthsObserved = months.length;

  const accountAgeDays = entries.length === 0 ? 0 : daysBetween(entries[0].date, asOfDate);

  const { avgMonthlyInflow, inflowRegularity } = detectSalary(entries);
  const detectedObligations = [
    ...detectRecurringObligations(entries),
    ...liveObligations.map((obligation) => ({ ...obligation, source: 'account' as const })),
  ];

  const existingEmiOutflow = sum(
    detectedObligations.filter((o) => o.category === 'emi').map((o) => o.amount),
  );
  const fixedMonthlyOutflow = sum(detectedObligations.map((o) => o.amount));

  // Monthly spend totals, used for both the average and its volatility.
  const spendByMonth = new Map<string, number>();
  for (const entry of debits) {
    const key = monthKey(entry.date);
    spendByMonth.set(key, (spendByMonth.get(key) ?? 0) + entry.amount);
  }
  const monthlyTotals = months.map((month) => spendByMonth.get(month) ?? 0);
  const avgMonthlySpend = Math.round(mean(monthlyTotals));
  const spendVolatility =
    avgMonthlySpend === 0 ? 0 : clamp(stdDev(monthlyTotals) / avgMonthlySpend);

  // Trend: most recent three months against the three before them. The month
  // containing `asOf` is still in progress, so including it would read as a
  // spending collapse — drop it.
  const completeMonths =
    months.length > 0 && months[months.length - 1] === monthKey(asOfDate)
      ? monthlyTotals.slice(0, -1)
      : monthlyTotals;
  const recentThree = sum(completeMonths.slice(-3));
  const priorThree = sum(completeMonths.slice(-6, -3));
  const spendTrend = priorThree === 0 ? 1 : recentThree / priorThree;

  // Category affinity across discretionary spend only.
  const discretionaryDebits = debits.filter((entry) =>
    DISCRETIONARY.includes(entry.category as MerchantCategory),
  );
  const discretionaryTotal = sum(discretionaryDebits.map((entry) => entry.amount));
  const categoryAffinity: Partial<Record<MerchantCategory, number>> = {};
  if (discretionaryTotal > 0) {
    for (const category of DISCRETIONARY) {
      const categoryTotal = sum(
        discretionaryDebits.filter((entry) => entry.category === category).map((e) => e.amount),
      );
      if (categoryTotal > 0) {
        categoryAffinity[category] = categoryTotal / discretionaryTotal;
      }
    }
  }

  // Big-ticket *purchases* only. Rent and loan instalments clear ₹10,000 every
  // month without being discretionary buys, so recurring charges are excluded.
  const recurringKeys = new Set(
    detectedObligations.map((obligation) => `${obligation.merchant}|${obligation.amount}`),
  );
  const bigTicketCount6m = discretionaryDebits.filter(
    (entry) =>
      entry.amount >= BIG_TICKET_FLOOR &&
      daysBetween(entry.date, asOfDate) <= 180 &&
      !recurringKeys.has(`${entry.merchant}|${entry.amount}`),
  ).length;

  const onTimeRepaymentRate =
    creditRecord.priorRepayments === 0
      ? 0
      : clamp((creditRecord.priorRepayments - creditRecord.latePayments) / creditRecord.priorRepayments);

  const disposableMonthly = Math.max(0, avgMonthlyInflow - fixedMonthlyOutflow);
  const affordabilityCapacity = Math.round(disposableMonthly * FOIR_CAP);

  return {
    accountAgeDays,
    txnCount: entries.length,
    monthsObserved,
    avgMonthlyInflow,
    inflowRegularity,
    avgMonthlySpend,
    spendVolatility,
    spendTrend,
    fixedMonthlyOutflow,
    existingEmiOutflow,
    detectedObligations,
    categoryAffinity,
    bigTicketCount6m,
    priorCreditRepayments: creditRecord.priorRepayments,
    onTimeRepaymentRate,
    disposableMonthly,
    affordabilityCapacity,
  };
}
