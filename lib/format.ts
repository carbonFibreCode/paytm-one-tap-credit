/** Display helpers shared by the engine and the UI. */

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

/** Turn a GateId into something a person would say. */
export function humaniseGate(id: string): string {
  return id
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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
