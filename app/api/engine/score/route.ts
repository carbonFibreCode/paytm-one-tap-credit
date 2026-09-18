/**
 * POST /api/engine/score — stage 3: is this moment worth interrupting?
 *
 * Runs only after the gates pass. Four weighted factors, plus an optional
 * adjustment from the memory layer. Memory can make us less likely to interrupt
 * someone who keeps declining, but it can never unlock a gate.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { NUDGE_SCORE_THRESHOLD, scoreTransaction } from '@/lib/engine/score';
import { badRequest, categoryEnum, memoryShape, profileShape, rupees } from '@/lib/api/steps';

const body = z.object({
  profile: profileShape,
  amount: rupees,
  merchantCategory: categoryEnum,
  memory: memoryShape,
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

  const { profile, amount, merchantCategory, memory } = parsed.data;
  const result = scoreTransaction(amount, merchantCategory, profile, memory);

  return NextResponse.json({
    stage: 'score',
    score: result.score,
    threshold: NUDGE_SCORE_THRESHOLD,
    passesThreshold: result.passesThreshold,
    factors: result.factors,
    memoryAdjustment: result.memoryAdjustment,
  });
}
