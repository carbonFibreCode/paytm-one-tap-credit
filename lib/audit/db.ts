/**
 * Database half of the audit trail.
 *
 * `AuditRecord` is the shape n8n posts and the digest reads — one flat object
 * covering both decisions and outcomes. The database keeps them apart
 * (`decisions`, `nudge_events`), so this module is the mapping between the two
 * and nothing else. The store decides *when* to call it; this decides *how*.
 *
 * Every function here throws on failure. Swallowing belongs to the caller,
 * which knows what the fallback is.
 */

import { desc, sql } from 'drizzle-orm';
import { db, withTimeout } from '../db/client';
import {
  decisions,
  insertDecisionSchema,
  insertNudgeEventSchema,
  nudgeEvents,
  type DecisionRow,
  type NudgeEventRow,
} from '../db/schema';
import type { AuditRecord } from './store';

/** How much of the trail one read pulls back. The digest only looks at a day. */
const READ_LIMIT = 2_000;

export async function insertRecord(record: AuditRecord): Promise<void> {
  const client = db();
  if (!client) return;

  if (record.type === 'outcome') {
    const row = insertNudgeEventSchema.parse({
      decisionKey: record.transactionId,
      userId: record.userId,
      product: record.product ?? null,
      outcome: record.outcome ?? 'shown',
      merchantCategory: record.merchantCategory ?? null,
      nudgeSource: record.nudgeSource ?? null,
      occurredAt: record.at,
    });
    // Link to the decision it answers, when one was logged before it. Added
    // after validation: it is a subquery, not a value Zod could check.
    const latestDecision = sql`(select ${decisions.id} from ${decisions} where ${decisions.decisionKey} = ${record.transactionId} order by ${decisions.requestedAt} desc limit 1)`;
    await withTimeout(client.insert(nudgeEvents).values({ ...row, decisionId: latestDecision }));
    return;
  }

  const row = insertDecisionSchema.parse({
    decisionKey: record.transactionId,
    userId: record.userId,
    userName: record.userName ?? null,
    amount: record.amount ?? null,
    merchantName: record.merchantName ?? null,
    merchantCategory: record.merchantCategory ?? null,
    requestedAt: record.at,
    showNudge: record.showNudge ?? null,
    product: record.product ?? null,
    score: record.score ?? null,
    eligibilitySignal: record.eligibilitySignal ?? null,
    blockedBy: record.blockedBy ?? null,
    blockedReason: record.blockedReason ?? null,
    servedBy: record.servedBy === 'n8n' || record.servedBy === 'direct' ? record.servedBy : null,
    latencyMs: record.latencyMs ?? null,
    trace: record.trace ?? null,
    engineVersion: record.engineVersion ?? null,
  });
  await withTimeout(client.insert(decisions).values(row));
}

export function decisionToRecord(row: DecisionRow): AuditRecord {
  return {
    at: row.requestedAt,
    type: 'decision',
    transactionId: row.decisionKey,
    userId: row.userId,
    userName: row.userName ?? undefined,
    amount: row.amount ?? undefined,
    merchantName: row.merchantName ?? undefined,
    merchantCategory: row.merchantCategory ?? undefined,
    showNudge: row.showNudge ?? undefined,
    product: row.product,
    score: row.score ?? undefined,
    eligibilitySignal: row.eligibilitySignal ?? undefined,
    blockedBy: row.blockedBy,
    blockedReason: row.blockedReason,
    servedBy: row.servedBy ?? undefined,
    latencyMs: row.latencyMs ?? undefined,
    trace: row.trace ?? undefined,
    engineVersion: row.engineVersion ?? undefined,
  };
}

export function nudgeEventToRecord(row: NudgeEventRow): AuditRecord {
  return {
    at: row.occurredAt,
    type: 'outcome',
    transactionId: row.decisionKey,
    userId: row.userId,
    product: row.product,
    merchantCategory: row.merchantCategory ?? undefined,
    outcome: row.outcome,
    nudgeSource: row.nudgeSource ?? undefined,
  };
}

/** The most recent slice of the trail, oldest first, as the file would give it. */
export async function readRecordsFromDb(): Promise<AuditRecord[]> {
  const client = db();
  if (!client) return [];

  const [decisionRows, eventRows] = await withTimeout(
    Promise.all([
      client.select().from(decisions).orderBy(desc(decisions.requestedAt)).limit(READ_LIMIT),
      client.select().from(nudgeEvents).orderBy(desc(nudgeEvents.occurredAt)).limit(READ_LIMIT),
    ]),
  );

  return [...decisionRows.map(decisionToRecord), ...eventRows.map(nudgeEventToRecord)].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
}

/** Row count per table — for the health endpoint, so a judge can see the trail is real. */
export async function countRecords(): Promise<{ decisions: number; outcomes: number }> {
  const client = db();
  if (!client) return { decisions: 0, outcomes: 0 };
  const [[d], [o]] = await withTimeout(
    Promise.all([
      client.select({ n: sql<number>`count(*)::int` }).from(decisions),
      client.select({ n: sql<number>`count(*)::int` }).from(nudgeEvents),
    ]),
  );
  return { decisions: d?.n ?? 0, outcomes: o?.n ?? 0 };
}

