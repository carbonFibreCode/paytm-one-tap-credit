/**
 * The orchestrated path (n8n calling the engine stage by stage) and the direct
 * path (`decide()` in one call) must produce the same offer for the same
 * inputs. This drives both on a grid of users, merchants, amounts and levels
 * of live credit and asserts identity — the test that would have caught the
 * stage carrying an older copy of the offer logic.
 */

import { describe, expect, test } from 'vitest';
import { POST as gatesStage } from '../app/api/engine/gates/route';
import { POST as offerStage } from '../app/api/engine/offer/route';
import { decide } from '../lib/engine/decide';
import { getPersona } from '../lib/fixtures/personas';
import { buildProfile } from '../lib/profile/build';
import { getMerchant, MERCHANTS } from '../lib/fixtures/merchants';
import type { LiveCredit, RecurringObligation } from '../lib/types';

const NOW = '2026-09-19T14:30:00+05:30';

const emi = (): RecurringObligation => ({
  merchant: 'Paytm Postpaid EMI',
  amount: 16_667,
  category: 'emi',
  occurrences: 0,
});

function post(
  handler: (request: Request, context: never) => Promise<Response>,
  body: unknown,
) {
  return handler(
    new Request('http://test/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    undefined as never,
  );
}

describe('offer parity between decide() and the n8n offer stage', () => {
  const grid: Array<[string, string, number, number]> = [];
  for (const userId of ['u_rohit', 'u_priya', 'u_meera', 'u_vikram', 'u_deepak']) {
    for (const merchant of MERCHANTS) {
      for (const amount of [12_000, 50_000, 80_000, 1_20_000]) {
        for (const plans of [0, 2, 3]) grid.push([userId, merchant.id, amount, plans]);
      }
    }
  }

  test.each(grid)('%s at %s for ₹%i with %i open plans', async (userId, merchantId, amount, plans) => {
    const persona = getPersona(userId)!;
    const merchant = getMerchant(merchantId)!;
    const live: LiveCredit = {
      obligations: Array.from({ length: plans }, emi),
      outstanding: { postpaid: 0, card: 0 },
    };
    const profile = buildProfile(persona, NOW, live);

    const direct = decide({
      request: {
        transactionId: 't',
        userId,
        amount,
        merchantId,
        merchantName: merchant.name,
        merchantCategory: merchant.category,
        timestamp: NOW,
        nudgeHistory: [],
      },
      profile,
      merchantCreditEnabled: merchant.creditEnabled,
    });

    // Stage 2 — gates — hands the offer stage its funding products.
    const gates = await (
      await post(gatesStage, { profile, amount, merchantId, timestamp: NOW, nudgeHistory: [] })
    ).json();
    expect(gates.passed).toBe(direct.blockedBy === null);
    if (!direct.showNudge) return;

    // Stage 4 — offer.
    const staged = await (
      await post(offerStage, {
        profile,
        amount,
        merchantCategory: merchant.category,
        timestamp: NOW,
        fundingProducts: gates.fundingProducts,
        eligibleProducts: gates.eligibleProducts,
      })
    ).json();

    expect(staged.product).toBe(direct.product);
    expect(staged.offer).toEqual(direct.offer);
    expect(staged.productRationale).toBe(direct.trace.productRationale);
    expect(staged.decline).toEqual(direct.decline);
    for (const tenure of staged.offer.tenures) {
      expect(tenure.emi).toBeLessThanOrEqual(profile.features.affordabilityCapacity);
    }
  });
});
