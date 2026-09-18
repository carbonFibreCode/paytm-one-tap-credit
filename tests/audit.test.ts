import { describe, expect, test } from 'vitest';
import { decisionToRecord, nudgeEventToRecord } from '../lib/audit/repository';
import { insertDecisionSchema, insertNudgeEventSchema } from '../lib/db/schema';
import { appendRecord, readRecords, type AuditRecord } from '../lib/audit/store';

const decision: AuditRecord = {
  at: '2026-09-19T14:30:00.000Z',
  type: 'decision',
  transactionId: 'txn_u_rohit_m_kroma_50000',
  userId: 'u_rohit',
  userName: 'Rohit',
  amount: 50_000,
  merchantName: 'Kroma Electronics',
  merchantCategory: 'electronics',
  showNudge: true,
  product: 'postpaid',
  score: 78,
  eligibilitySignal: 82,
  blockedBy: null,
  blockedReason: null,
  servedBy: 'n8n',
  latencyMs: 325,
  engineVersion: 'rules-v1',
};

describe('database boundary validation', () => {
  test('a decision row must carry a 0–100 score and an ISO timestamp', () => {
    expect(
      insertDecisionSchema.safeParse({
        decisionKey: 'k',
        userId: 'u',
        requestedAt: 'yesterday',
        score: 50,
      }).success,
    ).toBe(false);
    expect(
      insertDecisionSchema.safeParse({
        decisionKey: 'k',
        userId: 'u',
        requestedAt: decision.at,
        score: 101,
      }).success,
    ).toBe(false);
    expect(
      insertDecisionSchema.safeParse({
        decisionKey: 'k',
        userId: 'u',
        requestedAt: decision.at,
        score: 78,
      }).success,
    ).toBe(true);
  });

  test('an outcome must be one of the three known values', () => {
    const base = { decisionKey: 'k', userId: 'u', occurredAt: decision.at };
    expect(insertNudgeEventSchema.safeParse({ ...base, outcome: 'ignored' }).success).toBe(false);
    expect(insertNudgeEventSchema.safeParse({ ...base, outcome: 'declined' }).success).toBe(true);
  });

  test('amounts are whole positive rupees', () => {
    const base = { decisionKey: 'k', userId: 'u', requestedAt: decision.at };
    expect(insertDecisionSchema.safeParse({ ...base, amount: 499.5 }).success).toBe(false);
    expect(insertDecisionSchema.safeParse({ ...base, amount: -1 }).success).toBe(false);
  });
});

describe('row ↔ record mapping', () => {
  test('a decision survives the round trip to a row and back', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000000',
      decisionKey: decision.transactionId,
      userId: decision.userId,
      userName: decision.userName ?? null,
      amount: decision.amount ?? null,
      merchantName: decision.merchantName ?? null,
      merchantCategory: decision.merchantCategory ?? null,
      requestedAt: new Date(decision.at),
      showNudge: decision.showNudge ?? null,
      product: decision.product ?? null,
      score: decision.score ?? null,
      eligibilitySignal: decision.eligibilitySignal ?? null,
      blockedBy: null,
      blockedReason: null,
      servedBy: 'n8n' as const,
      latencyMs: decision.latencyMs ?? null,
      trace: null,
      engineVersion: decision.engineVersion ?? null,
    };
    expect(decisionToRecord(row)).toEqual(decision);
  });

  test('an outcome row becomes an outcome record the digest understands', () => {
    const record = nudgeEventToRecord({
      id: '00000000-0000-0000-0000-000000000001',
      decisionId: null,
      decisionKey: decision.transactionId,
      userId: 'u_rohit',
      product: 'postpaid',
      outcome: 'accepted',
      merchantCategory: 'electronics',
      nudgeSource: 'template',
      occurredAt: new Date(decision.at),
    });
    expect(record.type).toBe('outcome');
    expect(record.outcome).toBe('accepted');
    expect(record.transactionId).toBe(decision.transactionId);
  });
});

describe('store without a database', () => {
  test('append and read still work on the local trail', async () => {
    await appendRecord(decision);
    const records = await readRecords();
    expect(records.some((record) => record.transactionId === decision.transactionId)).toBe(true);
  });
});
