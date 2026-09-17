/**
 * Request validation for the public API.
 *
 * These endpoints are called by n8n as well as our own UI, so they fail loudly
 * and specifically rather than letting a malformed amount reach the engine and
 * produce a confident wrong answer.
 *
 * Shape checking is Zod's job. What stays hand-written is the part Zod cannot
 * express: resolving a merchant from the catalogue, and the 404-vs-400
 * distinction between "malformed" and "well-formed but unknown".
 */

import { z } from 'zod';
import type { DecisionRequest, Language, MerchantCategory } from '../types';
import { getMerchant, type Merchant } from '../merchants';
import { getPersona } from '../personas';

export type Validated<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const CATEGORIES = [
  'electronics', 'travel', 'jewellery', 'apparel', 'healthcare',
  'grocery', 'fuel', 'bills', 'p2p', 'wallet_load', 'gambling', 'crypto',
] as const;

const category = z.enum(CATEGORIES);
const language = z.enum(['en', 'hi', 'ta', 'bn']);
const instrument = z.enum(['upi', 'debit_card', 'credit_card', 'postpaid', 'netbanking']);

/** ₹1 crore — beyond any plausible checkout. */
const MAX_SAFE_AMOUNT = 1_00_00_000;

const rupees = z
  .number({ message: 'must be a number' })
  .int('must be a whole number of rupees')
  .positive('must be greater than zero')
  .max(MAX_SAFE_AMOUNT, 'is implausibly large');

const isoTimestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'must be an ISO timestamp',
});

const historyEntry = z.object({
  product: z.enum(['postpaid', 'card']),
  decidedAt: isoTimestamp,
  outcome: z.enum(['shown', 'accepted', 'declined']),
});

/**
 * History is caller-supplied, so a single malformed entry drops rather than
 * failing the whole request — a corrupt localStorage row must not break
 * checkout.
 */
const nudgeHistory = z
  .array(z.unknown())
  .optional()
  .transform((entries) =>
    (entries ?? []).flatMap((entry) => {
      const parsed = historyEntry.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    }),
  );

const decideBody = z.object({
  userId: z.string().min(1, 'is required'),
  amount: rupees,
  transactionId: z.string().min(1).optional(),
  merchantId: z.string().min(1).optional(),
  merchantName: z.string().min(1).optional(),
  merchantCategory: category.optional(),
  merchantCreditEnabled: z.boolean().optional(),
  timestamp: isoTimestamp.optional(),
  selectedInstrument: instrument.optional(),
  nudgeHistory,
});

const nudgeTextBody = z.object({
  product: z.enum(['postpaid', 'card']),
  amount: rupees,
  months: z.number().int().min(1).max(36, 'must be a whole number between 1 and 36'),
  emi: rupees,
  merchantCategory: category,
  partner: z.string().min(1).default('Paytm Postpaid'),
  merchantName: z.string().min(1).default('Merchant'),
  noCost: z.boolean().default(false),
  language: language.default('en'),
});

/** First Zod issue, rendered the way the rest of the API reports errors. */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = issue.path.join('.');
  return field ? `\`${field}\` ${issue.message}` : issue.message;
}

export interface DecideInputs {
  request: DecisionRequest;
  merchantCreditEnabled: boolean;
  merchant: Merchant | null;
}

/**
 * Parse a `/api/decide` body.
 *
 * The merchant may be given as a known `merchantId`, or as a `merchantName` +
 * `merchantCategory` pair so an n8n workflow can pass through a transaction we
 * have no catalogue entry for.
 */
export function parseDecideRequest(body: unknown, now: string): Validated<DecideInputs> {
  const parsed = decideBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: firstIssue(parsed.error) };
  }

  const input = parsed.data;

  if (!getPersona(input.userId)) {
    return { ok: false, status: 404, error: `Unknown userId \`${input.userId}\`` };
  }

  let merchant: Merchant | null = null;
  let merchantName: string;
  let merchantCategory: MerchantCategory;
  let merchantCreditEnabled: boolean;

  if (input.merchantId) {
    const found = getMerchant(input.merchantId);
    if (!found) {
      return { ok: false, status: 404, error: `Unknown merchantId \`${input.merchantId}\`` };
    }
    merchant = found;
    merchantName = found.name;
    merchantCategory = found.category;
    merchantCreditEnabled = found.creditEnabled;
  } else if (input.merchantCategory) {
    merchantCategory = input.merchantCategory;
    merchantName = input.merchantName ?? 'Merchant';
    // Merchants outside the catalogue are assumed to be in the credit network;
    // the catalogue is the only place an opted-out merchant is modelled.
    merchantCreditEnabled = input.merchantCreditEnabled !== false;
  } else {
    return {
      ok: false,
      status: 400,
      error: `Provide a known \`merchantId\`, or a \`merchantCategory\` from: ${CATEGORIES.join(', ')}`,
    };
  }

  return {
    ok: true,
    value: {
      merchant,
      merchantCreditEnabled,
      request: {
        transactionId: input.transactionId ?? `txn_${input.userId}_${input.amount}`,
        userId: input.userId,
        amount: input.amount,
        merchantId: input.merchantId ?? 'm_unknown',
        merchantName,
        merchantCategory,
        timestamp: input.timestamp ?? now,
        selectedInstrument: input.selectedInstrument,
        nudgeHistory: input.nudgeHistory,
      },
    },
  };
}

export type NudgeTextInputs = z.infer<typeof nudgeTextBody> & {
  merchantCategory: MerchantCategory;
  language: Language;
};

export function parseNudgeTextRequest(body: unknown): Validated<NudgeTextInputs> {
  const parsed = nudgeTextBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: firstIssue(parsed.error) };
  }
  return { ok: true, value: parsed.data };
}
