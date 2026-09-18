/**
 * /api/intents/[ref] — one payment intent.
 *
 * GET    its stored row plus the clock-aware state
 * POST   `{ payload }` — the scan: verify the signature, match it to what we
 *        issued, check expiry, mark it scanned. Refusals say why.
 * PATCH  `{ decisionKey }` — record which decision the scan led to
 */

import { NextResponse } from 'next/server';
import { attachBody, scanBody } from '@/lib/api/schemas';
import { getRoute, jsonRoute, unknown } from '@/lib/api/route';
import { attachDecision, findIntent, intentState, scanIntent } from '@/lib/intents/store';

type Context = { params: Promise<{ ref: string }> };

export const GET = getRoute<Context>(async (_request, { params }) => {
  const { ref } = await params;
  const intent = await findIntent(ref);
  if (!intent) throw unknown('intent', ref);
  return NextResponse.json({ ...intent, state: intentState(intent, new Date().toISOString()) });
});

export const POST = jsonRoute<typeof scanBody, Context>(scanBody, async (input, { params }) => {
  const { ref } = await params;
  const result = await scanIntent(input.payload);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, ref, reason: result.reason, message: result.message },
      { status: result.status },
    );
  }
  if (result.intent.ref !== ref) {
    return NextResponse.json(
      { ok: false, ref, reason: 'mismatch', message: 'Payload belongs to a different intent.' },
      { status: 401 },
    );
  }

  return NextResponse.json({
    ok: true,
    ref: result.intent.ref,
    merchantId: result.merchantId,
    amount: result.amount ?? null,
    kind: result.intent.kind,
    expiresAt: result.intent.expiresAt,
  });
});

export const PATCH = jsonRoute<typeof attachBody, Context>(
  attachBody,
  async (input, { params }) => {
    const { ref } = await params;
    await attachDecision(ref, input.decisionKey);
    return NextResponse.json({ ok: true, ref, decisionKey: input.decisionKey });
  },
);
