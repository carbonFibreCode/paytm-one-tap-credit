/**
 * /api/intents — issue payment intents.
 *
 * GET   every merchant's static code (created on first call, stable after)
 * POST  a dynamic code for one bill: `{ merchantId, amount, ttlMinutes? }`
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { badRequest, rupees } from '@/lib/api/steps';
import { dbConfigured } from '@/lib/db/client';
import { createDynamicIntent, DYNAMIC_TTL_MINUTES, ensureStaticIntents } from '@/lib/intents/store';
import { signingConfigured } from '@/lib/intents/sign';
import { getMerchant } from '@/lib/merchants';

const body = z.object({
  merchantId: z.string().min(1),
  amount: rupees,
  ttlMinutes: z.number().int().min(1).max(24 * 60).default(DYNAMIC_TTL_MINUTES),
});

export async function GET() {
  if (!dbConfigured()) {
    return NextResponse.json({ database: false, signing: signingConfigured(), intents: [] });
  }
  try {
    const intents = await ensureStaticIntents();
    return NextResponse.json({ database: true, signing: signingConfigured(), intents });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 });
  }

  const parsed = body.safeParse(payload);
  if (!parsed.success) return NextResponse.json(badRequest(parsed.error), { status: 400 });
  if (!getMerchant(parsed.data.merchantId)) {
    return NextResponse.json(
      { error: `Unknown merchantId \`${parsed.data.merchantId}\`` },
      { status: 404 },
    );
  }
  if (!dbConfigured()) {
    return NextResponse.json({ error: 'database not configured' }, { status: 503 });
  }

  try {
    const intent = await createDynamicIntent(
      parsed.data.merchantId,
      parsed.data.amount,
      new Date().toISOString(),
      parsed.data.ttlMinutes,
    );
    return NextResponse.json({ intent }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
