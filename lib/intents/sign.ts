/**
 * Signed payment intents.
 *
 * UPI 2.0 lets the PSP sign a QR's parameters so the payer's app can refuse a
 * payload that has been altered — the classic fraud is a sticker with the
 * shop's name and a stranger's VPA. In production the signature is asymmetric,
 * with the PSP's public key registered at NPCI. Here the app is both issuer
 * and verifier, so an HMAC over the unsigned payload is the honest equivalent:
 * same property (a changed byte fails verification), one secret to manage.
 *
 * Server-only: this is the one place the secret is read.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { log } from '../log';
import { unsignedPortion } from '../upi';

const DEV_SECRET = 'one-tap-credit-development-signing-key';
let warned = false;

/** Read lazily so tests and scripts can set the variable before first use. */
function secret(): string {
  const configured = process.env.QR_SIGNING_SECRET ?? '';
  if (configured) return configured;
  if (!warned) {
    warned = true;
    log.warn({ event: 'signing.dev_key' }, 'QR_SIGNING_SECRET is not set — using the development key');
  }
  return DEV_SECRET;
}

export function signingConfigured(): boolean {
  return (process.env.QR_SIGNING_SECRET ?? '').length > 0;
}

/** Signature for a payload that does not yet carry `&sign=`. */
export function signIntent(unsignedPayload: string): string {
  return createHmac('sha256', secret()).update(unsignedPayload).digest('base64url');
}

/** True only when the payload carries a signature that matches its content. */
export function verifyIntent(payload: string): boolean {
  const { unsigned, sign } = unsignedPortion(payload);
  if (!sign) return false;
  const expected = Buffer.from(signIntent(unsigned));
  const given = Buffer.from(sign);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
