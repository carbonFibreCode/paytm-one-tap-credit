/**
 * POST /api/engine/gates — stage 2: the hard blocks.
 *
 * Runs all fourteen gates in order and stops at the first failure. Nothing
 * downstream can override this: if a gate fails, there is no offer, whatever
 * the relevance score says.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildGateContext } from '@/lib/engine/decide';
import { runGates } from '@/lib/engine/gates';
import { getMerchant } from '@/lib/merchants';
import { badRequest, categoryEnum, nudgeHistoryShape, profileShape, rupees } from '@/lib/api/steps';

const body = z.object({
  profile: profileShape,
  amount: rupees,
  merchantId: z.string().optional(),
  merchantCategory: categoryEnum.optional(),
  merchantName: z.string().optional(),
  merchantCreditEnabled: z.boolean().optional(),
  timestamp: z.string().optional(),
  selectedInstrument: z
    .enum(['upi', 'wallet', 'debit_card', 'credit_card', 'postpaid', 'netbanking'])
    .optional(),
  nudgeHistory: nudgeHistoryShape,
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
  const input = parsed.data;

  const merchant = input.merchantId ? getMerchant(input.merchantId) : undefined;
  if (input.merchantId && !merchant) {
    return NextResponse.json(
      { error: `Unknown merchantId \`${input.merchantId}\`` },
      { status: 404 },
    );
  }

  const merchantCategory = merchant?.category ?? input.merchantCategory;
  if (!merchantCategory) {
    return NextResponse.json(
      { error: 'Provide a known `merchantId`, or a `merchantCategory`' },
      { status: 400 },
    );
  }

  const timestamp = input.timestamp ?? new Date().toISOString();

  const { context } = buildGateContext({
    profile: input.profile,
    merchantCreditEnabled: merchant?.creditEnabled ?? input.merchantCreditEnabled !== false,
    request: {
      transactionId: 'stage',
      userId: input.profile.userId,
      amount: input.amount,
      merchantId: input.merchantId ?? 'm_unknown',
      merchantName: merchant?.name ?? input.merchantName ?? 'Merchant',
      merchantCategory,
      timestamp,
      selectedInstrument: input.selectedInstrument,
      nudgeHistory: input.nudgeHistory,
    },
  });

  const { results, blockedBy, blockedReason } = runGates(context);

  return NextResponse.json({
    stage: 'gates',
    passed: blockedBy === null,
    blockedBy,
    blockedReason,
    gates: results,
    checksRun: results.length,
    merchantCategory,
    // Carried forward so the offer stage does not have to recompute them.
    eligibleProducts: context.eligibleProducts,
    fundingProducts: context.fundingProducts,
    minAchievableEmi: Number.isFinite(context.minAchievableEmi) ? context.minAchievableEmi : null,
    timestamp,
  });
}
