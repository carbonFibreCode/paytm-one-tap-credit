/**
 * POST /api/engine/offer — stage 4: build the offer.
 *
 * Chooses between products that are eligible *and* can cover the purchase in
 * full, then constructs only the instalment plans the user can responsibly
 * carry. Shorter, pricier tenures are withheld rather than shown and refused.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildOffer, DECLINE } from '@/lib/engine/offer';
import type { ProductState } from '@/lib/types';
import { badRequest, categoryEnum, profileShape, rupees } from '@/lib/api/steps';

const productShape = z.object({
  id: z.enum(['postpaid', 'card']),
  eligible: z.boolean(),
  active: z.boolean(),
  limit: z.number(),
  available: z.number(),
  partner: z.string(),
});

const body = z.object({
  profile: profileShape,
  amount: rupees,
  merchantCategory: categoryEnum,
  timestamp: z.string().optional(),
  fundingProducts: z.array(productShape).min(1, 'must contain at least one product'),
  eligibleProducts: z.array(productShape).optional().default([]),
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

  const { profile, amount, merchantCategory, fundingProducts, eligibleProducts } = parsed.data;
  const timestamp = parsed.data.timestamp ?? new Date().toISOString();

  // The same function `decide()` uses — the staged path can never disagree
  // with the direct one about the product or the plans.
  const built = buildOffer({
    fundingProducts: fundingProducts as ProductState[],
    eligibleProducts: (eligibleProducts.length > 0 ? eligibleProducts : fundingProducts) as ProductState[],
    amount,
    category: merchantCategory,
    timestamp,
    capacity: profile.features.affordabilityCapacity,
  });

  return NextResponse.json({
    stage: 'offer',
    product: built.product.id,
    offer: built.offer,
    productRationale: built.rationale,
    tenuresWithheld: built.tenuresWithheld,
    decline: DECLINE,
  });
}
