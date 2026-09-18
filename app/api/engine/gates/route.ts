/**
 * POST /api/engine/gates — stage 2: the hard blocks.
 *
 * Runs all fourteen gates in order and stops at the first failure. Nothing
 * downstream can override this: if a gate fails, there is no offer, whatever
 * the relevance score says.
 */

import { NextResponse } from 'next/server';
import { buildGateContext } from '@/lib/engine/decide';
import { runGates } from '@/lib/engine/gates';
import { getMerchant } from '@/lib/fixtures/merchants';
import { gatesBody } from '@/lib/api/schemas';
import { ApiError, jsonRoute, unknown } from '@/lib/api/route';

export const POST = jsonRoute(gatesBody, (input) => {
  const merchant = input.merchantId ? getMerchant(input.merchantId) : undefined;
  if (input.merchantId && !merchant) throw unknown('merchantId', input.merchantId);

  const merchantCategory = merchant?.category ?? input.merchantCategory;
  if (!merchantCategory) {
    throw new ApiError('Provide a known `merchantId`, or a `merchantCategory`', 400);
  }

  const timestamp = input.timestamp ?? new Date().toISOString();

  const { context } = buildGateContext({
    profile: input.profile,
    merchantCreditEnabled: merchant?.creditEnabled ?? input.merchantCreditEnabled !== false,
    request: {
      // A synthetic id: this stage judges a transaction, it does not record one.
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
});
