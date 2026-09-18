/**
 * POST /api/engine/score — stage 3: is this moment worth interrupting?
 *
 * Runs only after the gates pass. Four weighted factors, plus an optional
 * adjustment from the memory layer. Memory can make us less likely to interrupt
 * someone who keeps declining, but it can never unlock a gate.
 */

import { NextResponse } from 'next/server';
import { NUDGE_SCORE_THRESHOLD, scoreTransaction } from '@/lib/engine/score';
import { scoreBody } from '@/lib/api/schemas';
import { jsonRoute } from '@/lib/api/route';

export const POST = jsonRoute(scoreBody, ({ profile, amount, merchantCategory, memory }) => {
  const result = scoreTransaction(amount, merchantCategory, profile, memory);

  return NextResponse.json({
    stage: 'score',
    score: result.score,
    threshold: NUDGE_SCORE_THRESHOLD,
    passesThreshold: result.passesThreshold,
    factors: result.factors,
    memoryAdjustment: result.memoryAdjustment,
  });
});
