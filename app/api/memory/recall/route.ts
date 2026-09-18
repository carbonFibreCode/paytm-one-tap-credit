/**
 * POST /api/memory/recall — what do we remember about this user?
 *
 * Called by the n8n pipeline before scoring. Returns counts and categories
 * only: facts the relevance step can act on, with nothing for a retrieval layer
 * to hallucinate into.
 */

import { NextResponse } from 'next/server';
import { cogneeConfigured, recallMemory, warmMemory } from '@/lib/integrations/cognee';
import { recallBody } from '@/lib/api/schemas';
import { jsonRoute } from '@/lib/api/route';

export const POST = jsonRoute(recallBody, async ({ userId, warm }) => {
  const memory = warm ? await warmMemory(userId) : await recallMemory(userId);

  return NextResponse.json({
    stage: 'recall',
    userId,
    memory,
    backend: cogneeConfigured() ? 'cognee' : 'local-audit',
  });
});
