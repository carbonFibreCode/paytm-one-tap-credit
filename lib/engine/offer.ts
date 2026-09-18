/**
 * Offer construction — the one implementation.
 *
 * Both the monolithic `decide()` and the n8n `offer` stage build the offer
 * here, so the orchestrated path and the direct path can never disagree about
 * which product is chosen or which instalment plans are shown.
 *
 * The affordability gate passes on the cheapest plan across *all* funding
 * products. The preferred product is not necessarily the one carrying that
 * plan: a user near capacity may only fit the card's 12-month tenure, not
 * Postpaid's 6-month one. Offering a plan above capacity would contradict the
 * gate, so the offer moves to whichever product actually has a plan that fits.
 */

import type { EmiOption, MerchantCategory, Offer, ProductState } from '../types';
import { formatINR } from '../format';
import { affordableTenures, buildTenures } from './emi';
import { selectProduct } from './product';

/** How long a declined offer is respected before we may ask again. */
export const DECLINE_SUPPRESS_DAYS = 7;

/** The decline control every offer carries, weighted equally with accepting. */
export const DECLINE = {
  label: 'No thanks, pay normally',
  suppressDays: DECLINE_SUPPRESS_DAYS,
} as const;

export interface OfferInput {
  /** Eligible products whose available limit covers the purchase in full. */
  fundingProducts: ProductState[];
  /** Eligible products regardless of limit, for the rationale. */
  eligibleProducts: ProductState[];
  amount: number;
  category: MerchantCategory;
  /** ISO timestamp of the transaction; the first instalment falls a month later. */
  timestamp: string;
  /** Monthly instalment the user can responsibly carry. */
  capacity: number;
  /** Pre-computed tenures per product id, when the caller already has them. */
  tenuresByProduct?: ReadonlyMap<string, EmiOption[]>;
}

export interface BuiltOffer {
  offer: Offer;
  product: ProductState;
  /** Why this product beat the alternative. */
  rationale: string;
  /** Shorter, pricier tenures withheld because the instalment exceeds capacity. */
  tenuresWithheld: number;
}

export function buildOffer(input: OfferInput): BuiltOffer {
  const { fundingProducts, eligibleProducts, amount, category, timestamp, capacity } = input;

  const tenuresFor = (product: ProductState): EmiOption[] =>
    input.tenuresByProduct?.get(product.id) ??
    buildTenures(amount, product.id, category, timestamp);
  const fits = (product: ProductState): EmiOption[] =>
    affordableTenures(tenuresFor(product), capacity);

  const preferred = selectProduct(fundingProducts, amount, eligibleProducts);
  const alternative =
    fits(preferred.product).length === 0
      ? fundingProducts.find(
          (candidate) => candidate.id !== preferred.product.id && fits(candidate).length > 0,
        )
      : undefined;

  const { product, rationale } = alternative
    ? {
        product: alternative,
        rationale: `${alternative.partner} selected — every ${preferred.product.partner} plan for ${formatINR(
          amount,
        )} exceeds ${formatINR(capacity)}/month of assessed capacity; ${alternative.partner} offers a longer tenure that fits`,
      }
    : preferred;

  const allTenures = tenuresFor(product);
  const affordable = fits(product);

  // Unreachable while the gate and `fits` agree; kept as a floor so a rounding
  // edge can never produce an empty offer.
  const tenures =
    affordable.length > 0
      ? affordable
      : [allTenures.reduce((cheapest, option) => (option.emi < cheapest.emi ? option : cheapest))];

  const tenuresWithheld = allTenures.length - tenures.length;

  return {
    offer: {
      product: product.id,
      partner: product.partner,
      limit: product.limit,
      available: product.available,
      tenures,
    },
    product,
    rationale:
      tenuresWithheld > 0
        ? `${rationale}. ${tenuresWithheld} shorter tenure${
            tenuresWithheld === 1 ? '' : 's'
          } withheld — the instalment would exceed ${formatINR(capacity)}/month of assessed capacity`
        : rationale,
    tenuresWithheld,
  };
}
