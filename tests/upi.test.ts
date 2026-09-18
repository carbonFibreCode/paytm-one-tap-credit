import { describe, expect, test } from 'vitest';
import { buildUpiPayload, parseUpiPayload, upiVpa } from '../lib/upi';
import { getMerchant, MERCHANTS } from '../lib/merchants';

describe('UPI QR payloads', () => {
  test('every merchant round-trips through its own QR', () => {
    for (const merchant of MERCHANTS) {
      const payload = buildUpiPayload(merchant, merchant.suggestedAmount);
      const scanned = parseUpiPayload(payload);
      expect(scanned).not.toBeNull();
      expect(scanned!.merchantId).toBe(merchant.id);
      expect(scanned!.amount).toBe(merchant.suggestedAmount);
    }
  });

  test('a payload without an amount leaves it unset', () => {
    const merchant = getMerchant('m_kroma')!;
    const scanned = parseUpiPayload(buildUpiPayload(merchant));
    expect(scanned!.merchantId).toBe('m_kroma');
    expect(scanned!.amount).toBeUndefined();
  });

  test('looks like a real merchant QR', () => {
    const payload = buildUpiPayload(getMerchant('m_kroma')!, 50_000);
    expect(payload.startsWith('upi://pay?')).toBe(true);
    expect(payload).toContain('pa=kroma%40ptaxis');
    expect(payload).toContain('cu=INR');
    expect(payload).toContain('mc=5732'); // electronics
  });

  test('matches on payee name when the note is missing', () => {
    const scanned = parseUpiPayload('upi://pay?pa=someone@okaxis&pn=Kroma%20Electronics&cu=INR');
    expect(scanned!.merchantId).toBe('m_kroma');
  });

  test('matches on the VPA when neither note nor name is ours', () => {
    const merchant = getMerchant('m_mmt')!;
    const scanned = parseUpiPayload(`upi://pay?pa=${upiVpa(merchant)}&pn=Unknown&cu=INR`);
    expect(scanned!.merchantId).toBe('m_mmt');
  });

  test('plain text falls back to a name or id match', () => {
    expect(parseUpiPayload('Pay Reliance Jewels')!.merchantId).toBe('m_jewels');
    expect(parseUpiPayload('m_apollo')!.merchantId).toBe('m_apollo');
  });

  test('an unrelated QR returns null rather than guessing', () => {
    expect(parseUpiPayload('https://example.com')).toBeNull();
    expect(parseUpiPayload('upi://pay?pa=stranger@okhdfc&pn=Some%20Shop&cu=INR')).toBeNull();
  });

  test('a junk amount is ignored rather than trusted', () => {
    const scanned = parseUpiPayload('upi://pay?pa=kroma@ptaxis&pn=Kroma&am=-5&tn=m_kroma');
    expect(scanned!.amount).toBeUndefined();
  });
});
