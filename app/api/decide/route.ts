/**
 * POST /api/decide — the decision endpoint.
 *
 * Called by our checkout screen and, in the orchestrated path, by the n8n
 * workflow. This is the only place the clock is read: the engine itself is
 * clock-free so that a decision stays reproducible.
 */

import { NextResponse } from 'next/server';
import { decide } from '@/lib/engine/decide';
import { buildProfile, getPersona } from '@/lib/personas';
import { parseDecideRequest } from '@/lib/api/validate';
import { liveCreditOrEmpty } from '@/lib/credit/store';
import { ENGINE_VERSION } from '@/lib/engine/version';

export async function POST(request: Request) {
  const now = new Date().toISOString();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 });
  }

  const parsed = parseDecideRequest(body, now);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const { request: decisionRequest, merchantCreditEnabled } = parsed.value;
  const persona = getPersona(decisionRequest.userId)!;
  // Credit already extended here is an *input* to the profile, read by this
  // route and handed over — the engine itself still touches no database.
  const live = await liveCreditOrEmpty(decisionRequest.userId);
  const profile = buildProfile(persona, decisionRequest.timestamp, live);

  const decision = decide({ request: decisionRequest, profile, merchantCreditEnabled });

  return NextResponse.json({
    ...decision,
    // Echoed so a downstream n8n node can build the nudge-text call from this
    // response alone, without reaching back to the original webhook payload.
    amount: decisionRequest.amount,
    user: {
      userId: profile.userId,
      displayName: profile.displayName,
      preferredLanguage: profile.preferredLanguage,
    },
    merchant: {
      id: decisionRequest.merchantId,
      name: decisionRequest.merchantName,
      category: decisionRequest.merchantCategory,
      creditEnabled: merchantCreditEnabled,
    },
    engine: { version: ENGINE_VERSION, evaluatedAt: decisionRequest.timestamp },
  });
}
