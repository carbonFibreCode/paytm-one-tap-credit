/**
 * POST /api/nudge-text — the phrasing endpoint.
 *
 * Takes terms the engine has already settled and returns one line of copy in
 * the user's language. Always succeeds: if Sarvam is unavailable, slow, or
 * returns something that fails validation, a template is returned instead and
 * `source` says so.
 */

import { NextResponse } from 'next/server';
import { generateNudgeText } from '@/lib/nudge/sarvam';
import { nudgeTextBody } from '@/lib/api/schemas';
import { jsonRoute } from '@/lib/api/route';

export const POST = jsonRoute(nudgeTextBody, async (input) => {
  const result = await generateNudgeText(input);

  return NextResponse.json({
    nudgeText: result.text,
    source: result.source,
    reason: result.reason ?? null,
    latencyMs: result.latencyMs ?? null,
    language: input.language,
  });
});
