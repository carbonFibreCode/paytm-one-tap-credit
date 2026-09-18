/**
 * /api/intents — issue payment intents.
 *
 * GET   every merchant's static code (created on first call, stable after)
 * POST  a dynamic code for one bill: `{ merchantId, amount, ttlMinutes? }`
 */

import { NextResponse } from 'next/server';
import { intentBody } from '@/lib/api/schemas';
import { ApiError, getRoute, jsonRoute, unknown } from '@/lib/api/route';
import { dbConfigured } from '@/lib/db/client';
import { createDynamicIntent, DYNAMIC_TTL_MINUTES, ensureStaticIntents } from '@/lib/intents/store';
import { signingConfigured } from '@/lib/intents/sign';
import { getMerchant } from '@/lib/merchants';

export const GET = getRoute(async () => {
  const configured = dbConfigured();
  return NextResponse.json({
    database: configured,
    signing: signingConfigured(),
    intents: configured ? await ensureStaticIntents() : [],
  });
});

export const POST = jsonRoute(intentBody, async (input) => {
  if (!getMerchant(input.merchantId)) throw unknown('merchantId', input.merchantId);
  if (!dbConfigured()) throw new ApiError('database not configured', 503);

  const intent = await createDynamicIntent(
    input.merchantId,
    input.amount,
    new Date().toISOString(),
    input.ttlMinutes ?? DYNAMIC_TTL_MINUTES,
  );
  return NextResponse.json({ intent }, { status: 201 });
});
