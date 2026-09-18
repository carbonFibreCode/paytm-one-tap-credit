/**
 * EMI schedules.
 *
 * Two rounding regimes, because they behave differently:
 *
 * - **No-cost EMI** (merchant-subsidised): the instalments must add up to the
 *   principal *exactly*. ₹50,000 over 3 months is not a round number, so the
 *   early instalments round up and the last one absorbs what is left —
 *   16,667 + 16,667 + 16,666 = 50,000. Rounding up rather than down matters:
 *   it guarantees the final payment is never the largest one.
 * - **Interest-bearing**: standard reducing-balance EMI, equal instalments, with
 *   the interest stated as the difference from the principal.
 */

import type { EmiOption, MerchantCategory, ProductId } from '../types';
import { addMonths } from '../dates';

/** Annual rate charged when the tenure is not merchant-subsidised. */
const POSTPAID_APR = 0.16;
const CARD_APR = 0.15;

/** Categories where merchants routinely fund a no-cost 3-month option. */
const NO_COST_CATEGORIES: MerchantCategory[] = ['electronics', 'travel', 'apparel'];

/** Below this, an instalment plan is not worth offering. */
const MIN_SENSIBLE_EMI = 500;

const TENURES: Record<ProductId, number[]> = {
  postpaid: [3, 6],
  card: [3, 6, 9, 12],
};

function aprFor(product: ProductId): number {
  return product === 'postpaid' ? POSTPAID_APR : CARD_APR;
}

/** Reducing-balance instalment: E = P·r·(1+r)ⁿ / ((1+r)ⁿ − 1). */
function reducingBalanceEmi(principal: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0) return principal / months;
  const growth = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * growth) / (growth - 1);
}

function buildOption(
  principal: number,
  months: number,
  noCost: boolean,
  apr: number,
  firstDueDate: string,
): EmiOption {
  if (noCost) {
    // Instalments must sum to the principal exactly. Rounding the early ones up
    // leaves the remainder — always the smaller amount — on the final payment.
    const base = Math.ceil(principal / months);
    const lastEmi = principal - base * (months - 1);
    return {
      months,
      emi: base,
      lastEmi,
      total: principal,
      interest: 0,
      noCost: true,
      firstDueDate,
    };
  }

  const exact = reducingBalanceEmi(principal, apr / 12, months);
  const emi = Math.round(exact);
  const total = emi * months;
  return {
    months,
    emi,
    lastEmi: emi,
    total,
    interest: total - principal,
    noCost: false,
    firstDueDate,
  };
}

/**
 * All instalment plans available for this purchase, cheapest instalment last.
 *
 * `asOf` is the transaction date; the first instalment falls due a month later.
 */
export function buildTenures(
  principal: number,
  product: ProductId,
  category: MerchantCategory,
  asOf: string,
): EmiOption[] {
  const firstDueDate = addMonths(asOf.slice(0, 10), 1);
  const apr = aprFor(product);
  const noCostEligible = NO_COST_CATEGORIES.includes(category);

  return TENURES[product]
    .map((months) => buildOption(principal, months, noCostEligible && months === 3, apr, firstDueDate))
    .filter((option) => option.emi >= MIN_SENSIBLE_EMI);
}

/**
 * The smallest monthly instalment this purchase could be reduced to — used by
 * the affordability gate, which should only decline if *no* plan fits.
 */
export function lowestInstalment(options: EmiOption[]): number {
  if (options.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...options.map((option) => option.emi));
}

/** Drop plans whose instalment exceeds what the user can responsibly carry. */
export function affordableTenures(options: EmiOption[], capacity: number): EmiOption[] {
  return options.filter((option) => option.emi <= capacity);
}

export interface ScheduleRow {
  /** 1-based position in the schedule. */
  index: number;
  /** ISO date the instalment falls due. */
  date: string;
  amount: number;
}

/**
 * Expand a plan into its dated instalments. The last row carries the rounding
 * remainder, so the rows always sum to `tenure.total` exactly.
 */
export function buildSchedule(tenure: EmiOption): ScheduleRow[] {
  return Array.from({ length: tenure.months }, (_, index) => ({
    index: index + 1,
    date: addMonths(tenure.firstDueDate, index),
    amount: index === tenure.months - 1 ? tenure.lastEmi : tenure.emi,
  }));
}
