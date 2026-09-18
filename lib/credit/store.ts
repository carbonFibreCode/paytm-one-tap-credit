/**
 * The credit ledger — payments, the accounts they opened, and the instalments
 * that repay them.
 *
 * Before this existed, accepting an offer changed nothing: the next scan of the
 * same merchant produced the same offer. Now a payment on credit writes the
 * account and its full schedule in one batch, and `liveCredit()` reads them
 * back so the profile builder can tighten the next affordability check.
 *
 * Two rules, inherited from the audit trail:
 *
 *   1. The engine never calls this. Routes read live credit and pass it into
 *      `buildProfile()` as an input, so a decision is still a function of its
 *      inputs alone.
 *   2. Only `liveCreditOrEmpty()` is safe to call in a decision path. Everything
 *      else throws, and the caller decides what the fallback is.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { db, withTimeout } from '../db/client';
import {
  creditAccounts,
  emiInstallments,
  insertCreditAccountSchema,
  insertInstallmentSchema,
  insertPaymentSchema,
  paymentIntents,
  payments,
} from '../db/schema';
import { buildSchedule } from '../engine/emi';
import { errorInfo, log } from '../log';
import { NO_LIVE_CREDIT } from '../personas';
import type { EmiOption, LiveCredit, ProductId, RecurringObligation } from '../types';

export type PaymentMethod = 'upi' | 'wallet' | 'postpaid' | 'card';

export interface RecordPaymentInput {
  userId: string;
  merchantId: string;
  merchantName: string;
  /** The decision this payment answered, when there was one. */
  decisionKey?: string | null;
  /** The scanned intent this payment settles; it is marked paid in the same batch. */
  intentRef?: string | null;
  amount: number;
  method: PaymentMethod;
  partner?: string | null;
  /** Present when the payment went on credit; opens the account. */
  tenure?: EmiOption | null;
  /** ISO timestamp of the payment. */
  at: string;
}

export interface RecordedPayment {
  paymentId: string;
  accountId: string | null;
  installments: number;
}

const DEFAULT_PARTNER: Record<ProductId, string> = {
  postpaid: 'Paytm Postpaid',
  card: 'Credit Card',
};

/**
 * Write a payment and, when it was on credit, the account and schedule that
 * repay it — atomically, so a credit payment can never exist without its plan.
 * Returns null when no database is configured.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<RecordedPayment | null> {
  const client = db();
  if (!client) return null;

  const paymentId = randomUUID();
  const payment = insertPaymentSchema.parse({
    id: paymentId,
    userId: input.userId,
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    decisionKey: input.decisionKey ?? null,
    intentRef: input.intentRef ?? null,
    amount: input.amount,
    method: input.method,
    partner: input.partner ?? null,
    paidAt: input.at,
  });

  // Everything for this payment lands in one batch — one transaction on Neon.
  const statements: BatchItem<'pg'>[] = [client.insert(payments).values(payment)];
  if (input.intentRef) {
    statements.push(
      client
        .update(paymentIntents)
        .set({ status: 'paid', paidAt: new Date(input.at) })
        .where(eq(paymentIntents.ref, input.intentRef)),
    );
  }

  const product: ProductId | null =
    input.method === 'postpaid' || input.method === 'card' ? input.method : null;
  if (!product || !input.tenure) {
    await withTimeout(client.batch(statements as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]));
    return { paymentId, accountId: null, installments: 0 };
  }

  // The invariant the whole EMI story rests on: the schedule repays exactly
  // principal plus interest, rupee for rupee. Refuse to store anything else.
  const tenure = input.tenure;
  const schedule = buildSchedule(tenure);
  const scheduled = schedule.reduce((sum, row) => sum + row.amount, 0);
  if (scheduled !== tenure.total || tenure.total - tenure.interest !== input.amount) {
    throw new Error(
      `schedule sums to ${scheduled} against a plan total of ${tenure.total} for a principal of ${input.amount}`,
    );
  }

  const accountId = randomUUID();
  const account = insertCreditAccountSchema.parse({
    id: accountId,
    userId: input.userId,
    paymentId,
    product,
    partner: input.partner ?? DEFAULT_PARTNER[product],
    principal: input.amount,
    tenureMonths: tenure.months,
    interest: tenure.interest,
    noCost: tenure.noCost,
    status: 'active',
    openedAt: input.at,
  });
  const rows = schedule.map((row) =>
    insertInstallmentSchema.parse({ accountId, seq: row.index, dueDate: row.date, amount: row.amount }),
  );

  statements.push(
    client.insert(creditAccounts).values(account),
    client.insert(emiInstallments).values(rows),
  );
  await withTimeout(client.batch(statements as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]));
  return { paymentId, accountId, installments: rows.length };
}

/**
 * What this user is carrying on accounts opened here: the next instalment on
 * each active account, and the unpaid balance per product.
 */
export async function liveCredit(userId: string): Promise<LiveCredit> {
  const client = db();
  if (!client) return NO_LIVE_CREDIT;

  const accounts = await withTimeout(
    client.query.creditAccounts.findMany({
      where: and(eq(creditAccounts.userId, userId), eq(creditAccounts.status, 'active')),
      with: { installments: { orderBy: [asc(emiInstallments.seq)] } },
    }),
  );

  const outstanding: Record<ProductId, number> = { postpaid: 0, card: 0 };
  const obligations: RecurringObligation[] = [];

  for (const account of accounts) {
    const pending = account.installments.filter((row) => row.status !== 'paid');
    const next = pending[0];
    if (!next) continue;
    // What is still owed holds the limit, not just the principal — a no-cost
    // plan makes the two identical, an interest-bearing one does not.
    outstanding[account.product] += pending.reduce((sum, row) => sum + row.amount, 0);
    obligations.push({
      merchant: `${account.partner} EMI`,
      amount: next.amount,
      category: 'emi',
      occurrences: account.installments.length - pending.length,
      source: 'account',
    });
  }

  return { obligations, outstanding };
}

/**
 * The only credit read allowed in a decision path. An unreachable database
 * reads as "no live credit" — exactly what the engine saw before it existed.
 */
export async function liveCreditOrEmpty(userId: string): Promise<LiveCredit> {
  try {
    return await liveCredit(userId);
  } catch (error) {
    // The decision proceeds on seed-derived capacity, exactly as it did before
    // the credit ledger existed.
    log.warn({ event: 'credit.read_failed', userId, ...errorInfo(error) });
    return NO_LIVE_CREDIT;
  }
}

/** Every payment, newest first, with the account and schedule it opened. */
export async function listPayments(userId: string) {
  const client = db();
  if (!client) return [];
  return withTimeout(
    client.query.payments.findMany({
      where: eq(payments.userId, userId),
      orderBy: [desc(payments.paidAt)],
      with: { creditAccount: { with: { installments: { orderBy: [asc(emiInstallments.seq)] } } } },
    }),
  );
}

/**
 * Demo reset: forget everything this user paid and borrowed here. The decision
 * trail is untouched — it is append-only, and a reset is not a reason to edit
 * history.
 */
export async function clearUser(userId: string): Promise<void> {
  const client = db();
  if (!client) return;
  const accountIds = client
    .select({ id: creditAccounts.id })
    .from(creditAccounts)
    .where(eq(creditAccounts.userId, userId));
  await withTimeout(
    client.batch([
      client.delete(emiInstallments).where(inArray(emiInstallments.accountId, accountIds)),
      client.delete(creditAccounts).where(eq(creditAccounts.userId, userId)),
      client.delete(payments).where(eq(payments.userId, userId)),
    ]),
  );
}
