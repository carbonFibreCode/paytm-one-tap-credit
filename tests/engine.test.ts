import { describe, expect, test } from 'vitest';
import { decide } from '../lib/engine/decide';
import { buildTenures } from '../lib/engine/emi';
import { amountFit } from '../lib/engine/score';
import { getPersona } from '../lib/fixtures/personas';
import { buildProfile } from '../lib/profile/build';
import { getMerchant } from '../lib/fixtures/merchants';
import type { Decision, Instrument, NudgeHistoryEntry } from '../lib/types';
import { addDays } from '../lib/dates';

/** Fixed reference time — the engine never reads a clock, so tests are stable. */
const NOW = '2026-09-19T14:30:00+05:30';

function run(
  userId: string,
  merchantId: string,
  amount?: number,
  options: { instrument?: Instrument; nudgeHistory?: NudgeHistoryEntry[] } = {},
): Decision {
  const persona = getPersona(userId);
  const merchant = getMerchant(merchantId);
  if (!persona || !merchant) throw new Error(`bad fixture: ${userId} / ${merchantId}`);

  return decide({
    request: {
      transactionId: `txn_${userId}_${merchantId}`,
      userId,
      amount: amount ?? merchant.suggestedAmount,
      merchantId: merchant.id,
      merchantName: merchant.name,
      merchantCategory: merchant.category,
      timestamp: NOW,
      selectedInstrument: options.instrument,
      nudgeHistory: options.nudgeHistory,
    },
    profile: buildProfile(persona, NOW),
    merchantCreditEnabled: merchant.creditEnabled,
  });
}

describe('the happy path', () => {
  test('₹50,000 at an electronics merchant offers Postpaid, matching the pitch deck', () => {
    const decision = run('u_rohit', 'm_kroma', 50_000);

    expect(decision.showNudge).toBe(true);
    expect(decision.product).toBe('postpaid');
    expect(decision.blockedBy).toBeNull();
    expect(decision.score).toBeGreaterThanOrEqual(60);
    expect(decision.offer?.limit).toBe(1_00_000);

    // The deck's headline: 3 no-cost instalments.
    const threeMonth = decision.offer?.tenures.find((tenure) => tenure.months === 3);
    expect(threeMonth?.noCost).toBe(true);
    expect(threeMonth?.emi).toBe(16_667);
    expect(threeMonth?.lastEmi).toBe(16_666);
  });

  test('an accepted offer always carries an equally weighted decline', () => {
    const decision = run('u_rohit', 'm_kroma', 50_000);
    expect(decision.decline).toEqual({ label: 'No thanks, pay normally', suppressDays: 7 });
  });

  test('every offered tenure fits within assessed monthly capacity', () => {
    const decision = run('u_rohit', 'm_kroma', 50_000);
    const capacity = 27_348;
    for (const tenure of decision.offer!.tenures) {
      expect(tenure.emi).toBeLessThanOrEqual(capacity);
    }
  });
});

describe('product selection', () => {
  test('below the switch point Postpaid wins', () => {
    expect(run('u_rohit', 'm_kroma', 50_000).product).toBe('postpaid');
  });

  test('at or above the switch point the card wins, when both could fund it', () => {
    const decision = run('u_rohit', 'm_jewels', 80_000);
    expect(decision.product).toBe('card');
    expect(decision.trace.productRationale).toContain('75,000');
  });

  test('when Postpaid cannot cover the amount the card is chosen and the reason is stated', () => {
    const decision = run('u_rohit', 'm_mmt', 1_20_000);
    expect(decision.product).toBe('card');
    expect(decision.trace.productRationale).toMatch(/Postpaid has only ₹1,00,000 available/);
  });

  test('selection is deterministic', () => {
    expect(run('u_rohit', 'm_kroma', 50_000)).toEqual(run('u_rohit', 'm_kroma', 50_000));
  });
});

describe('hard gates — the engine declining to nudge', () => {
  test('AMOUNT_FLOOR: a ₹450 grocery run gets nothing', () => {
    const decision = run('u_rohit', 'm_bigbazaar', 450);
    expect(decision.showNudge).toBe(false);
    expect(decision.blockedBy).toBe('AMOUNT_FLOOR');
  });

  test('CATEGORY_RELEVANCE: groceries above the floor are still an everyday purchase', () => {
    const decision = run('u_rohit', 'm_bigbazaar', 5_000);
    expect(decision.blockedBy).toBe('CATEGORY_RELEVANCE');
  });

  test('AMOUNT_CEILING: beyond ₹2,00,000 nothing we distribute can fund it', () => {
    expect(run('u_rohit', 'm_kroma', 2_50_000).blockedBy).toBe('AMOUNT_CEILING');
  });

  test('CATEGORY_PROHIBITED: credit is never offered on a person-to-person transfer', () => {
    const decision = run('u_rohit', 'm_p2p', 35_000);
    expect(decision.blockedBy).toBe('CATEGORY_PROHIBITED');
    // Checked before anything else — nothing about the user can unlock it.
    expect(decision.trace.gates[0].id).toBe('CATEGORY_PROHIBITED');
    expect(decision.trace.counterfactual).toContain('No amount');
  });

  test('MERCHANT_NOT_ENABLED: merchants outside the credit network are skipped', () => {
    expect(run('u_rohit', 'm_kirana', 24_000).blockedBy).toBe('MERCHANT_NOT_ENABLED');
  });

  test('COLD_START: three weeks of history is not enough to score', () => {
    const decision = run('u_aman', 'm_kroma', 50_000);
    expect(decision.blockedBy).toBe('COLD_START');
    expect(decision.blockedReason).toMatch(/too little to judge/);
  });

  test('NOT_ELIGIBLE: a weak derived signal blocks the offer', () => {
    const decision = run('u_deepak', 'm_kroma', 20_000);
    expect(decision.blockedBy).toBe('NOT_ELIGIBLE');
    expect(decision.eligibilitySignal).toBeLessThan(60);
  });

  test('AFFORDABILITY: eligible on paper, declined because the instalment does not fit', () => {
    const decision = run('u_priya', 'm_kroma', 50_000);
    expect(decision.blockedBy).toBe('AFFORDABILITY');
    // She clears the eligibility bar — this is a responsible-lending decline.
    expect(decision.eligibilitySignal).toBeGreaterThanOrEqual(60);
    expect(decision.blockedReason).toMatch(/existing commitments/);
  });

  test('INSUFFICIENT_LIMIT: a partial offer would strand the payment', () => {
    const decision = run('u_meera', 'm_kroma', 50_000);
    expect(decision.blockedBy).toBe('INSUFFICIENT_LIMIT');
    expect(decision.blockedReason).toMatch(/₹18,000/);
  });

  test('ALREADY_ACTIVE: no nudge when the user is already paying with that product', () => {
    const decision = run('u_meera', 'm_kroma', 15_000, { instrument: 'postpaid' });
    expect(decision.blockedBy).toBe('ALREADY_ACTIVE');
  });

  test('BANK_COOLOFF: a rejected application is not re-pitched', () => {
    const decision = run('u_vikram', 'm_kroma', 30_000);
    expect(decision.blockedBy).toBe('BANK_COOLOFF');
    expect(decision.blockedReason).toMatch(/18 days of cooling-off remain/);
  });
});

describe('frequency capping', () => {
  const declinedRecently: NudgeHistoryEntry[] = [
    { product: 'postpaid', decidedAt: addDays(NOW.slice(0, 10), -2), outcome: 'declined' },
  ];

  test('a decline is respected for seven days', () => {
    const decision = run('u_rohit', 'm_kroma', 50_000, { nudgeHistory: declinedRecently });
    expect(decision.blockedBy).toBe('FREQUENCY_CAP');
    expect(decision.blockedReason).toMatch(/declined a credit offer 2 days ago/);
  });

  test('only one offer is shown per week', () => {
    const decision = run('u_rohit', 'm_kroma', 50_000, {
      nudgeHistory: [
        { product: 'postpaid', decidedAt: addDays(NOW.slice(0, 10), -1), outcome: 'shown' },
      ],
    });
    expect(decision.blockedBy).toBe('FREQUENCY_CAP');
  });

  test('past the window, the user may be asked again', () => {
    const decision = run('u_rohit', 'm_kroma', 50_000, {
      nudgeHistory: [
        { product: 'postpaid', decidedAt: addDays(NOW.slice(0, 10), -10), outcome: 'declined' },
      ],
    });
    expect(decision.showNudge).toBe(true);
  });

  test('an accepted offer does not block a later one', () => {
    const decision = run('u_rohit', 'm_kroma', 50_000, {
      nudgeHistory: [
        { product: 'postpaid', decidedAt: addDays(NOW.slice(0, 10), -3), outcome: 'accepted' },
      ],
    });
    expect(decision.showNudge).toBe(true);
  });
});

describe('EMI arithmetic', () => {
  test('no-cost instalments sum to the principal exactly', () => {
    for (const principal of [50_000, 45_001, 33_333, 12_345, 99_999]) {
      const [threeMonth] = buildTenures(principal, 'postpaid', 'electronics', NOW);
      expect(threeMonth.noCost).toBe(true);
      const total = threeMonth.emi * (threeMonth.months - 1) + threeMonth.lastEmi;
      expect(total).toBe(principal);
      expect(threeMonth.interest).toBe(0);
      // The final payment must never be the largest one.
      expect(threeMonth.lastEmi).toBeLessThanOrEqual(threeMonth.emi);
      expect(threeMonth.lastEmi).toBeGreaterThan(0);
    }
  });

  test('interest-bearing plans cost more than the principal, and longer costs more', () => {
    const tenures = buildTenures(80_000, 'card', 'jewellery', NOW);
    for (const tenure of tenures) {
      expect(tenure.noCost).toBe(false);
      expect(tenure.total).toBeGreaterThan(80_000);
      expect(tenure.interest).toBe(tenure.total - 80_000);
    }
    const sorted = [...tenures].sort((a, b) => a.months - b.months);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].interest).toBeGreaterThan(sorted[i - 1].interest);
      expect(sorted[i].emi).toBeLessThan(sorted[i - 1].emi);
    }
  });

  test('instalments below ₹500 are not offered', () => {
    const tenures = buildTenures(2_400, 'card', 'apparel', NOW);
    for (const tenure of tenures) {
      expect(tenure.emi).toBeGreaterThanOrEqual(500);
    }
    expect(tenures.some((tenure) => tenure.months === 12)).toBe(false);
  });

  test('the first instalment falls due a month after the purchase', () => {
    const [tenure] = buildTenures(50_000, 'postpaid', 'electronics', '2026-01-31T10:00:00+05:30');
    expect(tenure.firstDueDate).toBe('2026-02-28');
  });
});

describe('the amount-fit curve', () => {
  test('peaks across the ₹10,000–₹1,00,000 band and tapers outside it', () => {
    expect(amountFit(10_000)).toBe(1);
    expect(amountFit(50_000)).toBe(1);
    expect(amountFit(1_00_000)).toBe(1);
    expect(amountFit(3_000)).toBeLessThan(amountFit(9_000));
    expect(amountFit(1_50_000)).toBeLessThan(1);
    expect(amountFit(1_50_000)).toBeGreaterThanOrEqual(0.6);
  });
});

describe('the audit trail', () => {
  test('a blocked decision still records the score it would have had', () => {
    const decision = run('u_priya', 'm_kroma', 50_000);
    expect(decision.showNudge).toBe(false);
    expect(decision.score).toBeGreaterThan(0);
    expect(decision.trace.factors).toHaveLength(4);
  });

  test('gates are recorded up to and including the one that failed', () => {
    const decision = run('u_meera', 'm_kroma', 50_000);
    const failed = decision.trace.gates.filter((gate) => !gate.passed);
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe('INSUFFICIENT_LIMIT');
    expect(decision.trace.gates.at(-1)!.id).toBe('INSUFFICIENT_LIMIT');
  });

  test('every decision explains what would have changed the outcome', () => {
    for (const decision of [
      run('u_rohit', 'm_kroma', 50_000),
      run('u_priya', 'm_kroma', 50_000),
      run('u_aman', 'm_kroma', 50_000),
      run('u_deepak', 'm_kroma', 20_000),
    ]) {
      expect(decision.trace.counterfactual.length).toBeGreaterThan(20);
      expect(decision.trace.summary.length).toBeGreaterThan(20);
    }
  });

  test('the eligibility signal is always broken down into its components', () => {
    const decision = run('u_rohit', 'm_kroma', 50_000);
    expect(decision.eligibilityBreakdown).toHaveLength(5);
    const total = decision.eligibilityBreakdown.reduce((sum, part) => sum + part.points, 0);
    expect(Math.round(total)).toBe(decision.eligibilitySignal);
  });
});
