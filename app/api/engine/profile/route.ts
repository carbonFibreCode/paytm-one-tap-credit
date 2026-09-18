/**
 * POST /api/engine/profile — stage 1: recall what we already know.
 *
 * Generates the user's ledger, derives behavioural features from it, and turns
 * those into an eligibility signal. This is the "warm information" step: it is
 * the only stage that reads history, and everything downstream works from what
 * it returns.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildProfileWithLedger, getPersona } from '@/lib/personas';
import { badRequest } from '@/lib/api/steps';
import { liveCreditOrEmpty } from '@/lib/credit/store';

const body = z.object({
  userId: z.string().min(1),
  timestamp: z.string().optional(),
  /** Ledger rows are bulky; the workflow only needs them when showing the chain. */
  includeLedger: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 });
  }

  const parsed = body.safeParse(payload);
  if (!parsed.success) return NextResponse.json(badRequest(parsed.error), { status: 400 });

  const persona = getPersona(parsed.data.userId);
  if (!persona) {
    return NextResponse.json(
      { error: `Unknown userId \`${parsed.data.userId}\`` },
      { status: 404 },
    );
  }

  const asOf = parsed.data.timestamp ?? new Date().toISOString();
  const live = await liveCreditOrEmpty(parsed.data.userId);
  const { profile, ledger } = buildProfileWithLedger(persona, asOf, live);

  return NextResponse.json({
    stage: 'profile',
    asOf,
    profile,
    liveCredit: live,
    ledgerRows: ledger.length,
    ...(parsed.data.includeLedger ? { ledger: ledger.slice(-40).reverse() } : {}),
  });
}
