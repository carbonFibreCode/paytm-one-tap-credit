/**
 * /api/payments — the credit ledger's front door.
 *
 * POST   records a payment; on credit it also opens the account and schedule
 * GET    ?userId=  lists payments with their accounts and instalments
 * DELETE ?userId=  demo reset — forgets this user's payments and accounts
 *
 * The checkout screen posts here fire-and-forget after the payment animation
 * has already started. Nothing this route does can delay or fail a payment;
 * it only decides what the *next* one sees.
 */

import { NextResponse } from 'next/server';
import { paymentBody } from '@/lib/api/schemas';
import { ApiError, getRoute, jsonRoute, unknown } from '@/lib/api/route';
import { clearUser, listPayments, liveCredit, recordPayment } from '@/lib/credit/store';
import { dbConfigured } from '@/lib/db/client';
import { getMerchant } from '@/lib/fixtures/merchants';
import { getPersona } from '@/lib/fixtures/personas';

/** Every route here is per-user; a missing id is a client error, not an empty list. */
function requireUserId(request: Request): string {
  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) throw new ApiError('`userId` is required', 400);
  return userId;
}

/** The ledger is optional infrastructure: say so rather than failing. */
function requireDatabase(): void {
  if (!dbConfigured()) throw new ApiError('database not configured', 503);
}

export const POST = jsonRoute(paymentBody, async (input) => {
  if (!getPersona(input.userId)) throw unknown('userId', input.userId);
  requireDatabase();

  const result = await recordPayment({
    ...input,
    merchantName: input.merchantName ?? getMerchant(input.merchantId)?.name ?? 'Merchant',
    at: input.at ?? new Date().toISOString(),
  });
  return NextResponse.json({ stored: result !== null, ...result });
});

export const GET = getRoute(async (request) => {
  const userId = requireUserId(request);
  if (!getPersona(userId)) throw unknown('userId', userId);

  const [payments, live] = await Promise.all([listPayments(userId), liveCredit(userId)]);
  return NextResponse.json({ userId, database: dbConfigured(), payments, live });
});

export const DELETE = getRoute(async (request) => {
  const userId = requireUserId(request);
  await clearUser(userId);
  return NextResponse.json({ cleared: true, userId });
});
