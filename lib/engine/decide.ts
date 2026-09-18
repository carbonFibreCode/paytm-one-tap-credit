/**
 * The decision engine.
 *
 * A pure function: same request plus same profile always yields the same
 * decision. It reads no clock, no database and no environment — the caller
 * supplies the timestamp and the nudge history, which is what lets the same
 * code run in an API route, in a test, and in the demo drawer identically.
 *
 * Order of operations:
 *   1. hard gates — any failure ends it, no score can override
 *   2. relevance score — is *this moment* worth interrupting?
 *   3. product selection — among products that can actually fund the purchase
 *   4. offer construction — only tenures the user can responsibly carry
 */

import type {
  Decision,
  DecisionRequest,
  EmiOption,
  GateId,
  GateResult,
  UserProfile,
} from '../types';
import { runGates, type GateContext } from './gates';
import { NUDGE_SCORE_THRESHOLD, scoreTransaction } from './score';
import { buildTenures, lowestInstalment } from './emi';
import { buildOffer, DECLINE } from './offer';
import {
  counterfactualForBlock,
  counterfactualForNudge,
  summarise,
  weakestFactorHint,
} from './explain';

export interface DecideInput {
  request: DecisionRequest;
  profile: UserProfile;
  /** Whether the merchant is in the credit-accepting network. */
  merchantCreditEnabled: boolean;
}

/**
 * Assemble everything the gates need to judge a transaction.
 *
 * Exported because the engine is also exposed as individual stages over HTTP,
 * so an n8n workflow can run gates, scoring and offer construction as separate
 * visible steps. Both paths build the context the same way, here, once.
 */
export function buildGateContext({ request, profile, merchantCreditEnabled }: DecideInput): {
  context: GateContext;
  tenuresByProduct: Map<string, EmiOption[]>;
} {
  const { amount, merchantCategory, timestamp } = request;

  // --- what could fund this purchase at all ---
  const eligibleProducts = profile.products.filter((product) => product.eligible);
  const fundingProducts = eligibleProducts.filter((product) => product.available >= amount);

  // Cheapest instalment reachable across every funding product, so the
  // affordability gate only declines when *no* plan would fit.
  const tenuresByProduct = new Map<string, EmiOption[]>();
  for (const product of fundingProducts) {
    tenuresByProduct.set(product.id, buildTenures(amount, product.id, merchantCategory, timestamp));
  }
  const minAchievableEmi = Math.min(
    ...[...tenuresByProduct.values()].map(lowestInstalment),
    Number.POSITIVE_INFINITY,
  );

  return {
    tenuresByProduct,
    context: {
      amount,
      category: merchantCategory,
      merchantCreditEnabled,
      timestamp,
      profile,
      nudgeHistory: request.nudgeHistory ?? [],
      selectedInstrument: request.selectedInstrument,
      eligibleProducts,
      fundingProducts,
      minAchievableEmi,
    },
  };
}

export function decide(input: DecideInput): Decision {
  const { request, profile } = input;
  const { amount, merchantCategory } = request;

  const { context, tenuresByProduct } = buildGateContext(input);
  const { eligibleProducts, fundingProducts } = context;

  const { results: gates, blockedBy, blockedReason } = runGates(context);

  // The score is computed either way — a blocked decision still shows how the
  // transaction would have scored, which is what makes the trail auditable.
  const { score, factors } = scoreTransaction(amount, merchantCategory, profile);

  const base = {
    transactionId: request.transactionId,
    score,
    eligibilitySignal: profile.eligibilitySignal,
    eligibilityBreakdown: profile.eligibilityBreakdown,
  };

  if (blockedBy) {
    return {
      ...base,
      showNudge: false,
      product: null,
      blockedBy,
      blockedReason,
      offer: null,
      decline: null,
      trace: {
        gates,
        factors,
        productRationale: 'No product selected — a hard gate blocked the offer',
        counterfactual: counterfactualForBlock(blockedBy, context),
        summary: `No credit offer shown. ${blockedReason}`,
      },
    };
  }

  // Every gate passed; is this moment worth interrupting?
  if (score < NUDGE_SCORE_THRESHOLD) {
    const detail = `Relevance score ${score}/100 is below the threshold of ${NUDGE_SCORE_THRESHOLD} — eligible, but this is not a moment worth interrupting`;
    return {
      ...base,
      showNudge: false,
      product: null,
      blockedBy: 'SCORE_THRESHOLD',
      blockedReason: detail,
      offer: null,
      decline: null,
      trace: {
        gates: [...gates, { id: 'SCORE_THRESHOLD' as GateId, passed: false, detail }],
        factors,
        productRationale: 'No product selected — the moment scored too low',
        counterfactual: weakestFactorHint(factors),
        summary: `No credit offer shown. ${detail}`,
      },
    };
  }

  // --- build the offer ---
  // Shared with the n8n offer stage, so the two paths cannot drift apart.
  const { offer, product, rationale } = buildOffer({
    fundingProducts,
    eligibleProducts,
    amount,
    category: merchantCategory,
    timestamp: request.timestamp,
    capacity: profile.features.affordabilityCapacity,
    tenuresByProduct,
  });

  return {
    ...base,
    showNudge: true,
    product: product.id,
    blockedBy: null,
    blockedReason: null,
    offer,
    decline: DECLINE,
    trace: {
      gates,
      factors,
      productRationale: rationale,
      counterfactual: counterfactualForNudge(context, score),
      summary: summarise(product, amount, offer.tenures, score),
    },
  };
}

/** Re-export so callers can surface the same gate results the engine used. */
export type { GateResult };
