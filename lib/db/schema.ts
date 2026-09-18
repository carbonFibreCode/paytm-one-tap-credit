/**
 * Database schema — the write side of the system.
 *
 * Only what needs to *outlive a cold start* lives here. Personas, merchants
 * and the seeded ledgers stay in code, because they are reproducible from a
 * user id; the engine keeps reading nothing but its inputs. What the database
 * holds is the record of what the engine decided and what the user did about
 * it — the audit trail slide 11 promises, made durable.
 *
 * `decisions` is append-only. A trigger in the migration rejects UPDATE and
 * DELETE, so the trail cannot be edited after the fact — not by policy, by
 * the database.
 *
 * Money is whole rupees in an `integer`, matching the rest of the codebase.
 * A `numeric(_, 2)` column would reintroduce the fractional drift the no-cost
 * EMI rounding was written to avoid.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { DecisionTrace } from '../types';

export const servedByEnum = pgEnum('served_by', ['n8n', 'direct']);
export const outcomeEnum = pgEnum('nudge_outcome', ['shown', 'accepted', 'declined']);

export const decisions = pgTable(
  'decisions',
  {
    id: uuid().primaryKey().defaultRandom(),
    /**
     * The caller's transaction id (`txn_<user>_<merchant>_<amount>`). It is
     * deterministic on purpose — it is the reproducibility handle — which is
     * exactly why it is not the primary key: two scans of the same amount at
     * the same merchant are two decisions.
     */
    decisionKey: text().notNull(),
    userId: text().notNull(),
    userName: text(),
    amount: integer(),
    merchantName: text(),
    merchantCategory: text(),
    requestedAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
    showNudge: boolean(),
    product: text(),
    score: integer(),
    eligibilitySignal: integer(),
    blockedBy: text(),
    blockedReason: text(),
    servedBy: servedByEnum(),
    latencyMs: integer(),
    /** Gates, factors, rationale and counterfactual — kept whole so an old decision stays explainable. */
    trace: jsonb().$type<DecisionTrace>(),
    engineVersion: text(),
  },
  (table) => [
    index('decisions_user_requested_idx').on(table.userId, table.requestedAt),
    index('decisions_blocked_by_idx').on(table.blockedBy),
    index('decisions_key_idx').on(table.decisionKey),
  ],
);

export const nudgeEvents = pgTable(
  'nudge_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Resolved to the latest decision with the same key at insert time; null when none was logged. */
    decisionId: uuid().references(() => decisions.id),
    decisionKey: text().notNull(),
    userId: text().notNull(),
    product: text(),
    outcome: outcomeEnum().notNull(),
    merchantCategory: text(),
    /** 'sarvam' when the model wrote the copy, 'template' otherwise. */
    nudgeSource: text(),
    occurredAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('nudge_events_user_occurred_idx').on(table.userId, table.occurredAt)],
);

// --- validation at the database boundary ------------------------------------
// Derived from the tables so the two can never drift. Refinements add what a
// column type cannot say: an ISO timestamp, a whole-rupee amount, a 0–100 score.

// Overrides use the callback form throughout: a bare schema would replace the
// column's own nullability, silently turning an optional column into a required one.
const isoTimestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'must be an ISO timestamp',
});

export const insertDecisionSchema = createInsertSchema(decisions, {
  decisionKey: (schema) => schema.min(1),
  userId: (schema) => schema.min(1),
  amount: (schema) => schema.positive(),
  requestedAt: () => isoTimestamp,
  score: (schema) => schema.min(0).max(100),
  eligibilitySignal: (schema) => schema.min(0).max(100),
  latencyMs: (schema) => schema.nonnegative(),
});

export const insertNudgeEventSchema = createInsertSchema(nudgeEvents, {
  decisionKey: (schema) => schema.min(1),
  userId: (schema) => schema.min(1),
  occurredAt: () => isoTimestamp,
});

export type DecisionRow = typeof decisions.$inferSelect;
export type NewDecision = z.infer<typeof insertDecisionSchema>;
export type NudgeEventRow = typeof nudgeEvents.$inferSelect;
export type NewNudgeEvent = z.infer<typeof insertNudgeEventSchema>;
