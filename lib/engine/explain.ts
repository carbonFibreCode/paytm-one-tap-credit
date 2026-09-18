/**
 * Explanations — the sentences behind a decision.
 *
 * Kept apart from `decide.ts` so the decision logic reads as logic and the
 * prose can change without touching it. Every threshold quoted here is the
 * exported constant, never a literal, so the explanation cannot drift from
 * the rule it describes.
 */

import type { EmiOption, GateId, ProductState, ScoreFactor, SignalComponent, UserProfile } from '../types';
import { formatINR } from '../format';
import {
  AMOUNT_CEILING,
  AMOUNT_FLOOR,
  BANK_COOLOFF_DAYS,
  COLD_START_MIN_DAYS,
  COLD_START_MIN_TXNS,
  ELIGIBILITY_THRESHOLD,
  FREQUENCY_WINDOW_DAYS,
  type GateContext,
} from './gates';
import { CARD_PREFERENCE_THRESHOLD } from './product';
import { NUDGE_SCORE_THRESHOLD } from './score';

/** Within this many points of the eligibility cut-off, say so. */
const NEAR_CUTOFF_MARGIN = 15;
/** Cleared the relevance bar by less than this — worth mentioning. */
const NARROW_HEADROOM = 10;

/** The item furthest from full marks — the reason a total is held back. */
export function weakestBy<T>(items: T[], score: (item: T) => number, max: (item: T) => number): T | null {
  if (items.length === 0) return null;
  return items.reduce((lowest, item) =>
    score(item) / max(item) < score(lowest) / max(lowest) ? item : lowest,
  );
}

export const weakestSignal = (components: SignalComponent[]) =>
  weakestBy(components, (c) => c.points, (c) => c.max);

export const weakestFactor = (factors: ScoreFactor[]) =>
  weakestBy(factors, (f) => f.points, (f) => f.weight);

export function summarise(
  product: ProductState,
  amount: number,
  tenures: EmiOption[],
  score: number,
): string {
  // Lead with a no-cost plan when one exists — it is the most compelling option
  // and the one a user actually compares against paying in full. Otherwise fall
  // back to the smallest instalment.
  const best =
    tenures.find((option) => option.noCost) ??
    tenures.reduce((lowest, option) => (option.emi < lowest.emi ? option : lowest));
  return `${formatINR(amount)} scored ${score}/100 for instalment credit. ${
    product.partner
  } can cover it in ${best.months} instalments of ${formatINR(best.emi)}${
    best.noCost ? ' at no extra cost' : ''
  }.`;
}

/** What would have had to be different for this nudge *not* to appear. */
export function counterfactualForNudge(context: GateContext, score: number): string {
  const headroom = score - NUDGE_SCORE_THRESHOLD;
  const parts: string[] = [];

  parts.push(
    `Below ${formatINR(AMOUNT_FLOOR)}, or in an everyday category like groceries or fuel, this would not have been shown.`,
  );

  if (context.profile.eligibilitySignal < ELIGIBILITY_THRESHOLD + NEAR_CUTOFF_MARGIN) {
    parts.push(
      `The eligibility signal of ${context.profile.eligibilitySignal} is close to the cut-off of ${ELIGIBILITY_THRESHOLD}.`,
    );
  }
  if (headroom < NARROW_HEADROOM) {
    parts.push(`The score cleared the bar by only ${headroom} points.`);
  }
  if (context.fundingProducts.length > 1) {
    parts.push(
      `Crossing ${formatINR(CARD_PREFERENCE_THRESHOLD)} switches the recommendation between Postpaid and the card.`,
    );
  }
  return parts.join(' ');
}

/** What would have to change for a blocked decision to become an offer. */
export function counterfactualForBlock(gate: GateId, context: GateContext): string {
  const { amount, profile } = context;

  switch (gate) {
    case 'CATEGORY_PROHIBITED':
      return 'No amount and no eligibility signal would change this — the category is blocked outright.';
    case 'MERCHANT_NOT_ENABLED':
      return 'The same purchase at a merchant inside the credit network would be assessed normally.';
    case 'AMOUNT_FLOOR':
      return `At ${formatINR(AMOUNT_FLOOR)} or above, this transaction would be assessed instead of skipped.`;
    case 'AMOUNT_CEILING':
      return `At ${formatINR(AMOUNT_CEILING)} or below, this would be assessed against the user's available limits.`;
    case 'CATEGORY_RELEVANCE':
      return 'The same amount spent on electronics, travel or jewellery would clear the relevance floor.';
    case 'OPTED_OUT':
      return 'Only the user reversing their opt-out would change this.';
    case 'COLD_START':
      return `At ${COLD_START_MIN_DAYS} days and ${COLD_START_MIN_TXNS} transactions of history the signal becomes meaningful; this user is at ${profile.features.accountAgeDays} days and ${profile.features.txnCount}.`;
    case 'NOT_ELIGIBLE':
      return `The signal would need to reach ${ELIGIBILITY_THRESHOLD}; it currently sits at ${profile.eligibilitySignal}, held back most by ${weakestComponent(profile)}.`;
    case 'BANK_COOLOFF':
      return `Once the ${BANK_COOLOFF_DAYS}-day cooling-off elapses, this user is assessed normally again.`;
    case 'FREQUENCY_CAP':
      return `Once the ${FREQUENCY_WINDOW_DAYS}-day window elapses, this user becomes eligible to be asked again.`;
    case 'NO_PRODUCT':
      return 'This user is not pre-approved for any product — approval is the partner bank’s decision, not ours.';
    case 'ALREADY_ACTIVE':
      return 'Selecting a different payment method would make the offer relevant again.';
    case 'INSUFFICIENT_LIMIT': {
      const best = context.eligibleProducts.reduce(
        (highest, product) => Math.max(highest, product.available),
        0,
      );
      return `At ${formatINR(best)} or below, the existing limit would cover this purchase in full.`;
    }
    case 'AFFORDABILITY': {
      // An instalment is directly proportional to the principal at a fixed rate
      // and tenure, so the affordable principal scales the same way.
      const affordablePrincipal =
        (amount * profile.features.affordabilityCapacity) / context.minAchievableEmi;
      return `The same purchase at roughly ${formatINR(
        affordablePrincipal,
      )} or less would fit within this user's assessed capacity, using the longest plan available to them.`;
    }
    default:
      return `Amount ${formatINR(amount)} in ${context.category}.`;
  }
}

function weakestComponent(profile: UserProfile): string {
  const weakest = weakestSignal(profile.eligibilityBreakdown)!;
  return `${weakest.label.toLowerCase()} (${weakest.points}/${weakest.max})`;
}

export function weakestFactorHint(factors: ScoreFactor[]): string {
  const weakest = weakestFactor(factors)!;
  return `The score was held back most by ${weakest.label.toLowerCase()} (${weakest.points}/${
    weakest.weight
  }). ${weakest.detail}.`;
}
