/**
 * Synthetic transaction history.
 *
 * This stands in for the payment history Paytm already holds. It is generated
 * from a seeded PRNG so a given persona always produces byte-identical output —
 * the demo can never drift between runs, and a judge poking at it sees the same
 * numbers we do.
 *
 * Nothing downstream reads {@link PersonaSpec}. The spec shapes the ledger, and
 * every behavioural feature is then re-derived from the ledger rows alone.
 */

import type { Instrument, Language, LedgerEntry, MerchantCategory } from '../types';
import { addDays, addMonths, daysInMonth, toISODate, parseDate } from '../dates';

// --- deterministic randomness ---------------------------------------------

/** FNV-1a, used to turn a userId into a stable numeric seed. */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast, and stable across Node and the browser. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- persona definition ----------------------------------------------------

export interface PersonaEmiSpec {
  merchant: string;
  amount: number;
}

export interface BigTicketSpec {
  monthsAgo: number;
  category: MerchantCategory;
  amount: number;
}

export interface PersonaSpec {
  userId: string;
  displayName: string;
  preferredLanguage: Language;
  /** How far back the history runs. Short histories trigger the cold-start gate. */
  accountAgeDays: number;

  monthlySalary: number;
  /** Nominal payday, 1-28. */
  salaryDay: number;
  /** Days of drift around payday. Higher drift lowers detected inflow regularity. */
  salaryJitter: number;
  /**
   * Fractional swing in the credited amount, 0..1. Salaried users sit near 0;
   * gig workers with lumpy income sit high, which makes the inflow harder to
   * detect as income at all.
   */
  salaryVariance: number;

  rent: number;
  emis: PersonaEmiSpec[];

  monthlyDiscretionary: number;
  /** Relative weights per category; normalised internally. */
  discretionaryMix: Partial<Record<MerchantCategory, number>>;
  monthlyEssentials: number;

  /** 0..1 — month-to-month swing in spend. */
  volatility: number;
  /** Multiplicative drift per month, e.g. 1.04 = spending creeping up 4%/month. */
  spendGrowth: number;

  bigTickets: BigTicketSpec[];

  /** Prior Postpaid/card cycles closed, and how many were paid late. */
  priorCreditRepayments: number;
  latePayments: number;
}

// --- merchant pools --------------------------------------------------------

const MERCHANTS: Record<MerchantCategory, string[]> = {
  electronics: ['Kroma Electronics', 'Vijay Sales', 'Boat Lifestyle'],
  travel: ['MakeMyTrip', 'IRCTC', 'IndiGo'],
  jewellery: ['Reliance Jewels', 'Tanishq'],
  apparel: ['Myntra', 'Westside', 'Decathlon'],
  healthcare: ['Apollo Pharmacy', 'PharmEasy', '1mg'],
  grocery: ['BigBazaar', 'BigBasket', 'DMart'],
  fuel: ['Indian Oil', 'HP Petrol Pump'],
  bills: ['Airtel Postpaid', 'BSES Rajdhani', 'Tata Play'],
  p2p: ['Rahul Sharma', 'Neha Gupta'],
  wallet_load: ['Paytm Wallet'],
  gambling: ['Dream11'],
  crypto: ['CoinSwitch'],
};

const ESSENTIAL_CATEGORIES: MerchantCategory[] = ['grocery', 'fuel', 'bills'];

function instrumentFor(category: MerchantCategory): Instrument {
  if (category === 'bills') return 'netbanking';
  if (category === 'electronics' || category === 'jewellery') return 'debit_card';
  return 'upi';
}

/** Round to the nearest rupee, never below a floor. */
function money(value: number, floor = 1): number {
  return Math.max(floor, Math.round(value));
}

// --- generation ------------------------------------------------------------

/**
 * Build a persona's ledger ending at `asOf`, covering `accountAgeDays` of history.
 *
 * Rows come out sorted oldest-first.
 */
export function generateLedger(spec: PersonaSpec, asOf: string): LedgerEntry[] {
  const random = mulberry32(hashSeed(spec.userId));
  const entries: LedgerEntry[] = [];
  let sequence = 0;

  const asOfDate = asOf.slice(0, 10);
  const startDate = addDays(asOfDate, -spec.accountAgeDays);

  const push = (
    date: string,
    direction: LedgerEntry['direction'],
    amount: number,
    category: LedgerEntry['category'],
    merchant: string,
    instrument: Instrument,
  ) => {
    // Clip to the observable window — a user has no history before they joined.
    if (date < startDate || date > asOfDate) return;
    entries.push({
      id: `${spec.userId}_${String(sequence++).padStart(4, '0')}`,
      date,
      direction,
      amount: money(amount),
      category,
      merchant,
      instrument,
    });
  };

  // Walk month by month from the month containing `startDate` up to `asOf`.
  const monthCount =
    Math.ceil(spec.accountAgeDays / 30) + 1;
  const firstOfWindow = toISODate(
    new Date(Date.UTC(parseDate(startDate).getUTCFullYear(), parseDate(startDate).getUTCMonth(), 1)),
  );

  const normalisedMix = normaliseMix(spec.discretionaryMix);

  for (let monthIndex = 0; monthIndex <= monthCount; monthIndex++) {
    const monthStart = addMonths(firstOfWindow, monthIndex);
    const lastDay = daysInMonth(monthStart);

    // Spending drifts over time and wobbles month to month.
    const monthsFromEnd = monthCount - monthIndex;
    const trend = Math.pow(spec.spendGrowth, -monthsFromEnd);
    const wobble = 1 + (random() - 0.5) * 2 * spec.volatility;
    const monthFactor = trend * wobble;

    // Salary — the anchor the feature extractor looks for.
    if (spec.monthlySalary > 0) {
      const jitter = Math.round((random() - 0.5) * 2 * spec.salaryJitter);
      const day = Math.min(lastDay, Math.max(1, spec.salaryDay + jitter));
      const swing = 1 + (random() - 0.5) * 2 * spec.salaryVariance;
      push(
        setDay(monthStart, day),
        'credit',
        spec.monthlySalary * swing,
        'salary',
        spec.salaryVariance > 0.2 ? 'Client Payout' : 'Salary Credit',
        'netbanking',
      );
    }

    // Fixed obligations — identical merchant and amount every month, which is
    // exactly the signature the recurrence detector keys on.
    if (spec.rent > 0) {
      push(setDay(monthStart, Math.min(lastDay, 5)), 'debit', spec.rent, 'rent', 'House Rent', 'netbanking');
    }
    for (const emi of spec.emis) {
      push(setDay(monthStart, Math.min(lastDay, 7)), 'debit', emi.amount, 'emi', emi.merchant, 'netbanking');
    }

    // Essentials — a handful of small, unremarkable payments.
    const essentialTotal = spec.monthlyEssentials * monthFactor;
    const essentialCount = 6;
    for (let i = 0; i < essentialCount; i++) {
      const category = ESSENTIAL_CATEGORIES[i % ESSENTIAL_CATEGORIES.length];
      const share = (0.7 + random() * 0.6) / essentialCount;
      const day = Math.min(lastDay, 2 + Math.floor(random() * (lastDay - 3)));
      push(
        setDay(monthStart, day),
        'debit',
        essentialTotal * share,
        category,
        pick(MERCHANTS[category], random),
        instrumentFor(category),
      );
    }

    // Discretionary — split across the persona's category mix.
    const discretionaryTotal = spec.monthlyDiscretionary * monthFactor;
    for (const [category, weight] of normalisedMix) {
      const categoryTotal = discretionaryTotal * weight;
      if (categoryTotal < 200) continue;
      const txnCount = categoryTotal > 6000 ? 2 : 1;
      for (let i = 0; i < txnCount; i++) {
        const day = Math.min(lastDay, 2 + Math.floor(random() * (lastDay - 3)));
        push(
          setDay(monthStart, day),
          'debit',
          categoryTotal / txnCount,
          category,
          pick(MERCHANTS[category], random),
          instrumentFor(category),
        );
      }
    }
  }

  // Big-ticket purchases, placed relative to `asOf`.
  for (const bigTicket of spec.bigTickets) {
    const date = addMonths(asOfDate, -bigTicket.monthsAgo);
    push(
      date,
      'debit',
      bigTicket.amount,
      bigTicket.category,
      pick(MERCHANTS[bigTicket.category], random),
      instrumentFor(bigTicket.category),
    );
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  return entries;
}

function setDay(monthStart: string, day: number): string {
  return `${monthStart.slice(0, 7)}-${String(day).padStart(2, '0')}`;
}

function pick<T>(pool: T[], random: () => number): T {
  return pool[Math.floor(random() * pool.length) % pool.length];
}

function normaliseMix(
  mix: Partial<Record<MerchantCategory, number>>,
): Array<[MerchantCategory, number]> {
  const pairs = Object.entries(mix) as Array<[MerchantCategory, number]>;
  const total = pairs.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return [];
  return pairs.map(([category, weight]) => [category, weight / total]);
}
