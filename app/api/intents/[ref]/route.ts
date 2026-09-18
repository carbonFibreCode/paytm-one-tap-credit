/**
 * /api/intents/[ref] — one payment intent.
 *
 * GET    its stored row plus the clock-aware state
 * POST   `{ payload }` — the scan: verify the signature, match it to what we
 *        issued, check expiry, mark it scanned. Refusals say why.
 * PATCH  `{ decisionKey }` — record which decision the scan led to
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { badRequest } from '@/lib/api/steps';
import { attachDecision, findIntent, intentState, scanIntent } from '@/lib/intents/store';

type Context = { params: Promise<{ ref: string }> };

const scanBody = z.object({ payload: z.string().min(1) });
const attachBody = z.object({ decisionKey: z.string().min(1) });

async function json(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: Context) {
  const { ref } = await params;
  try {
    const intent = await findIntent(ref);
    if (!intent) return NextResponse.json({ error: `Unknown intent \`${ref}\`` }, { status: 404 });
    return NextResponse.json({ ...intent, state: intentState(intent, new Date().toISOString()) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function POST(request: Request, { params }: Context) {
  const { ref } = await params;
  const payload = await json(request);
  if (payload === null) {
    return NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 });
  }
  const parsed = scanBody.safeParse(payload);
  if (!parsed.success) return NextResponse.json(badRequest(parsed.error), { status: 400 });

  try {
    const result = await scanIntent(parsed.data.payload);
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
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const { ref } = await params;
  const payload = await json(request);
  if (payload === null) {
    return NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 });
  }
  const parsed = attachBody.safeParse(payload);
  if (!parsed.success) return NextResponse.json(badRequest(parsed.error), { status: 400 });

  try {
    await attachDecision(ref, parsed.data.decisionKey);
    return NextResponse.json({ ok: true, ref, decisionKey: parsed.data.decisionKey });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
