/** Display helpers shared by the engine and the UI. */

import type { GateId } from './types';

export { formatShortDate } from './dates';

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function formatINR(value: number): string {
  return INR.format(Math.round(value));
}

/** `50,000` — when the ₹ symbol is rendered separately. */
export function formatAmount(value: number): string {
  return Math.round(value).toLocaleString('en-IN');
}

/**
 * What each gate is called, and why it blocked.
 *
 * Two forms because the UI needs two: a short `label` for the checklist in the
 * trace, and a `reason` written to follow "No nudge \u00b7 " \u2014 so it stays
 * lowercase, unpunctuated, and free of the engine's own vocabulary. Title-casing
 * the enum was fine for us and meaningless to everyone else: nobody outside this
 * repo knows what "Cold Start" is.
 */
const GATE_COPY: Record<GateId, { label: string; reason: string }> = {
  CATEGORY_PROHIBITED: {
    label: 'Category',
    reason: 'credit can never be offered on this kind of payment',
  },
  MERCHANT_NOT_ENABLED: {
    label: 'Merchant support',
    reason: 'this merchant is outside the credit-accepting network',
  },
  AMOUNT_FLOOR: {
    label: 'Amount floor',
    reason: 'the amount is too small to be worth an instalment plan',
  },
  AMOUNT_CEILING: {
    label: 'Amount ceiling',
    reason: 'the amount is beyond what any of these products can fund',
  },
  CATEGORY_RELEVANCE: {
    label: 'Category fit',
    reason: 'an everyday purchase, where an offer interrupts rather than helps',
  },
  OPTED_OUT: {
    label: 'Opt-out',
    reason: 'this user has opted out of credit offers',
  },
  COLD_START: {
    label: 'Account history',
    reason: 'too little account history yet to judge fairly',
  },
  NOT_ELIGIBLE: {
    label: 'Eligibility',
    reason: 'the eligibility signal sits below the threshold',
  },
  BANK_COOLOFF: {
    label: 'Bank cool-off',
    reason: 'the partner bank turned down an application recently',
  },
  FREQUENCY_CAP: {
    label: 'Frequency cap',
    reason: 'this user has already seen an offer recently',
  },
  NO_PRODUCT: {
    label: 'Available product',
    reason: 'no credit product is open to this user',
  },
  ALREADY_ACTIVE: {
    label: 'Existing plan',
    reason: 'this payment is already going on a credit product',
  },
  INSUFFICIENT_LIMIT: {
    label: 'Available limit',
    reason: 'the limit left cannot cover this payment in full',
  },
  AFFORDABILITY: {
    label: 'Affordability',
    reason: 'even the smallest instalment is more than this user can carry',
  },
  SCORE_THRESHOLD: {
    label: 'Relevance score',
    reason: 'every check passed, but the moment scored too low to interrupt',
  },
};

/** Falls back to title case so an unmapped id degrades instead of blanking. */
function titleCase(id: string): string {
  return id
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Short name for a gate \u2014 for checklists and pills. */
export function gateLabel(id: string): string {
  return GATE_COPY[id as GateId]?.label ?? titleCase(id);
}

/** Why it blocked, phrased to sit after "No nudge \u00b7 " or "because". */
export function gateReason(id: string): string {
  return GATE_COPY[id as GateId]?.reason ?? titleCase(id).toLowerCase();
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function underThousand(value: number): string {
  if (value === 0) return '';
  if (value < 20) return ONES[value];
  if (value < 100) {
    return `${TENS[Math.floor(value / 10)]}${value % 10 ? ` ${ONES[value % 10]}` : ''}`;
  }
  return `${ONES[Math.floor(value / 100)]} Hundred${
    value % 100 ? ` ${underThousand(value % 100)}` : ''
  }`;
}

/**
 * `50000` → `Rupees Fifty Thousand Only`.
 *
 * Indian grouping — crore, lakh, thousand — which is what a payment screen in
 * India shows under the amount.
 */
export function amountInWords(value: number): string {
  const amount = Math.floor(Math.abs(value));
  if (amount === 0) return '';

  const parts: string[] = [];
  const crore = Math.floor(amount / 1_00_00_000);
  const lakh = Math.floor((amount % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((amount % 1_00_000) / 1_000);
  const rest = amount % 1_000;

  if (crore) parts.push(`${underThousand(crore)} Crore`);
  if (lakh) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
  if (rest) parts.push(underThousand(rest));

  return `Rupees ${parts.join(' ')} Only`;
}
