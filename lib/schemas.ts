/**
 * Zod primitives, derived from `lib/domain.ts`.
 *
 * Every request body and every database boundary composes these rather than
 * spelling an enum out again, so a validator can never accept a value the
 * types do not know, or reject one they do.
 */

import { z } from 'zod';
import {
  INSTRUMENTS,
  LANGUAGES,
  MAX_SAFE_AMOUNT,
  MERCHANT_CATEGORIES,
  NUDGE_OUTCOMES,
  PAYMENT_METHODS,
  PRODUCT_IDS,
} from './domain';

export const merchantCategory = z.enum(MERCHANT_CATEGORIES);
export const productId = z.enum(PRODUCT_IDS);
export const language = z.enum(LANGUAGES);
export const instrument = z.enum(INSTRUMENTS);
export const nudgeOutcome = z.enum(NUDGE_OUTCOMES);
export const paymentMethod = z.enum(PAYMENT_METHODS);

/** Whole, positive rupees — money is integer everywhere in this codebase. */
export const rupees = z
  .number({ message: 'must be a number' })
  .int('must be a whole number of rupees')
  .positive('must be greater than zero')
  .max(MAX_SAFE_AMOUNT, 'is implausibly large');

export const isoTimestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'must be an ISO timestamp',
});

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date');

/** An instalment plan exactly as the engine offered it — see `EmiOption`. */
export const emiOption = z.object({
  months: z.number().int().min(1).max(36, 'must be a whole number between 1 and 36'),
  emi: rupees,
  lastEmi: rupees,
  total: rupees,
  interest: z.number().int().nonnegative(),
  noCost: z.boolean(),
  firstDueDate: isoDate,
});

export const nudgeHistoryEntry = z.object({
  product: productId,
  decidedAt: isoTimestamp,
  outcome: nudgeOutcome,
});

/**
 * History is caller-supplied (localStorage), so a single malformed entry drops
 * rather than failing the whole request — a corrupt row must not break checkout.
 */
export const nudgeHistory = z
  .array(z.unknown())
  .optional()
  .transform((entries) =>
    (entries ?? []).flatMap((entry) => {
      const parsed = nudgeHistoryEntry.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    }),
  );

/** First issue, rendered the way the whole API reports errors: `` `field` message ``. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = issue.path.join('.');
  return field ? `\`${field}\` ${issue.message}` : issue.message;
}
