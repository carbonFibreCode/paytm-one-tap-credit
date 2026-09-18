/**
 * Request shapes for the public API.
 *
 * These endpoints are called by n8n as well as our own UI, so they fail loudly
 * and specifically rather than letting a malformed amount reach the engine and
 * produce a confident wrong answer.
 *
 * Shape checking is Zod's job, composed from the primitives in `lib/schemas.ts`
 * so no enum is ever spelled out twice. What stays hand-written is the part Zod
 * cannot express: resolving a merchant from the catalogue, and the 404-vs-400
 * distinction between "malformed" and "well-formed but unknown".
 */

import { z } from 'zod';
import type { DecisionRequest, MerchantCategory, UserProfile } from '../types';
import { MERCHANT_CATEGORIES } from '../domain';
import {
  emiOption,
  instrument,
  isoTimestamp,
  language,
  merchantCategory,
  nudgeHistory,
  nudgeOutcome,
  paymentMethod,
  productId,
  rupees,
} from '../schemas';
import { getMerchant, type Merchant } from '../merchants';
import { getPersona } from '../personas';
import { ApiError, unknown as unknownEntity } from './route';

export { emiOption, instrument, isoTimestamp, language, merchantCategory, nudgeHistory, nudgeOutcome, paymentMethod, productId, rupees };

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

export const decideBody = z.object({
  userId: z.string().min(1, 'is required'),
  amount: rupees,
  transactionId: z.string().min(1).optional(),
  merchantId: z.string().min(1).optional(),
  merchantName: z.string().min(1).optional(),
  merchantCategory: merchantCategory.optional(),
  merchantCreditEnabled: z.boolean().optional(),
  timestamp: isoTimestamp.optional(),
  selectedInstrument: instrument.optional(),
  nudgeHistory,
  intentRef: z.string().min(1).optional(),
});

export const nudgeTextBody = z.object({
  product: productId,
  amount: rupees,
  months: z.number().int().min(1).max(36, 'must be a whole number between 1 and 36'),
  emi: rupees,
  merchantCategory,
  partner: z.string().min(1).default('Paytm Postpaid'),
  merchantName: z.string().min(1).default('Merchant'),
  noCost: z.boolean().default(false),
  language: language.default('en'),
});

export const paymentBody = z.object({
  userId: z.string().min(1),
  merchantId: z.string().min(1),
  merchantName: z.string().min(1).optional(),
  decisionKey: z.string().min(1).optional(),
  intentRef: z.string().min(1).optional(),
  amount: rupees,
  method: paymentMethod,
  partner: z.string().min(1).optional(),
  tenure: emiOption.optional(),
  at: isoTimestamp.optional(),
});

export const auditBody = z.object({
  type: z.enum(['decision', 'outcome']).default('decision'),
  transactionId: z.string().min(1),
  userId: z.string().min(1),
  userName: z.string().optional(),
  amount: z.number().int().optional(),
  merchantName: z.string().optional(),
  merchantCategory: z.string().optional(),
  showNudge: z.boolean().optional(),
  product: z.string().nullable().optional(),
  score: z.number().optional(),
  eligibilitySignal: z.number().optional(),
  blockedBy: z.string().nullable().optional(),
  blockedReason: z.string().nullable().optional(),
  servedBy: z.string().optional(),
  latencyMs: z.number().nullable().optional(),
  outcome: nudgeOutcome.optional(),
  nudgeSource: z.string().optional(),
  /** The engine's own breakdown, passed through whole; shape is the engine's to define. */
  trace: z.custom<Record<string, unknown>>((value) => typeof value === 'object' && value !== null).optional(),
  engineVersion: z.string().optional(),
  /** Supplied by the caller so the entry reflects when the decision happened. */
  at: isoTimestamp.optional(),
});

export const rememberBody = z.object({
  userId: z.string().min(1),
  transactionId: z.string().min(1),
  product: z.string().nullable().default(null),
  merchantCategory: z.string().optional(),
  outcome: nudgeOutcome,
  at: isoTimestamp.optional(),
});

export const recallBody = z.object({
  userId: z.string().min(1),
  /** Wait for Cognee instead of serving the cache — for warm-ups, not checkout. */
  warm: z.boolean().optional().default(false),
});

export const intentBody = z.object({
  merchantId: z.string().min(1),
  amount: rupees,
  ttlMinutes: z.number().int().min(1).max(24 * 60).optional(),
});

export const scanBody = z.object({ payload: z.string().min(1) });
export const attachBody = z.object({ decisionKey: z.string().min(1) });

// ---------------------------------------------------------------------------
// Staged-engine shapes (the profile makes a round trip through n8n)
// ---------------------------------------------------------------------------

/**
 * The profile travels between stages as plain JSON. It is our own object making
 * a round trip through n8n, so it is accepted structurally rather than re-parsed
 * field by field — but it must at least be shaped like a profile.
 */
export const profileShape = z
  .object({
    userId: z.string(),
    products: z.array(z.unknown()),
    features: z.object({}).loose(),
    eligibilitySignal: z.number(),
    eligibilityBreakdown: z.array(z.unknown()),
  })
  .loose()
  .transform((value) => value as unknown as UserProfile);

export const nudgeHistoryShape = z.array(
  z.object({ product: productId, decidedAt: z.string(), outcome: nudgeOutcome }),
).optional().default([]);

/** Prior outcomes recalled from the memory layer, used to temper relevance. */
export const memoryShape = z
  .object({
    acceptedCount: z.number().int().min(0).default(0),
    declinedCount: z.number().int().min(0).default(0),
    /** Categories this user has previously declined an offer in. */
    declinedCategories: z.array(merchantCategory).default([]),
    source: z.string().default('none'),
  })
  .optional();

export const productShape = z.object({
  id: productId,
  eligible: z.boolean(),
  active: z.boolean(),
  limit: z.number(),
  available: z.number(),
  partner: z.string(),
});

export const gatesBody = z.object({
  profile: profileShape,
  amount: rupees,
  merchantId: z.string().optional(),
  merchantCategory: merchantCategory.optional(),
  merchantName: z.string().optional(),
  merchantCreditEnabled: z.boolean().optional(),
  timestamp: z.string().optional(),
  selectedInstrument: instrument.optional(),
  nudgeHistory: nudgeHistoryShape,
});

export const scoreBody = z.object({
  profile: profileShape,
  amount: rupees,
  merchantCategory,
  memory: memoryShape,
});

export const offerBody = z.object({
  profile: profileShape,
  amount: rupees,
  merchantCategory,
  timestamp: z.string().optional(),
  fundingProducts: z.array(productShape).min(1, 'must contain at least one product'),
  eligibleProducts: z.array(productShape).optional().default([]),
});

export const engineProfileBody = z.object({
  userId: z.string().min(1),
  timestamp: z.string().optional(),
  /** Ledger rows are bulky; the workflow only needs them when showing the chain. */
  includeLedger: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// Resolution — the part Zod cannot do
// ---------------------------------------------------------------------------

export interface DecideInputs {
  request: DecisionRequest;
  merchantCreditEnabled: boolean;
  merchant: Merchant | null;
}

/**
 * Turn a validated `/api/decide` body into engine inputs.
 *
 * The merchant may be given as a known `merchantId`, or as a `merchantName` +
 * `merchantCategory` pair so an n8n workflow can pass through a transaction we
 * have no catalogue entry for. Throws `ApiError` for the 404 and 400 cases.
 */
export function resolveDecideRequest(
  input: z.output<typeof decideBody>,
  now: string,
): DecideInputs {
  if (!getPersona(input.userId)) throw unknownEntity('userId', input.userId);

  let merchant: Merchant | null = null;
  let merchantName: string;
  let category: MerchantCategory;
  let merchantCreditEnabled: boolean;

  if (input.merchantId) {
    const found = getMerchant(input.merchantId);
    if (!found) throw unknownEntity('merchantId', input.merchantId);
    merchant = found;
    merchantName = found.name;
    category = found.category;
    merchantCreditEnabled = found.creditEnabled;
  } else if (input.merchantCategory) {
    category = input.merchantCategory;
    merchantName = input.merchantName ?? 'Merchant';
    // Merchants outside the catalogue are assumed to be in the credit network;
    // the catalogue is the only place an opted-out merchant is modelled.
    merchantCreditEnabled = input.merchantCreditEnabled !== false;
  } else {
    throw new ApiError(
      `Provide a known \`merchantId\`, or a \`merchantCategory\` from: ${MERCHANT_CATEGORIES.join(', ')}`,
      400,
    );
  }

  return {
    merchant,
    merchantCreditEnabled,
    request: {
      transactionId: input.transactionId ?? `txn_${input.userId}_${input.amount}`,
      userId: input.userId,
      amount: input.amount,
      merchantId: input.merchantId ?? 'm_unknown',
      merchantName,
      merchantCategory: category,
      timestamp: input.timestamp ?? now,
      selectedInstrument: input.selectedInstrument,
      nudgeHistory: input.nudgeHistory,
      intentRef: input.intentRef,
    },
  };
}

export type NudgeTextInputs = z.output<typeof nudgeTextBody>;
