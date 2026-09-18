process.env.QR_SIGNING_SECRET = 'test-signing-secret';

import { describe, expect, test } from 'vitest';
import { signIntent, verifyIntent } from '../lib/intents/sign';
import { intentState, staticRef, dynamicRef } from '../lib/intents/store';
import { getMerchant, MERCHANTS } from '../lib/fixtures/merchants';
import { buildUpiPayload, parseUpiPayload, unsignedPortion } from '../lib/upi';

const kroma = getMerchant('m_kroma')!;

function signed(amount?: number, ref = 'OTCDKROMA0123456789') {
  const unsigned = buildUpiPayload(kroma, amount, { tr: ref });
  return buildUpiPayload(kroma, amount, { tr: ref, sign: signIntent(unsigned) });
}

describe('signed payment intents', () => {
  test('a payload we issued verifies, and parses to its merchant, amount and reference', () => {
    const payload = signed(50_000);
    expect(verifyIntent(payload)).toBe(true);
    const scanned = parseUpiPayload(payload)!;
    expect(scanned.merchantId).toBe('m_kroma');
    expect(scanned.amount).toBe(50_000);
    expect(scanned.tr).toBe('OTCDKROMA0123456789');
    expect(scanned.sign).toBeTruthy();
  });

  test('the signature is the last parameter and covers everything before it', () => {
    const payload = signed(50_000);
    const { unsigned, sign } = unsignedPortion(payload);
    expect(payload).toBe(`${unsigned}&sign=${sign}`);
    expect(signIntent(unsigned)).toBe(sign);
  });

  test('changing the amount breaks the signature', () => {
    expect(verifyIntent(signed(50_000).replace('am=50000', 'am=5000'))).toBe(false);
  });

  test('swapping the payee VPA — the sticker fraud — breaks the signature', () => {
    expect(verifyIntent(signed(50_000).replace('kroma%40ptaxis', 'stranger%40okaxis'))).toBe(false);
  });

  test('a payload with no signature never verifies', () => {
    expect(verifyIntent(buildUpiPayload(kroma, 50_000, { tr: 'OTCDKROMA0123456789' }))).toBe(false);
    expect(verifyIntent(buildUpiPayload(kroma, 50_000))).toBe(false);
  });

  test('a signature from a different key is rejected', () => {
    const forged = `${unsignedPortion(signed(50_000)).unsigned}&sign=${'A'.repeat(43)}`;
    expect(verifyIntent(forged)).toBe(false);
  });

  test('unsigned merchant labels still parse, so the offline fallback keeps working', () => {
    const scanned = parseUpiPayload(buildUpiPayload(kroma, 50_000))!;
    expect(scanned.merchantId).toBe('m_kroma');
    expect(scanned.tr).toBeUndefined();
  });
});

describe('intent references', () => {
  test('static references are stable per merchant and unique across merchants', () => {
    expect(staticRef(kroma)).toBe('OTCSKROMA');
    expect(staticRef(kroma)).toBe(staticRef(kroma));
    expect(new Set(MERCHANTS.map(staticRef)).size).toBe(MERCHANTS.length);
  });

  test('dynamic references are unique per bill and UPI-safe', () => {
    const a = dynamicRef(kroma);
    const b = dynamicRef(kroma);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^OTCDKROMA[0-9A-F]{10}$/);
    expect(a.length).toBeLessThanOrEqual(35);
  });
});

describe('intent lifecycle', () => {
  const now = '2026-09-19T14:30:00.000Z';

  test('a static code is never expired', () => {
    expect(intentState({ status: 'created', expiresAt: null }, now)).toBe('created');
    expect(intentState({ status: 'scanned', expiresAt: null }, now)).toBe('scanned');
  });

  test('a dynamic code expires on the clock, whatever its stored status says', () => {
    expect(
      intentState({ status: 'created', expiresAt: new Date('2026-09-19T14:45:00.000Z') }, now),
    ).toBe('created');
    expect(
      intentState({ status: 'created', expiresAt: new Date('2026-09-19T14:30:00.000Z') }, now),
    ).toBe('expired');
    expect(
      intentState({ status: 'scanned', expiresAt: new Date('2026-09-19T14:00:00.000Z') }, now),
    ).toBe('expired');
  });

  test('paid is terminal — expiry cannot undo it', () => {
    expect(
      intentState({ status: 'paid', expiresAt: new Date('2026-09-19T14:00:00.000Z') }, now),
    ).toBe('paid');
  });
});
