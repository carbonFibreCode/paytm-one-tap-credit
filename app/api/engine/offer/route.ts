/**
 * POST /api/engine/offer — stage 4: build the offer.
 *
 * Chooses between products that are eligible *and* can cover the purchase in
 * full, then constructs only the instalment plans the user can responsibly
 * carry. Shorter, pricier tenures are withheld rather than shown and refused.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { selectProduct } from '@/lib/engine/product';
import { affordableTenures, buildTenures } from '@/lib/engine/emi';
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

  const { product, rationale } = selectProduct(
    fundingProducts as ProductState[],
    amount,
    (eligibleProducts.length > 0 ? eligibleProducts : fundingProducts) as ProductState[],
  );

  const allTenures = buildTenures(amount, product.id, merchantCategory, timestamp);
  const capacity = profile.features.affordabilityCapacity;
  const affordable = affordableTenures(allTenures, capacity);

  // The affordability gate guarantees at least one plan fits; keep the cheapest
  // as a floor in case rounding leaves the list empty.
  const tenures =
    affordable.length > 0
      ? affordable
      : [allTenures.reduce((cheapest, option) => (option.emi < cheapest.emi ? option : cheapest))];

  return NextResponse.json({
    stage: 'offer',
    product: product.id,
    offer: {
      product: product.id,
      partner: product.partner,
      limit: product.limit,
      available: product.available,
      tenures,
    },
    productRationale: rationale,
    tenuresWithheld: allTenures.length - tenures.length,
    decline: { label: 'No thanks, pay normally', suppressDays: 7 },
  });
}
