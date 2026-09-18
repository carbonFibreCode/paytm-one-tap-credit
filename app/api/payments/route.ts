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
import { z } from 'zod';
import { badRequest, rupees } from '@/lib/api/steps';
import { clearUser, listPayments, liveCredit, recordPayment } from '@/lib/credit/store';
import { dbConfigured } from '@/lib/db/client';
import { getMerchant } from '@/lib/merchants';
import { getPersona } from '@/lib/personas';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date');

/** Mirrors `EmiOption` — the plan exactly as the engine offered it. */
const tenure = z.object({
  months: z.number().int().min(1).max(36),
  emi: rupees,
  lastEmi: rupees,
  total: rupees,
  interest: z.number().int().nonnegative(),
  noCost: z.boolean(),
  firstDueDate: isoDate,
});

const body = z.object({
  userId: z.string().min(1),
  merchantId: z.string().min(1),
  merchantName: z.string().min(1).optional(),
  decisionKey: z.string().min(1).optional(),
  amount: rupees,
  method: z.enum(['upi', 'wallet', 'postpaid', 'card']),
  partner: z.string().min(1).optional(),
  tenure: tenure.optional(),
  at: z.string().optional(),
});

function userIdFrom(request: Request): string | null {
  return new URL(request.url).searchParams.get('userId');
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

  const input = parsed.data;
  if (!getPersona(input.userId)) {
    return NextResponse.json({ error: `Unknown userId \`${input.userId}\`` }, { status: 404 });
  }
  if (!dbConfigured()) {
    return NextResponse.json({ stored: false, reason: 'database not configured' });
  }

  try {
    const result = await recordPayment({
      ...input,
      merchantName: input.merchantName ?? getMerchant(input.merchantId)?.name ?? 'Merchant',
      at: input.at ?? new Date().toISOString(),
    });
    return NextResponse.json({ stored: result !== null, ...result });
  } catch (error) {
    return NextResponse.json({ stored: false, error: (error as Error).message }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const userId = userIdFrom(request);
  if (!userId) return NextResponse.json({ error: '`userId` is required' }, { status: 400 });
  if (!getPersona(userId)) {
    return NextResponse.json({ error: `Unknown userId \`${userId}\`` }, { status: 404 });
  }

  try {
    const [rows, live] = await Promise.all([listPayments(userId), liveCredit(userId)]);
    return NextResponse.json({ userId, database: dbConfigured(), payments: rows, live });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const userId = userIdFrom(request);
  if (!userId) return NextResponse.json({ error: '`userId` is required' }, { status: 400 });

  try {
    await clearUser(userId);
    return NextResponse.json({ cleared: true, userId });
  } catch (error) {
    return NextResponse.json({ cleared: false, error: (error as Error).message }, { status: 502 });
  }
}
