/**
 * POST /api/audit  — append one decision or outcome to the trail
 * GET  /api/audit  — read it back; `?summary=true` returns the funnel
 *
 * Written by the n8n audit workflow, not by the decision path. Logging is a
 * side-effect: it must never be able to slow down or fail a payment.
 */

import { NextResponse } from 'next/server';
import { appendRecord, readRecords, summarise, type AuditRecord } from '@/lib/audit/store';
import { auditBody } from '@/lib/api/schemas';
import { getRoute, jsonRoute } from '@/lib/api/route';

export const POST = jsonRoute(auditBody, async (input) => {
  const record = {
    ...input,
    at: input.at ?? new Date().toISOString(),
    latencyMs: input.latencyMs ?? undefined,
  } as AuditRecord;

  await appendRecord(record);
  return NextResponse.json({ logged: true, at: record.at });
});

export const GET = getRoute(async (request) => {
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
});
