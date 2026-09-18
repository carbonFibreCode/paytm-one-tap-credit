/**
 * POST /api/audit  — append one decision or outcome to the trail
 * GET  /api/audit  — read it back; `?summary=true` returns the funnel
 *
 * Written by the n8n audit workflow, not by the decision path. Logging is a
 * side-effect: it must never be able to slow down or fail a payment.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { appendRecord, readRecords, summarise, type AuditRecord } from '@/lib/audit/store';

const body = z.object({
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
  outcome: z.enum(['shown', 'accepted', 'declined']).optional(),
  nudgeSource: z.string().optional(),
  /** Supplied by the caller so the entry reflects when the decision happened. */
  at: z.string().optional(),
});

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 });
  }

  const parsed = body.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path.join('.');
    return NextResponse.json(
      { error: field ? `\`${field}\` ${issue.message}` : issue.message },
      { status: 400 },
    );
  }

  const record: AuditRecord = {
    ...parsed.data,
    at: parsed.data.at ?? new Date().toISOString(),
    latencyMs: parsed.data.latencyMs ?? undefined,
  };

  await appendRecord(record);
  return NextResponse.json({ logged: true, at: record.at });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const records = await readRecords();

  if (params.get('summary') === 'true') {
    const sinceDays = Number(params.get('sinceDays') ?? '1');
    return NextResponse.json(
      summarise(records, Number.isFinite(sinceDays) && sinceDays > 0 ? sinceDays : 1),
    );
  }

  const limit = Math.min(Number(params.get('limit') ?? '100') || 100, 1000);
  return NextResponse.json({ total: records.length, records: records.slice(-limit).reverse() });
}
