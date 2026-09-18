/**
 * POST /api/engine/offer — stage 4: build the offer.
 *
 * Chooses between products that are eligible *and* can cover the purchase in
 * full, then constructs only the instalment plans the user can responsibly
 * carry. Shorter, pricier tenures are withheld rather than shown and refused.
 */

import { NextResponse } from 'next/server';
import { buildOffer, DECLINE } from '@/lib/engine/offer';
import type { ProductState } from '@/lib/types';
import { offerBody } from '@/lib/api/schemas';
import { jsonRoute } from '@/lib/api/route';

export const POST = jsonRoute(offerBody, (input) => {
  const { profile, amount, merchantCategory, fundingProducts, eligibleProducts } = input;

  // The same function `decide()` uses — the staged path can never disagree
  // with the direct one about the product or the plans.
  const built = buildOffer({
    fundingProducts: fundingProducts as ProductState[],
    eligibleProducts: (eligibleProducts.length > 0 ? eligibleProducts : fundingProducts) as ProductState[],
    amount,
    category: merchantCategory,
    timestamp: input.timestamp ?? new Date().toISOString(),
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
});
