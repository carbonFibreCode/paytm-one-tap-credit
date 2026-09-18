/**
 * POST /api/decide — the decision endpoint.
 *
 * Called by our checkout screen and, in the orchestrated path, by the n8n
 * workflow. This is the only place the clock is read: the engine itself is
 * clock-free so that a decision stays reproducible.
 */

import { NextResponse } from 'next/server';
import { decide } from '@/lib/engine/decide';
import { ENGINE_VERSION } from '@/lib/engine/version';
import { buildProfile, getPersona } from '@/lib/personas';
import { decideBody, resolveDecideRequest } from '@/lib/api/schemas';
import { jsonRoute } from '@/lib/api/route';
import { liveCreditOrEmpty } from '@/lib/credit/store';
import { requestLog } from '@/lib/log';

export const POST = jsonRoute(decideBody, async (body, _context, request) => {
  const startedAt = Date.now();
  const { request: decisionRequest, merchantCreditEnabled } = resolveDecideRequest(
    body,
    new Date().toISOString(),
  );

  const persona = getPersona(decisionRequest.userId)!;
  // Credit already extended here is an *input* to the profile, read by this
  // route and handed over — the engine itself still touches no database.
  const live = await liveCreditOrEmpty(decisionRequest.userId);
  const profile = buildProfile(persona, decisionRequest.timestamp, live);

  const decision = decide({ request: decisionRequest, profile, merchantCreditEnabled });

  requestLog(request).info({
    event: 'decision.served',
    userId: decisionRequest.userId,
    merchantId: decisionRequest.merchantId,
    amount: decisionRequest.amount,
    showNudge: decision.showNudge,
    product: decision.product,
    score: decision.score,
    blockedBy: decision.blockedBy,
    liveObligations: live.obligations.length,
    latencyMs: Date.now() - startedAt,
  });

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
});
