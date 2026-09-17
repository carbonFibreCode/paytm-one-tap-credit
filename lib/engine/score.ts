/**
 * Relevance score.
 *
 * Runs only after every hard gate has passed — so this never decides whether a
 * user *may* be offered credit, only whether this particular moment is a good
 * one to ask. Four weighted factors, each carrying its own explanation.
 */

import type { MerchantCategory, ScoreFactor, UserProfile } from '../types';
import { CATEGORY_RELEVANCE } from './gates';

/** A transaction must clear this to be worth interrupting the checkout. */
export const NUDGE_SCORE_THRESHOLD = 60;

const WEIGHTS = {
  category: 35,
  amountFit: 25,
  eligibility: 30,
  context: 10,
} as const;

/** The band where instalments genuinely help: too small is noise, too large is rare. */
const SWEET_SPOT_LOW = 10_000;
const SWEET_SPOT_HIGH = 1_00_000;

function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

function rupees(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

/**
 * How well the amount sits in the band where an instalment plan is useful.
 * Ramps up to the sweet spot, sits flat across it, then tapers above it.
 */
export function amountFit(amount: number): number {
  if (amount <= 0) return 0;
  if (amount < SWEET_SPOT_LOW) {
    return clamp(0.3 + (0.7 * (amount - 2_000)) / (SWEET_SPOT_LOW - 2_000), 0.3, 1);
  }
  if (amount <= SWEET_SPOT_HIGH) return 1;
  return clamp(1 - (0.4 * (amount - SWEET_SPOT_HIGH)) / SWEET_SPOT_HIGH, 0.6, 1);
}

export interface ScoreResult {
  score: number;
  factors: ScoreFactor[];
  passesThreshold: boolean;
}

export function scoreTransaction(
  amount: number,
  category: MerchantCategory,
  profile: UserProfile,
): ScoreResult {
  const factors: ScoreFactor[] = [];

  // 1. Category — is credit a natural fit for what is being bought?
  const categoryValue = CATEGORY_RELEVANCE[category];
  factors.push({
    id: 'CATEGORY',
    label: 'Category relevance',
    weight: WEIGHTS.category,
    value: categoryValue,
    points: round(categoryValue * WEIGHTS.category),
    detail: `${category} purchases carry a ${categoryValue.toFixed(
      2,
    )} relevance weight for instalment credit`,
  });

  // 2. Amount — is it in the band where spreading the cost actually helps?
  const fitValue = amountFit(amount);
  factors.push({
    id: 'AMOUNT_FIT',
    label: 'Amount fit',
    weight: WEIGHTS.amountFit,
    value: fitValue,
    points: round(fitValue * WEIGHTS.amountFit),
    detail:
      amount >= SWEET_SPOT_LOW && amount <= SWEET_SPOT_HIGH
        ? `${rupees(amount)} sits inside the ${rupees(SWEET_SPOT_LOW)}–${rupees(
            SWEET_SPOT_HIGH,
          )} band where instalments are most useful`
        : `${rupees(amount)} sits outside the ${rupees(SWEET_SPOT_LOW)}–${rupees(
            SWEET_SPOT_HIGH,
          )} sweet spot`,
  });

  // 3. Eligibility — the signal derived from the user's own history.
  const eligibilityValue = clamp(profile.eligibilitySignal / 100);
  factors.push({
    id: 'ELIGIBILITY',
    label: 'Eligibility signal',
    weight: WEIGHTS.eligibility,
    value: eligibilityValue,
    points: round(eligibilityValue * WEIGHTS.eligibility),
    detail: `Signal of ${profile.eligibilitySignal}/100, derived from ${profile.features.txnCount} transactions of history`,
  });

  // 4. Context — has this user bought in this category, and at this size, before?
  const affinity = profile.features.categoryAffinity[category] ?? 0;
  const affinityValue = clamp(affinity / 0.4);
  const bigTicketValue = clamp(profile.features.bigTicketCount6m / 3);
  const contextValue = 0.6 * affinityValue + 0.4 * bigTicketValue;
  factors.push({
    id: 'CONTEXT',
    label: 'Purchase context',
    weight: WEIGHTS.context,
    value: contextValue,
    points: round(contextValue * WEIGHTS.context),
    detail:
      affinity > 0
        ? `${Math.round(
            affinity * 100,
          )}% of this user's discretionary spend is in ${category}; ${
            profile.features.bigTicketCount6m
          } big-ticket purchase${
            profile.features.bigTicketCount6m === 1 ? '' : 's'
          } in the last 6 months`
        : `No prior ${category} spend on record; ${profile.features.bigTicketCount6m} big-ticket purchase${
            profile.features.bigTicketCount6m === 1 ? '' : 's'
          } in the last 6 months`,
  });

  const score = Math.round(factors.reduce((total, factor) => total + factor.points, 0));

  return { score, factors, passesThreshold: score >= NUDGE_SCORE_THRESHOLD };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
