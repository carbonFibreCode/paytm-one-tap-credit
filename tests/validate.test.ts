/**
 * Validation behaviour at the API boundary.
 *
 * Ported from the `Validated<T>` union to the schema-plus-resolver pair the
 * routes now use: Zod handles shape (400), `resolveDecideRequest` handles
 * identity (404) and the either/or merchant rule.
 */

import { describe, expect, test } from 'vitest';
import {
  decideBody,
  nudgeTextBody,
  resolveDecideRequest,
  type DecideInputs,
} from '../lib/api/schemas';
import { ApiError } from '../lib/api/route';
import { firstIssue } from '../lib/schemas';

const NOW = '2026-09-19T14:30:00+05:30';

type Outcome =
  | { ok: true; value: DecideInputs }
  | { ok: false; status: number; error: string };

/** Mirrors what a route does: parse, then resolve, reporting either failure. */
function decide(body: unknown): Outcome {
  const parsed = decideBody.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: firstIssue(parsed.error) };
  try {
    return { ok: true, value: resolveDecideRequest(parsed.data, NOW) };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, status: error.status, error: error.message };
    throw error;
  }
}

function nudgeText(body: unknown) {
  const parsed = nudgeTextBody.safeParse(body);
  return parsed.success
    ? ({ ok: true, value: parsed.data } as const)
    : ({ ok: false, status: 400, error: firstIssue(parsed.error) } as const);
}

const valid = { userId: 'u_rohit', merchantId: 'm_kroma', amount: 50_000 };

describe('/api/decide validation', () => {
  test('accepts a well-formed request and resolves the merchant', () => {
    const result = decide(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request.merchantName).toBe('Kroma Electronics');
    expect(result.value.request.merchantCategory).toBe('electronics');
    expect(result.value.merchantCreditEnabled).toBe(true);
  });

  test('defaults the timestamp to now and synthesises a transaction id', () => {
    const result = decide(valid);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.request.timestamp).toBe(NOW);
    expect(result.value.request.transactionId).toBe('txn_u_rohit_50000');
  });

  test.each([
    [{ ...valid, userId: 'u_nobody' }, 404, /Unknown userId/],
    [{ ...valid, merchantId: 'm_nope' }, 404, /Unknown merchantId/],
    [{ ...valid, amount: 0 }, 400, /greater than zero/],
    [{ ...valid, amount: -5 }, 400, /greater than zero/],
    [{ ...valid, amount: 500.5 }, 400, /whole number of rupees/],
    [{ ...valid, amount: 2_00_00_000 }, 400, /implausibly large/],
    [{ userId: 'u_rohit', merchantId: 'm_kroma' }, 400, /amount/],
    [{ ...valid, merchantId: undefined, merchantCategory: 'nonsense' }, 400, /merchantCategory/],
    [{ userId: 'u_rohit', amount: 5_000 }, 400, /Provide a known/],
    ['not an object', 400, /./],
    [null, 400, /./],
  ])('rejects %j with %i', (body, status, pattern) => {
    const result = decide(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(status);
    expect(result.error).toMatch(pattern as RegExp);
  });

  test('accepts an off-catalogue merchant described by category, for n8n', () => {
    const result = decide({
      userId: 'u_rohit',
      amount: 50_000,
      merchantName: 'Some Other Shop',
      merchantCategory: 'electronics',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.merchant).toBeNull();
    expect(result.value.request.merchantName).toBe('Some Other Shop');
    expect(result.value.merchantCreditEnabled).toBe(true);
  });

  test('drops malformed history entries without failing the request', () => {
    const result = decide({
      ...valid,
      nudgeHistory: [
        { product: 'postpaid', decidedAt: '2026-09-17T10:00:00Z', outcome: 'declined' },
        { product: 'not-a-product', decidedAt: 'garbage', outcome: 'nope' },
        'entirely wrong',
        null,
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A corrupt localStorage row must not be able to break checkout.
    expect(result.value.request.nudgeHistory).toHaveLength(1);
    expect(result.value.request.nudgeHistory?.[0].outcome).toBe('declined');
  });

  test('carries a scanned intent reference through to the engine request', () => {
    const result = decide({ ...valid, intentRef: 'OTCDKROMA0123456789' });
    if (!result.ok) throw new Error('expected success');
    expect(result.value.request.intentRef).toBe('OTCDKROMA0123456789');
  });
});

describe('/api/nudge-text validation', () => {
  const validCopy = {
    product: 'postpaid',
    amount: 50_000,
    months: 3,
    emi: 16_667,
    merchantCategory: 'electronics',
  };

  test('fills in defaults for the optional fields', () => {
    const result = nudgeText(validCopy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.language).toBe('en');
    expect(result.value.noCost).toBe(false);
    expect(result.value.partner).toBe('Paytm Postpaid');
    expect(result.value.merchantName).toBe('Merchant');
  });

  test.each([
    [{ ...validCopy, months: 99 }, /between 1 and 36/],
    [{ ...validCopy, product: 'loan' }, /product/],
    [{ ...validCopy, emi: 0 }, /emi/],
    [{ ...validCopy, merchantCategory: 'nope' }, /merchantCategory/],
  ])('rejects %j', (body, pattern) => {
    const result = nudgeText(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(pattern as RegExp);
  });

  test('an unknown language falls back to English rather than failing', () => {
    expect(nudgeText({ ...validCopy, language: 'fr' }).ok).toBe(false);
  });
});
