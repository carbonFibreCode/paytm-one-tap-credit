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
import { parseNudgeTextRequest } from '@/lib/api/validate';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 });
  }

  const parsed = parseNudgeTextRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const result = await generateNudgeText(parsed.value);

  return NextResponse.json({
    nudgeText: result.text,
    source: result.source,
    reason: result.reason ?? null,
    latencyMs: result.latencyMs ?? null,
    language: parsed.value.language,
  });
}
