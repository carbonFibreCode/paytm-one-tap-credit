/**
 * POST /api/memory/remember — record what the user did with an offer.
 *
 * Called by the n8n outcome workflow. Writing to memory is a side-effect: a
 * failure here is reported but never fails the caller, because the outcome is
 * already in the audit trail.
 */

import { NextResponse } from 'next/server';
import { rememberOutcome } from '@/lib/memory/cognee';
import { rememberBody } from '@/lib/api/schemas';
import { jsonRoute } from '@/lib/api/route';

export const POST = jsonRoute(rememberBody, async (input) => {
  const result = await rememberOutcome({ ...input, at: input.at ?? new Date().toISOString() });
  return NextResponse.json({ stage: 'remember', ...result });
});
