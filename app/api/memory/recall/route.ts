/**
 * POST /api/memory/recall — what do we remember about this user?
 *
 * Called by the n8n pipeline before scoring. Returns counts and categories
 * only: facts the relevance step can act on, with nothing for a retrieval layer
 * to hallucinate into.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cogneeConfigured, recallMemory } from '@/lib/memory/cognee';
import { badRequest } from '@/lib/api/steps';

const body = z.object({ userId: z.string().min(1) });

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 });
  }

  const parsed = body.safeParse(payload);
  if (!parsed.success) return NextResponse.json(badRequest(parsed.error), { status: 400 });

  const memory = await recallMemory(parsed.data.userId);

  return NextResponse.json({
    stage: 'recall',
    userId: parsed.data.userId,
    memory,
    backend: cogneeConfigured() ? 'cognee' : 'local-audit',
  });
}
