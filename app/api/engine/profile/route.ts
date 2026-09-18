/**
 * POST /api/engine/profile — stage 1: recall what we already know.
 *
 * Generates the user's ledger, derives behavioural features from it, and turns
 * those into an eligibility signal. This is the "warm information" step: it is
 * the only stage that reads history, and everything downstream works from what
 * it returns.
 */

import { NextResponse } from 'next/server';
import { buildProfileWithLedger, getPersona } from '@/lib/personas';
import { engineProfileBody } from '@/lib/api/schemas';
import { jsonRoute, unknown } from '@/lib/api/route';
import { liveCreditOrEmpty } from '@/lib/credit/store';

/** Ledger rows are bulky; only the tail is ever shown. */
const LEDGER_PAGE_SIZE = 40;

export const POST = jsonRoute(engineProfileBody, async (input) => {
  const persona = getPersona(input.userId);
  if (!persona) throw unknown('userId', input.userId);

  const asOf = input.timestamp ?? new Date().toISOString();
  const live = await liveCreditOrEmpty(input.userId);
  const { profile, ledger } = buildProfileWithLedger(persona, asOf, live);

  return NextResponse.json({
    stage: 'profile',
    asOf,
    profile,
    liveCredit: live,
    ledgerRows: ledger.length,
    ...(input.includeLedger ? { ledger: ledger.slice(-LEDGER_PAGE_SIZE).reverse() } : {}),
  });
});
