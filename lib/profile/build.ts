/**
 * Assembling a profile: ledger -> behavioural features -> eligibility signal.
 *
 * Kept apart from the persona fixtures it reads, because this is the chain the
 * pitch rests on and the fixtures are only its input. Nothing here reads a
 * clock or a database: `asOf` and `live` are both supplied by the caller,
 * which is what keeps a decision reproducible from its inputs alone.
 */

import type { LiveCredit, UserProfile } from '../types';
import { personOrDefault } from '../fixtures/people';
import { creditRecordFor, type Persona } from '../fixtures/personas';
import { generateLedger } from './ledger';
import { computeFeatures } from './features';
import { deriveEligibilitySignal } from './signal';
import { addDays } from '../dates';

/** What a user with no accounts opened through this system is carrying. */
export const NO_LIVE_CREDIT: LiveCredit = {
  obligations: [],
  outstanding: { postpaid: 0, card: 0 },
};

/**
 * Assemble a full profile: generate the ledger, derive features from it, then
 * derive the eligibility signal from those features.
 *
 * `live` is whatever credit this system has already extended — supplied by the
 * caller, never read here, so the function stays as pure as the engine that
 * consumes it. It lowers the affordability capacity and the available limit;
 * it never touches eligibility.
 */
export function buildProfile(
  persona: Persona,
  asOf: string,
  live: LiveCredit = NO_LIVE_CREDIT,
): UserProfile {
  const ledger = generateLedger(persona.spec, asOf);
  const features = computeFeatures(ledger, asOf, creditRecordFor(persona), live.obligations);
  const { score, breakdown } = deriveEligibilitySignal(features);

  const person = personOrDefault(persona.spec.userId);

  return {
    userId: persona.spec.userId,
    displayName: person.displayName,
    preferredLanguage: person.preferredLanguage,
    features,
    eligibilitySignal: score,
    eligibilityBreakdown: breakdown,
    products: persona.products.map((product) => ({
      ...product,
      available: Math.max(0, product.available - (live.outstanding[product.id] ?? 0)),
    })),
    optedOut: persona.optedOut,
    bankRejectionAt:
      persona.bankRejectionDaysAgo === undefined
        ? undefined
        : addDays(asOf.slice(0, 10), -persona.bankRejectionDaysAgo),
  };
}

/** Profile plus the underlying ledger, for the "show me the history" view. */
export function buildProfileWithLedger(
  persona: Persona,
  asOf: string,
  live: LiveCredit = NO_LIVE_CREDIT,
) {
  return {
    profile: buildProfile(persona, asOf, live),
    ledger: generateLedger(persona.spec, asOf),
  };
}
