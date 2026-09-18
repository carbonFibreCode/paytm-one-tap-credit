import { describe, expect, test } from 'vitest';
import { decide } from '../lib/engine/decide';
import { buildSchedule, buildTenures } from '../lib/engine/emi';
import { computeFeatures } from '../lib/memory/features';
import { generateLedger } from '../lib/memory/ledger';
import { buildProfile, getPersona, NO_LIVE_CREDIT } from '../lib/personas';
import type { DecisionRequest, LiveCredit, RecurringObligation } from '../lib/types';

const NOW = '2026-09-19T14:30:00+05:30';
const rohit = getPersona('u_rohit')!;

const kroma: DecisionRequest = {
  transactionId: 'txn_u_rohit_m_kroma_50000',
  userId: 'u_rohit',
  amount: 50_000,
  merchantId: 'm_kroma',
  merchantName: 'Kroma Electronics',
  merchantCategory: 'electronics',
  timestamp: NOW,
  nudgeHistory: [],
};

function decideFor(live: LiveCredit) {
  return decide({
    request: kroma,
    profile: buildProfile(rohit, NOW, live),
    merchantCreditEnabled: true,
  });
}

/** A ₹50,000 no-cost plan: 16,667 + 16,667 + 16,666. */
function postpaidEmi(): RecurringObligation {
  return { merchant: 'Paytm Postpaid EMI', amount: 16_667, category: 'emi', occurrences: 0 };
}

describe('instalment schedule', () => {
  test('rows always sum to the plan total, for every product, tenure and rounding regime', () => {
    for (const principal of [50_000, 80_000, 12_345, 1_20_000]) {
      for (const product of ['postpaid', 'card'] as const) {
        for (const category of ['electronics', 'jewellery'] as const) {
          for (const tenure of buildTenures(principal, product, category, NOW)) {
            const rows = buildSchedule(tenure);
            expect(rows).toHaveLength(tenure.months);
            expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(tenure.total);
            expect(tenure.total - tenure.interest).toBe(principal);
          }
        }
      }
    }
  });

  test('a no-cost plan never makes the final instalment the largest', () => {
    const [noCost] = buildTenures(50_000, 'postpaid', 'electronics', NOW).filter((t) => t.noCost);
    const rows = buildSchedule(noCost);
    expect(rows.map((row) => row.amount)).toEqual([16_667, 16_667, 16_666]);
    expect(rows[0].date).toBe('2026-10-19');
    expect(rows[2].date).toBe('2026-12-19');
  });
});

describe('live credit feeds the profile', () => {
  test('an account opened here lowers affordability capacity by 40% of its instalment', () => {
    const ledger = generateLedger(rohit.spec, NOW);
    const before = computeFeatures(ledger, NOW, rohit.credit);
    const after = computeFeatures(ledger, NOW, rohit.credit, [postpaidEmi()]);

    expect(after.existingEmiOutflow).toBe(before.existingEmiOutflow + 16_667);
    expect(after.affordabilityCapacity).toBe(before.affordabilityCapacity - Math.round(16_667 * 0.4));
    expect(after.detectedObligations.at(-1)).toMatchObject({ source: 'account', amount: 16_667 });
    // Eligibility is a different question; live credit must not touch it.
    expect(after.priorCreditRepayments).toBe(before.priorCreditRepayments);
  });

  test('outstanding balance comes off the available limit, never below zero', () => {
    const profile = buildProfile(rohit, NOW, {
      obligations: [],
      outstanding: { postpaid: 50_000, card: 3_00_000 },
    });
    expect(profile.products.find((p) => p.id === 'postpaid')?.available).toBe(50_000);
    expect(profile.products.find((p) => p.id === 'card')?.available).toBe(0);
    expect(profile.products.find((p) => p.id === 'postpaid')?.limit).toBe(1_00_000);
  });
});

describe('the demo beat: taking credit tightens the next decision', () => {
  test('with no live credit, Rohit is offered both Postpaid tenures at Kroma', () => {
    const decision = decideFor(NO_LIVE_CREDIT);
    expect(decision.showNudge).toBe(true);
    expect(decision.offer?.tenures.map((t) => t.months)).toEqual([3, 6]);
  });

  test('two open plans leave only the longer tenure affordable', () => {
    const decision = decideFor({
      obligations: [postpaidEmi(), postpaidEmi()],
      outstanding: { postpaid: 0, card: 0 },
    });
    expect(decision.showNudge).toBe(true);
    expect(decision.offer?.tenures.map((t) => t.months)).toEqual([6]);
  });

  test('three plans: Postpaid cannot carry it, so the offer moves to the card with only tenures that fit', () => {
    const decision = decideFor({
      obligations: [postpaidEmi(), postpaidEmi(), postpaidEmi()],
      outstanding: { postpaid: 0, card: 0 },
    });
    const capacity = buildProfile(rohit, NOW, {
      obligations: [postpaidEmi(), postpaidEmi(), postpaidEmi()],
      outstanding: { postpaid: 0, card: 0 },
    }).features.affordabilityCapacity;

    expect(decision.showNudge).toBe(true);
    expect(decision.product).toBe('card');
    expect(decision.offer?.tenures.length).toBeGreaterThan(0);
    for (const tenure of decision.offer?.tenures ?? []) expect(tenure.emi).toBeLessThanOrEqual(capacity);
    expect(decision.trace.productRationale).toContain('exceeds');
  });

  test('a fourth plan is declined on affordability — same user, same merchant, same amount', () => {
    const decision = decideFor({
      obligations: [postpaidEmi(), postpaidEmi(), postpaidEmi(), postpaidEmi()],
      outstanding: { postpaid: 0, card: 0 },
    });
    expect(decision.showNudge).toBe(false);
    expect(decision.blockedBy).toBe('AFFORDABILITY');
  });

  test('no offered instalment ever exceeds assessed capacity, at any level of live credit', () => {
    for (const plans of [0, 1, 2, 3, 4, 5]) {
      for (const amount of [20_000, 50_000, 80_000]) {
        const live: LiveCredit = {
          obligations: Array.from({ length: plans }, postpaidEmi),
          outstanding: { postpaid: 0, card: 0 },
        };
        const profile = buildProfile(rohit, NOW, live);
        const decision = decide({
          request: { ...kroma, amount, transactionId: `t_${plans}_${amount}` },
          profile,
          merchantCreditEnabled: true,
        });
        for (const tenure of decision.offer?.tenures ?? []) {
          expect(tenure.emi).toBeLessThanOrEqual(profile.features.affordabilityCapacity);
        }
      }
    }
  });

  test('exhausting the Postpaid limit falls through to the card', () => {
    const decision = decideFor({
      obligations: [],
      outstanding: { postpaid: 1_00_000, card: 0 },
    });
    expect(decision.showNudge).toBe(true);
    expect(decision.product).toBe('card');
  });
});
