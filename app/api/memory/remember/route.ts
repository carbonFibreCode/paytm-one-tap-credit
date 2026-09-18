/**
 * POST /api/memory/remember — record what the user did with an offer.
 *
 * Called by the n8n outcome workflow. Writing to memory is a side-effect: a
 * failure here is reported but never fails the caller, because the outcome is
 * already in the audit trail.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rememberOutcome } from '@/lib/memory/cognee';
import { badRequest } from '@/lib/api/steps';

const body = z.object({
  userId: z.string().min(1),
  transactionId: z.string().min(1),
  product: z.string().nullable().default(null),
  merchantCategory: z.string().optional(),
  outcome: z.enum(['shown', 'accepted', 'declined']),
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
  if (!parsed.success) return NextResponse.json(badRequest(parsed.error), { status: 400 });

  const result = await rememberOutcome({
    ...parsed.data,
    at: parsed.data.at ?? new Date().toISOString(),
  });

  return NextResponse.json({ stage: 'remember', ...result });
}
