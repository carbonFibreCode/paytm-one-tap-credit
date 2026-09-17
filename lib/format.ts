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
