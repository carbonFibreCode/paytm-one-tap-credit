/**
 * Not an assertion suite — a readable dump of the demo scenarios, used to check
 * that the engine's explanations make sense out loud before they reach the UI.
 *
 *   npx vitest run tests/inspect.test.ts --disable-console-intercept
 */

import { test } from 'vitest';
import { decide } from '../lib/engine/decide';
import { buildProfile, getPersona } from '../lib/personas';
import { getMerchant } from '../lib/merchants';
import type { Instrument } from '../lib/types';

const NOW = '2026-09-19T14:30:00+05:30';

const SCENARIOS: Array<{ user: string; merchant: string; amount: number; instrument?: Instrument }> =
  [
    { user: 'u_rohit', merchant: 'm_kroma', amount: 50_000 },
    { user: 'u_rohit', merchant: 'm_jewels', amount: 80_000 },
    { user: 'u_rohit', merchant: 'm_bigbazaar', amount: 450 },
    { user: 'u_rohit', merchant: 'm_p2p', amount: 35_000 },
    { user: 'u_priya', merchant: 'm_kroma', amount: 50_000 },
    { user: 'u_aman', merchant: 'm_kroma', amount: 50_000 },
    { user: 'u_deepak', merchant: 'm_kroma', amount: 20_000 },
    { user: 'u_meera', merchant: 'm_kroma', amount: 50_000 },
    { user: 'u_vikram', merchant: 'm_kroma', amount: 30_000 },
  ];

test('demo scenarios read sensibly', () => {
  for (const scenario of SCENARIOS) {
    const persona = getPersona(scenario.user)!;
    const merchant = getMerchant(scenario.merchant)!;
    const profile = buildProfile(persona, NOW);

    const decision = decide({
      request: {
        transactionId: `txn_${scenario.user}`,
        userId: scenario.user,
        amount: scenario.amount,
        merchantId: merchant.id,
        merchantName: merchant.name,
        merchantCategory: merchant.category,
        timestamp: NOW,
        selectedInstrument: scenario.instrument,
      },
      profile,
      merchantCreditEnabled: merchant.creditEnabled,
    });

    const verdict = decision.showNudge
      ? `NUDGE → ${decision.product}`
      : `no nudge (${decision.blockedBy})`;

    console.log(
      `\n${profile.displayName} · ₹${scenario.amount.toLocaleString('en-IN')} · ${merchant.name}`,
    );
    console.log(`  ${verdict}  ·  score ${decision.score}/100  ·  signal ${decision.eligibilitySignal}/100`);
    console.log(`  ${decision.trace.summary}`);
    if (decision.offer) {
      for (const tenure of decision.offer.tenures) {
        console.log(
          `    ${tenure.months}m → ₹${tenure.emi.toLocaleString('en-IN')}/mo` +
            (tenure.lastEmi !== tenure.emi
              ? ` (last ₹${tenure.lastEmi.toLocaleString('en-IN')})`
              : '') +
            (tenure.noCost ? ' · no cost' : ` · ₹${tenure.interest.toLocaleString('en-IN')} interest`),
        );
      }
      console.log(`    ${decision.trace.productRationale}`);
    }
    console.log(`  counterfactual: ${decision.trace.counterfactual}`);
  }
});
