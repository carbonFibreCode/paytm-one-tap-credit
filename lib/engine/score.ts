/**
 * Relevance score.
 *
 * Runs only after every hard gate has passed — so this never decides whether a
 * user *may* be offered credit, only whether this particular moment is a good
 * one to ask. Four weighted factors, each carrying its own explanation.
 */

import type { MerchantCategory, ScoreFactor, UserProfile } from '../types';
import { CATEGORY_META } from '../domain';
import { formatINR } from '../format';
import { clamp, round } from '../math';

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

/**
 * What the memory layer remembers about how this user answers offers.
 *
 * Supplied by Cognee in production, or by the local fallback store. It only
 * ever carries counts and categories — facts, never judgements — because a
 * fabricated claim must not be able to move a credit decision.
 */
export interface MemoryContext {
  acceptedCount: number;
  declinedCount: number;
  declinedCategories: string[];
  source: string;
}

export interface MemoryAdjustment {
  points: number;
  detail: string;
}

export interface ScoreResult {
  score: number;
  factors: ScoreFactor[];
  memoryAdjustment: MemoryAdjustment | null;
  passesThreshold: boolean;
}

/** Declining here hurts more than declining in general; accepting helps a little. */
const DECLINED_SAME_CATEGORY = -20;
const DECLINED_ELSEWHERE = -8;
const PREVIOUSLY_ACCEPTED = 5;

/**
 * Turn remembered outcomes into a relevance adjustment.
 *
 * Deliberately confined to relevance. Memory can make us *less* likely to
 * interrupt someone who keeps saying no, but it can never unlock eligibility,
 * affordability or any other hard gate — those stay deterministic.
 */
export function memoryAdjustmentFor(
  memory: MemoryContext | undefined,
  category: MerchantCategory,
): MemoryAdjustment | null {
  if (!memory) return null;

  if (memory.declinedCategories.includes(category)) {
    return {
      points: DECLINED_SAME_CATEGORY,
      detail: `This user has declined a credit offer on ${category} before — asking again is less welcome here`,
    };
  }
  if (memory.declinedCount > 0) {
    return {
      points: DECLINED_ELSEWHERE,
      detail: `${memory.declinedCount} previous offer${
        memory.declinedCount === 1 ? '' : 's'
      } declined in other categories`,
    };
  }
  if (memory.acceptedCount > 0) {
    return {
      points: PREVIOUSLY_ACCEPTED,
      detail: `${memory.acceptedCount} previous offer${
        memory.acceptedCount === 1 ? '' : 's'
      } accepted — instalments suit this user`,
    };
  }
  return { points: 0, detail: 'No prior offer outcomes recalled for this user' };
}

export function scoreTransaction(
  amount: number,
  category: MerchantCategory,
  profile: UserProfile,
  memory?: MemoryContext,
): ScoreResult {
  const factors: ScoreFactor[] = [];

  // 1. Category — is credit a natural fit for what is being bought?
  const categoryValue = CATEGORY_META[category].relevance;
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
        ? `${formatINR(amount)} sits inside the ${formatINR(SWEET_SPOT_LOW)}–${formatINR(
            SWEET_SPOT_HIGH,
          )} band where instalments are most useful`
        : `${formatINR(amount)} sits outside the ${formatINR(SWEET_SPOT_LOW)}–${formatINR(
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

  const base = factors.reduce((total, factor) => total + factor.points, 0);
  const memoryAdjustment = memoryAdjustmentFor(memory, category);
  const score = Math.round(clamp(base + (memoryAdjustment?.points ?? 0), 0, 100));

  return {
    score,
    factors,
    memoryAdjustment,
    passesThreshold: score >= NUDGE_SCORE_THRESHOLD,
  };
}
