/**
 * Hard gates.
 *
 * These run in order and short-circuit: the first failure decides the outcome,
 * and no score can override one. Each gate returns the sentence that explains
 * it, which is what the audit trail and the "Why am I seeing this?" panel show.
 *
 * The ordering is deliberate — it reads top-down from "this transaction can
 * never carry credit" through "this user shouldn't be asked right now" to
 * "we have nothing that fits".
 */

import type {
  GateId,
  GateResult,
  Instrument,
  MerchantCategory,
  NudgeHistoryEntry,
  ProductState,
  UserProfile,
} from '../types';
import { daysBetween } from '../dates';

// --- thresholds ------------------------------------------------------------

/** Below this, a credit offer is noise. */
export const AMOUNT_FLOOR = 2_000;
/** Above this, nothing we distribute can fund the purchase. */
export const AMOUNT_CEILING = 2_00_000;
/** Minimum derived eligibility signal. */
export const ELIGIBILITY_THRESHOLD = 60;
/** History needed before the signal means anything. */
export const COLD_START_MIN_DAYS = 90;
export const COLD_START_MIN_TXNS = 25;
/** One nudge per user per week, and a declined offer rests for the same period. */
export const FREQUENCY_WINDOW_DAYS = 7;
/** Cooling-off after a partner bank turns an application down. */
export const BANK_COOLOFF_DAYS = 30;
/** A category must clear this to be worth interrupting for. */
export const RELEVANCE_FLOOR = 0.3;

/**
 * How relevant a credit offer is per category. Also feeds the relevance score —
 * the gate uses the floor, the score uses the value.
 */
export const CATEGORY_RELEVANCE: Record<MerchantCategory, number> = {
  electronics: 0.9,
  travel: 0.85,
  jewellery: 0.8,
  healthcare: 0.6,
  apparel: 0.45,
  grocery: 0.15,
  fuel: 0.1,
  bills: 0.15,
  // Prohibited outright — the values exist only for completeness.
  p2p: 0,
  wallet_load: 0,
  gambling: 0,
  crypto: 0,
};

/**
 * Categories that never receive a credit nudge at any amount, for any user.
 *
 * Person-to-person transfers and wallet top-ups are the important ones: pushing
 * borrowed money into them turns a credit line into untraceable cash, which is
 * exactly what lending rules exist to prevent.
 */
export const PROHIBITED_CATEGORIES: MerchantCategory[] = [
  'p2p',
  'wallet_load',
  'gambling',
  'crypto',
];

// --- context ---------------------------------------------------------------

export interface GateContext {
  amount: number;
  category: MerchantCategory;
  merchantCreditEnabled: boolean;
  /** ISO timestamp of the transaction. */
  timestamp: string;
  profile: UserProfile;
  nudgeHistory: NudgeHistoryEntry[];
  selectedInstrument?: Instrument;
  /** Eligible products, regardless of available limit. */
  eligibleProducts: ProductState[];
  /** Eligible products whose available limit actually covers this purchase. */
  fundingProducts: ProductState[];
  /** Smallest instalment achievable across every funding product and tenure. */
  minAchievableEmi: number;
}

interface Gate {
  id: GateId;
  evaluate: (context: GateContext) => { passed: boolean; detail: string };
}

function rupees(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

// --- the gates -------------------------------------------------------------

const GATES: Gate[] = [
  {
    id: 'CATEGORY_PROHIBITED',
    evaluate: ({ category }) => {
      const prohibited = PROHIBITED_CATEGORIES.includes(category);
      return {
        passed: !prohibited,
        detail: prohibited
          ? `${label(category)} can never carry a credit offer — borrowed funds must not be routed into transfers or cash-equivalents`
          : `${label(category)} is not a prohibited category`,
      };
    },
  },
  {
    id: 'MERCHANT_NOT_ENABLED',
    evaluate: ({ merchantCreditEnabled }) => ({
      passed: merchantCreditEnabled,
      detail: merchantCreditEnabled
        ? 'Merchant accepts Paytm credit products'
        : 'Merchant is outside the credit-accepting network',
    }),
  },
  {
    id: 'AMOUNT_FLOOR',
    evaluate: ({ amount }) => ({
      passed: amount >= AMOUNT_FLOOR,
      detail:
        amount >= AMOUNT_FLOOR
          ? `${rupees(amount)} is at or above the ${rupees(AMOUNT_FLOOR)} floor`
          : `${rupees(amount)} is below the ${rupees(AMOUNT_FLOOR)} floor — too small to be worth an instalment plan`,
    }),
  },
  {
    id: 'AMOUNT_CEILING',
    evaluate: ({ amount }) => ({
      passed: amount <= AMOUNT_CEILING,
      detail:
        amount <= AMOUNT_CEILING
          ? `${rupees(amount)} is within the ${rupees(AMOUNT_CEILING)} ceiling`
          : `${rupees(amount)} exceeds the ${rupees(AMOUNT_CEILING)} ceiling — no distributed product can fund it`,
    }),
  },
  {
    id: 'CATEGORY_RELEVANCE',
    evaluate: ({ category }) => {
      const relevance = CATEGORY_RELEVANCE[category];
      return {
        passed: relevance >= RELEVANCE_FLOOR,
        detail:
          relevance >= RELEVANCE_FLOOR
            ? `${label(category)} scores ${relevance.toFixed(2)} on credit relevance`
            : `${label(category)} scores ${relevance.toFixed(2)} — an everyday purchase, where a credit prompt is an interruption rather than a help`,
      };
    },
  },
  {
    id: 'OPTED_OUT',
    evaluate: ({ profile }) => ({
      passed: !profile.optedOut,
      detail: profile.optedOut
        ? 'User has opted out of credit offers — permanent, with no expiry'
        : 'User has not opted out of credit offers',
    }),
  },
  {
    id: 'COLD_START',
    evaluate: ({ profile }) => {
      const { accountAgeDays, txnCount } = profile.features;
      const warm = accountAgeDays >= COLD_START_MIN_DAYS && txnCount >= COLD_START_MIN_TXNS;
      return {
        passed: warm,
        detail: warm
          ? `${accountAgeDays} days and ${txnCount} transactions of history — enough to score`
          : `Only ${accountAgeDays} days and ${txnCount} transactions of history (need ${COLD_START_MIN_DAYS} days and ${COLD_START_MIN_TXNS} transactions) — too little to judge`,
      };
    },
  },
  {
    id: 'NOT_ELIGIBLE',
    evaluate: ({ profile }) => {
      const passed = profile.eligibilitySignal >= ELIGIBILITY_THRESHOLD;
      return {
        passed,
        detail: `Eligibility signal ${profile.eligibilitySignal}/100 ${
          passed ? 'clears' : 'is below'
        } the threshold of ${ELIGIBILITY_THRESHOLD}`,
      };
    },
  },
  {
    id: 'BANK_COOLOFF',
    evaluate: ({ profile, timestamp }) => {
      if (!profile.bankRejectionAt) {
        return { passed: true, detail: 'No recent partner-bank rejection on record' };
      }
      const elapsed = daysBetween(profile.bankRejectionAt, timestamp.slice(0, 10));
      const passed = elapsed >= BANK_COOLOFF_DAYS;
      return {
        passed,
        detail: passed
          ? `Last partner-bank rejection was ${elapsed} days ago, past the ${BANK_COOLOFF_DAYS}-day cooling-off`
          : `Partner bank declined an application ${elapsed} days ago — ${
              BANK_COOLOFF_DAYS - elapsed
            } days of cooling-off remain`,
      };
    },
  },
  {
    id: 'FREQUENCY_CAP',
    evaluate: ({ nudgeHistory, timestamp }) => {
      const today = timestamp.slice(0, 10);
      const recent = nudgeHistory.filter(
        (entry) => daysBetween(entry.decidedAt.slice(0, 10), today) < FREQUENCY_WINDOW_DAYS,
      );
      const declined = recent.find((entry) => entry.outcome === 'declined');
      if (declined) {
        const ago = daysBetween(declined.decidedAt.slice(0, 10), today);
        return {
          passed: false,
          detail: `User declined a credit offer ${
            ago === 0 ? 'earlier today' : `${ago} day${ago === 1 ? '' : 's'} ago`
          } — respecting that for ${FREQUENCY_WINDOW_DAYS} days`,
        };
      }
      const shown = recent.filter((entry) => entry.outcome === 'shown');
      const passed = shown.length === 0;
      return {
        passed,
        detail: passed
          ? `No credit offer shown in the last ${FREQUENCY_WINDOW_DAYS} days`
          : `${shown.length} offer${
              shown.length === 1 ? '' : 's'
            } already shown in the last ${FREQUENCY_WINDOW_DAYS} days — capped at one`,
      };
    },
  },
  {
    id: 'NO_PRODUCT',
    evaluate: ({ eligibleProducts }) => ({
      passed: eligibleProducts.length > 0,
      detail:
        eligibleProducts.length > 0
          ? `${eligibleProducts.length} credit product${
              eligibleProducts.length === 1 ? '' : 's'
            } available to this user`
          : 'User is not pre-approved for any credit product',
    }),
  },
  {
    id: 'ALREADY_ACTIVE',
    evaluate: ({ selectedInstrument, profile }) => {
      const activeIds = profile.products.filter((product) => product.active).map((p) => p.id);
      const alreadyPaying =
        (selectedInstrument === 'postpaid' && activeIds.includes('postpaid')) ||
        (selectedInstrument === 'credit_card' && activeIds.includes('card'));
      return {
        passed: !alreadyPaying,
        detail: alreadyPaying
          ? 'User is already paying with this credit product — nothing to offer'
          : 'User is not currently paying with a Paytm credit product',
      };
    },
  },
  {
    id: 'INSUFFICIENT_LIMIT',
    evaluate: ({ fundingProducts, eligibleProducts, amount }) => {
      if (fundingProducts.length > 0) {
        return {
          passed: true,
          detail: `${fundingProducts.length} product${
            fundingProducts.length === 1 ? '' : 's'
          } can cover ${rupees(amount)} in full`,
        };
      }
      const best = eligibleProducts.reduce(
        (highest, product) => Math.max(highest, product.available),
        0,
      );
      return {
        passed: false,
        detail: `Highest available limit is ${rupees(best)}, short of ${rupees(
          amount,
        )} — a partial offer would leave the payment stranded`,
      };
    },
  },
  {
    id: 'AFFORDABILITY',
    evaluate: ({ profile, minAchievableEmi, amount }) => {
      const capacity = profile.features.affordabilityCapacity;
      const passed = minAchievableEmi <= capacity;
      return {
        passed,
        detail: passed
          ? `Lowest instalment ${rupees(minAchievableEmi)}/month fits within ${rupees(
              capacity,
            )}/month of assessed capacity`
          : `Even the longest plan for ${rupees(amount)} costs ${rupees(
              minAchievableEmi,
            )}/month, above the ${rupees(capacity)}/month this user can carry after ${rupees(
              profile.features.fixedMonthlyOutflow,
            )}/month of existing commitments`,
      };
    },
  },
];

function label(category: MerchantCategory): string {
  const names: Record<MerchantCategory, string> = {
    electronics: 'Electronics',
    travel: 'Travel',
    jewellery: 'Jewellery',
    apparel: 'Apparel',
    healthcare: 'Healthcare',
    grocery: 'Groceries',
    fuel: 'Fuel',
    bills: 'Bill payments',
    p2p: 'Person-to-person transfers',
    wallet_load: 'Wallet top-ups',
    gambling: 'Gaming and betting',
    crypto: 'Crypto purchases',
  };
  return names[category];
}

/**
 * Run every gate in order, stopping at the first failure.
 *
 * Returns the results evaluated so far — including the one that failed — so the
 * audit trail shows what was checked rather than only what went wrong.
 */
export function runGates(context: GateContext): {
  results: GateResult[];
  blockedBy: GateId | null;
  blockedReason: string | null;
} {
  const results: GateResult[] = [];

  for (const gate of GATES) {
    const { passed, detail } = gate.evaluate(context);
    results.push({ id: gate.id, passed, detail });
    if (!passed) {
      return { results, blockedBy: gate.id, blockedReason: detail };
    }
  }

  return { results, blockedBy: null, blockedReason: null };
}
