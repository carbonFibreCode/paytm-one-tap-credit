/**
 * UPI QR payloads.
 *
 * One definition of the format, shared by the page that *prints* the codes and
 * the scanner that *reads* them — so the two can never drift apart.
 *
 * The string is a standard UPI intent, the same shape a real Paytm merchant QR
 * carries:
 *
 *   upi://pay?pa=kroma@ptaxis&pn=Kroma Electronics&mc=5732&am=50000&cu=INR&tn=m_kroma
 *
 * `tn` (transaction note) carries our merchant id, which makes matching exact
 * rather than a fuzzy name comparison. A real QR from outside the demo has no
 * `tn`, so the parser falls back to matching on payee name or address.
 *
 * Two more parameters turn a QR from a merchant label into a *payment intent*,
 * the way NPCI's spec and every PSP's QR actually work:
 *
 *   tr    transaction reference — the intent's id, and the key that ties a
 *         scan to a decision to a payment
 *   sign  UPI 2.0 signed intent — a signature over everything before it, so a
 *         sticker with a swapped VPA fails verification instead of getting paid
 *
 * `sign` is always the last parameter: the signature covers the whole string
 * before `&sign=`. This module stays free of crypto so it can run in the
 * browser; signing and verifying live in `lib/intents/sign.ts`.
 */

import { MERCHANTS, type Merchant } from './merchants';

/** Merchant category codes, roughly following the ISO 18245 groupings. */
const CATEGORY_CODES: Record<string, string> = {
  electronics: '5732',
  travel: '4722',
  jewellery: '5944',
  apparel: '5651',
  healthcare: '5912',
  grocery: '5411',
  fuel: '5541',
  bills: '4900',
  p2p: '0000',
  wallet_load: '6540',
  gambling: '7995',
  crypto: '6051',
};

/** ISO 18245 code for the merchant's category — the `mc` parameter. */
export function merchantCategoryCode(merchant: Merchant): string {
  return CATEGORY_CODES[merchant.category] ?? '0000';
}

/** `Kroma Electronics` → `kroma` */
export function handleFor(merchant: Merchant): string {
  return merchant.name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '');
}

export function upiVpa(merchant: Merchant): string {
  return `${handleFor(merchant)}@ptaxis`;
}

export interface UpiPayloadOptions {
  /** Transaction reference — the payment intent this QR represents. */
  tr?: string;
  /** Signature over the rest of the payload. Appended last. */
  sign?: string;
}

export function buildUpiPayload(
  merchant: Merchant,
  amount?: number,
  options: UpiPayloadOptions = {},
): string {
  const params = new URLSearchParams({
    pa: upiVpa(merchant),
    pn: merchant.name,
    mc: merchantCategoryCode(merchant),
    cu: 'INR',
    tn: merchant.id,
  });
  if (amount && amount > 0) params.set('am', String(amount));
  if (options.tr) params.set('tr', options.tr);
  // Must be the final parameter — see the module comment.
  if (options.sign) params.set('sign', options.sign);
  return `upi://pay?${params.toString()}`;
}

/** Split a payload into the part a signature covers and the signature itself. */
export function unsignedPortion(payload: string): { unsigned: string; sign: string | null } {
  const marker = '&sign=';
  const at = payload.indexOf(marker);
  if (at === -1) return { unsigned: payload, sign: null };
  return { unsigned: payload.slice(0, at), sign: payload.slice(at + marker.length) };
}

export interface ScannedPayment {
  merchantId: string;
  /** Present only when the QR fixed an amount. */
  amount?: number;
  /** Present when the QR is a payment intent rather than a bare merchant label. */
  tr?: string;
  sign?: string;
}

/**
 * Read a scanned QR back into a merchant and, when present, an amount.
 *
 * Returns null rather than guessing when nothing matches — a scanner that
 * silently picks the wrong merchant is worse than one that says nothing.
 */
export function parseUpiPayload(raw: string): ScannedPayment | null {
  const text = raw.trim();

  let query = '';
  if (text.toLowerCase().startsWith('upi://')) {
    query = text.slice(text.indexOf('?') + 1);
  }

  if (query) {
    const params = new URLSearchParams(query);
    const note = params.get('tn') ?? '';
    const payee = params.get('pn') ?? '';
    const address = params.get('pa') ?? '';
    const rawAmount = Number(params.get('am'));
    const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? Math.round(rawAmount) : undefined;
    const tr = params.get('tr') ?? undefined;
    const sign = params.get('sign') ?? undefined;

    const matched =
      MERCHANTS.find((merchant) => merchant.id === note) ??
      MERCHANTS.find((merchant) => merchant.name.toLowerCase() === payee.toLowerCase()) ??
      MERCHANTS.find((merchant) => upiVpa(merchant) === address);

    if (matched) return { merchantId: matched.id, amount, tr, sign };
    return null;
  }

  // Not a UPI intent — fall back to a plain-text name or id.
  const lower = text.toLowerCase();
  const byName = MERCHANTS.find((merchant) => lower.includes(merchant.name.toLowerCase()));
  if (byName) return { merchantId: byName.id };
  const byId = MERCHANTS.find((merchant) => lower.includes(merchant.id));
  return byId ? { merchantId: byId.id } : null;
}
