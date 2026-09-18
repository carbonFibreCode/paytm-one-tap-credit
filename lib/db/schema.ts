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

import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { isoDate, isoTimestamp } from '../schemas';
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

// --- payment intents: what a QR code actually is -----------------------------
// A QR is a deterministic rendering of a `upi://pay?…` string; the row here is
// the thing it points to. The image is never stored — `/api/intents/[ref]/qr`
// renders it from `payload` on demand, and `payload` is stored byte-for-byte
// so a scanned code can be compared to what was issued.

export const intentKindEnum = pgEnum('intent_kind', ['static', 'dynamic']);
export const intentStatusEnum = pgEnum('intent_status', ['created', 'scanned', 'paid', 'expired']);

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** The `tr` parameter. One per merchant for static codes; one per bill for dynamic. */
    ref: text().notNull().unique(),
    merchantId: text().notNull(),
    vpa: text().notNull(),
    mcc: text().notNull(),
    kind: intentKindEnum().notNull(),
    /** Fixed on a dynamic code; null on a static one, where the customer enters it. */
    amount: integer(),
    currency: text().notNull().default('INR'),
    /** The exact signed string encoded in the QR. */
    payload: text().notNull(),
    signature: text().notNull(),
    status: intentStatusEnum().notNull().default('created'),
    /** Dynamic codes expire; static ones never do. */
    expiresAt: timestamp({ withTimezone: true, mode: 'string' }),
    createdAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
    scannedAt: timestamp({ withTimezone: true, mode: 'string' }),
    paidAt: timestamp({ withTimezone: true, mode: 'string' }),
    /** The decision this scan led to — links the intent into the audit trail. */
    decisionKey: text(),
  },
  (table) => [index('payment_intents_merchant_kind_idx').on(table.merchantId, table.kind)],
);

// --- money: payments and the credit they opened ------------------------------
// This is the part of the system that did not exist before the database: what
// happened *after* an offer was accepted. A credit account and its instalment
// schedule are written in one batch with the payment, so there is never a
// payment on credit without the schedule that repays it.

export const paymentMethodEnum = pgEnum('payment_method', ['upi', 'wallet', 'postpaid', 'card']);
export const creditProductEnum = pgEnum('credit_product', ['postpaid', 'card']);
export const accountStatusEnum = pgEnum('account_status', ['active', 'closed']);
export const installmentStatusEnum = pgEnum('installment_status', ['due', 'paid', 'late']);

export const payments = pgTable(
  'payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text().notNull(),
    merchantId: text().notNull(),
    merchantName: text().notNull(),
    /** The decision this payment answered, when there was one. */
    decisionKey: text(),
    /** The scanned intent this payment settled. Linked by value, like `decisionKey`. */
    intentRef: text(),
    amount: integer().notNull(),
    method: paymentMethodEnum().notNull(),
    partner: text(),
    paidAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('payments_user_paid_idx').on(table.userId, table.paidAt)],
);

export const creditAccounts = pgTable(
  'credit_accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text().notNull(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id),
    product: creditProductEnum().notNull(),
    partner: text().notNull(),
    principal: integer().notNull(),
    tenureMonths: integer().notNull(),
    /** Total interest over the tenure; zero on a no-cost plan. */
    interest: integer().notNull().default(0),
    noCost: boolean().notNull().default(false),
    status: accountStatusEnum().notNull().default('active'),
    openedAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('credit_accounts_user_status_idx').on(table.userId, table.status)],
);

export const emiInstallments = pgTable(
  'emi_installments',
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => creditAccounts.id),
    /** 1-based position in the schedule. */
    seq: integer().notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    amount: integer().notNull(),
    status: installmentStatusEnum().notNull().default('due'),
    paidAt: timestamp({ withTimezone: true, mode: 'string' }),
  },
  (table) => [unique('emi_installments_account_seq').on(table.accountId, table.seq)],
);

export const paymentsRelations = relations(payments, ({ one }) => ({
  creditAccount: one(creditAccounts, {
    fields: [payments.id],
    references: [creditAccounts.paymentId],
  }),
}));

export const creditAccountsRelations = relations(creditAccounts, ({ one, many }) => ({
  payment: one(payments, { fields: [creditAccounts.paymentId], references: [payments.id] }),
  installments: many(emiInstallments),
}));

export const emiInstallmentsRelations = relations(emiInstallments, ({ one }) => ({
  account: one(creditAccounts, {
    fields: [emiInstallments.accountId],
    references: [creditAccounts.id],
  }),
}));

// --- validation at the database boundary ------------------------------------
// Derived from the tables so the two can never drift. Refinements add what a
// column type cannot say: an ISO timestamp, a whole-rupee amount, a 0–100 score.

// Overrides use the callback form throughout: a bare schema would replace the
// column's own nullability, silently turning an optional column into a required one.
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

export const insertPaymentSchema = createInsertSchema(payments, {
  userId: (schema) => schema.min(1),
  merchantId: (schema) => schema.min(1),
  merchantName: (schema) => schema.min(1),
  amount: (schema) => schema.positive(),
  paidAt: () => isoTimestamp,
});

export const insertCreditAccountSchema = createInsertSchema(creditAccounts, {
  userId: (schema) => schema.min(1),
  partner: (schema) => schema.min(1),
  principal: (schema) => schema.positive(),
  tenureMonths: (schema) => schema.min(1).max(36),
  interest: (schema) => schema.nonnegative(),
  openedAt: () => isoTimestamp,
});

export const insertInstallmentSchema = createInsertSchema(emiInstallments, {
  seq: (schema) => schema.min(1),
  amount: (schema) => schema.positive(),
  dueDate: () => isoDate,
});

export const insertIntentSchema = createInsertSchema(paymentIntents, {
  ref: (schema) => schema.min(4),
  merchantId: (schema) => schema.min(1),
  vpa: (schema) => schema.includes('@'),
  mcc: (schema) => schema.regex(/^\d{4}$/),
  amount: (schema) => schema.positive(),
  payload: (schema) => schema.startsWith('upi://pay?'),
  signature: (schema) => schema.min(16),
  createdAt: () => isoTimestamp,
  expiresAt: () => isoTimestamp.nullable(),
});

export type IntentRow = typeof paymentIntents.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type CreditAccountRow = typeof creditAccounts.$inferSelect;
export type InstallmentRow = typeof emiInstallments.$inferSelect;

export type DecisionRow = typeof decisions.$inferSelect;
export type NewDecision = z.infer<typeof insertDecisionSchema>;
export type NudgeEventRow = typeof nudgeEvents.$inferSelect;
export type NewNudgeEvent = z.infer<typeof insertNudgeEventSchema>;
