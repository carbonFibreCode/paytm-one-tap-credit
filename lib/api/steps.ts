/**
 * The engine, exposed as individual stages.
 *
 * `/api/decide` runs the whole pipeline in one call and stays the fallback path.
 * These stages exist so an n8n workflow can run the *same* functions as separate
 * visible steps — memory, gates, score, offer — with every branch and every
 * failure showing up as a node on the canvas.
 *
 * Crucially these are thin wrappers, not a second implementation. The logic is
 * the same pure, tested code `decide()` uses, so the orchestrated path and the
 * direct path can never disagree.
 */

import { z } from 'zod';
import type { MerchantCategory, UserProfile } from '../types';

export const categoryEnum = z.enum([
  'electronics', 'travel', 'jewellery', 'apparel', 'healthcare',
  'grocery', 'fuel', 'bills', 'p2p', 'wallet_load', 'gambling', 'crypto',
]);

export const rupees = z
  .number()
  .int('must be a whole number of rupees')
  .positive('must be greater than zero')
  .max(1_00_00_000, 'is implausibly large');

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

export const nudgeHistoryShape = z
  .array(
    z.object({
      product: z.enum(['postpaid', 'card']),
      decidedAt: z.string(),
      outcome: z.enum(['shown', 'accepted', 'declined']),
    }),
  )
  .optional()
  .default([]);

/** Prior outcomes recalled from the memory layer, used to temper relevance. */
export const memoryShape = z
  .object({
    acceptedCount: z.number().int().min(0).default(0),
    declinedCount: z.number().int().min(0).default(0),
    /** Categories this user has previously declined an offer in. */
    declinedCategories: z.array(categoryEnum).default([]),
    source: z.string().default('none'),
  })
  .optional();

export type MemoryContext = z.infer<typeof memoryShape>;

export function badRequest(error: z.ZodError): { error: string } {
  const issue = error.issues[0];
  const field = issue.path.join('.');
  return { error: field ? `\`${field}\` ${issue.message}` : issue.message };
}

export type { MerchantCategory };
