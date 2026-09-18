/**
 * Product selection.
 *
 * Only ever chooses between products that are already eligible *and* have the
 * limit to cover the purchase in full. The choice is deterministic — the same
 * transaction always picks the same product — and it always states why the
 * alternative lost.
 */

import type { ProductState } from '../types';
import { formatINR } from '../format';

/**
 * At or above this, a card's longer tenures beat Postpaid's single bill cycle.
 *
 * Set above ₹50,000 deliberately: Postpaid limits typically top out near ₹1 lakh,
 * so a ₹50,000 electronics purchase is squarely Postpaid territory, while an
 * ₹80,000 one is better served by a card that can stretch to 12 months.
 */
export const CARD_PREFERENCE_THRESHOLD = 75_000;

export interface ProductSelection {
  product: ProductState;
  rationale: string;
}

export function selectProduct(
  fundingProducts: ProductState[],
  amount: number,
  eligibleProducts: ProductState[],
): ProductSelection {
  if (fundingProducts.length === 0) {
    throw new Error('selectProduct called with no funding products — gates should have blocked');
  }

  if (fundingProducts.length === 1) {
    const only = fundingProducts[0];
    const rejected = eligibleProducts.find((product) => product.id !== only.id);
    const because =
      rejected === undefined
        ? `${only.partner} is the only product this user is approved for`
        : rejected.eligible
          ? `${rejected.partner} has only ${formatINR(rejected.available)} available, short of ${formatINR(amount)}`
          : `User is not approved for ${rejected.partner}`;
    return { product: only, rationale: `${only.partner} selected — ${because}` };
  }

  const postpaid = fundingProducts.find((product) => product.id === 'postpaid')!;
  const card = fundingProducts.find((product) => product.id === 'card')!;

  if (amount < CARD_PREFERENCE_THRESHOLD) {
    return {
      product: postpaid,
      rationale: `Postpaid selected — at ${formatINR(amount)}, below the ${formatINR(
        CARD_PREFERENCE_THRESHOLD,
      )} switch point, it clears in one bill cycle with no new card to activate`,
    };
  }

  return {
    product: card,
    rationale: `${card.partner} selected — at ${formatINR(amount)}, at or above the ${formatINR(
      CARD_PREFERENCE_THRESHOLD,
    )} switch point, its longer tenures keep the monthly instalment manageable`,
  };
}
