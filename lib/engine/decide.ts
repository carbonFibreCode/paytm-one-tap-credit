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
  DecisionTrace,
  EmiOption,
  GateId,
  GateResult,
  Offer,
  ProductState,
  UserProfile,
} from '../types';
import { runGates, type GateContext, AMOUNT_FLOOR, ELIGIBILITY_THRESHOLD } from './gates';
import { NUDGE_SCORE_THRESHOLD, scoreTransaction } from './score';
import { CARD_PREFERENCE_THRESHOLD, selectProduct } from './product';
import { affordableTenures, buildTenures, lowestInstalment } from './emi';

/** How long a declined offer is respected before we may ask again. */
const DECLINE_SUPPRESS_DAYS = 7;

export interface DecideInput {
  request: DecisionRequest;
  profile: UserProfile;
  /** Whether the merchant is in the credit-accepting network. */
  merchantCreditEnabled: boolean;
}

function rupees(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
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
    tenuresByProduct.set(
      product.id,
      buildTenures(amount, product.id, merchantCategory, timestamp),
    );
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
  const { product, rationale } = selectProduct(fundingProducts, amount, eligibleProducts);
  const allTenures = tenuresByProduct.get(product.id) ?? [];
  const capacity = profile.features.affordabilityCapacity;
  const affordable = affordableTenures(allTenures, capacity);

  // The affordability gate guarantees at least one plan fits; keep the cheapest
  // as a floor in case rounding leaves the list empty.
  const tenures =
    affordable.length > 0
      ? affordable
      : [allTenures.reduce((cheapest, option) => (option.emi < cheapest.emi ? option : cheapest))];

  const offer: Offer = {
    product: product.id,
    partner: product.partner,
    limit: product.limit,
    available: product.available,
    tenures,
  };

  const suppressed = allTenures.length - tenures.length;

  return {
    ...base,
    showNudge: true,
    product: product.id,
    blockedBy: null,
    blockedReason: null,
    offer,
    decline: { label: 'No thanks, pay normally', suppressDays: DECLINE_SUPPRESS_DAYS },
    trace: {
      gates,
      factors,
      productRationale:
        suppressed > 0
          ? `${rationale}. ${suppressed} shorter tenure${
              suppressed === 1 ? '' : 's'
            } withheld — the instalment would exceed ${rupees(capacity)}/month of assessed capacity`
          : rationale,
      counterfactual: counterfactualForNudge(context, score),
      summary: summarise(product, amount, tenures, score),
    },
  };
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

function summarise(
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
  return `${rupees(amount)} scored ${score}/100 for instalment credit. ${
    product.partner
  } can cover it in ${best.months} instalments of ${rupees(best.emi)}${
    best.noCost ? ' at no extra cost' : ''
  }.`;
}

/** What would have had to be different for this nudge *not* to appear. */
function counterfactualForNudge(context: GateContext, score: number): string {
  const headroom = score - NUDGE_SCORE_THRESHOLD;
  const parts: string[] = [];

  parts.push(
    `Below ${rupees(AMOUNT_FLOOR)}, or in an everyday category like groceries or fuel, this would not have been shown.`,
  );

  if (context.profile.eligibilitySignal < ELIGIBILITY_THRESHOLD + 15) {
    parts.push(
      `The eligibility signal of ${context.profile.eligibilitySignal} is close to the cut-off of ${ELIGIBILITY_THRESHOLD}.`,
    );
  }
  if (headroom < 10) {
    parts.push(`The score cleared the bar by only ${headroom} points.`);
  }
  if (context.fundingProducts.length > 1) {
    parts.push(
      `Crossing ${rupees(CARD_PREFERENCE_THRESHOLD)} switches the recommendation between Postpaid and the card.`,
    );
  }
  return parts.join(' ');
}

/** What would have to change for a blocked decision to become an offer. */
function counterfactualForBlock(gate: GateId, context: GateContext): string {
  const { amount, profile } = context;

  switch (gate) {
    case 'CATEGORY_PROHIBITED':
      return 'No amount and no eligibility signal would change this — the category is blocked outright.';
    case 'MERCHANT_NOT_ENABLED':
      return 'The same purchase at a merchant inside the credit network would be assessed normally.';
    case 'AMOUNT_FLOOR':
      return `At ${rupees(AMOUNT_FLOOR)} or above, this transaction would be assessed instead of skipped.`;
    case 'AMOUNT_CEILING':
      return `At ${rupees(2_00_000)} or below, this would be assessed against the user's available limits.`;
    case 'CATEGORY_RELEVANCE':
      return 'The same amount spent on electronics, travel or jewellery would clear the relevance floor.';
    case 'OPTED_OUT':
      return 'Only the user reversing their opt-out would change this.';
    case 'COLD_START':
      return `At 90 days and 25 transactions of history the signal becomes meaningful; this user is at ${profile.features.accountAgeDays} days and ${profile.features.txnCount}.`;
    case 'NOT_ELIGIBLE':
      return `The signal would need to reach ${ELIGIBILITY_THRESHOLD}; it currently sits at ${profile.eligibilitySignal}, held back most by ${weakestComponent(profile)}.`;
    case 'BANK_COOLOFF':
      return 'Once the 30-day cooling-off elapses, this user is assessed normally again.';
    case 'FREQUENCY_CAP':
      return 'Once the 7-day window elapses, this user becomes eligible to be asked again.';
    case 'NO_PRODUCT':
      return 'This user is not pre-approved for any product — approval is the partner bank’s decision, not ours.';
    case 'ALREADY_ACTIVE':
      return 'Selecting a different payment method would make the offer relevant again.';
    case 'INSUFFICIENT_LIMIT': {
      const best = context.eligibleProducts.reduce(
        (highest, product) => Math.max(highest, product.available),
        0,
      );
      return `At ${rupees(best)} or below, the existing limit would cover this purchase in full.`;
    }
    case 'AFFORDABILITY': {
      // An instalment is directly proportional to the principal at a fixed rate
      // and tenure, so the affordable principal scales the same way.
      const affordablePrincipal =
        (amount * profile.features.affordabilityCapacity) / context.minAchievableEmi;
      return `The same purchase at roughly ${rupees(
        affordablePrincipal,
      )} or less would fit within this user's assessed capacity, using the longest plan available to them.`;
    }
    default:
      return `Amount ${rupees(amount)} in ${context.category}.`;
  }
}

function weakestComponent(profile: UserProfile): string {
  const weakest = profile.eligibilityBreakdown.reduce((lowest, component) =>
    component.points / component.max < lowest.points / lowest.max ? component : lowest,
  );
  return `${weakest.label.toLowerCase()} (${weakest.points}/${weakest.max})`;
}

function weakestFactorHint(factors: DecisionTrace['factors']): string {
  const weakest = factors.reduce((lowest, factor) =>
    factor.points / factor.weight < lowest.points / lowest.weight ? factor : lowest,
  );
  return `The score was held back most by ${weakest.label.toLowerCase()} (${weakest.points}/${
    weakest.weight
  }). ${weakest.detail}.`;
}

/** Re-export so callers can surface the same gate results the engine used. */
export type { GateResult };
