import type { MerchantCategory } from '../types';

export interface Merchant {
  id: string;
  name: string;
  category: MerchantCategory;
  /** Short descriptor shown under the name on the home screen. */
  blurb: string;
  /** Two-letter monogram used in place of a logo. */
  monogram: string;
  /** Brand tint for the monogram tile. */
  tint: string;
  /** Whether this merchant is in the credit-accepting network. */
  creditEnabled: boolean;
  /** Pre-filled amount at checkout, chosen to exercise a specific path. */
  suggestedAmount: number;
}

/**
 * Demo merchant set. Kroma Electronics at ₹50,000 is the headline scenario and
 * matches the pitch deck mockups exactly; the rest exist to demonstrate the
 * engine declining for different reasons.
 */
export const MERCHANTS: Merchant[] = [
  {
    id: 'm_kroma',
    name: 'Kroma Electronics',
    category: 'electronics',
    blurb: 'Electronics & appliances',
    monogram: 'KE',
    tint: '#00BAF2',
    creditEnabled: true,
    suggestedAmount: 50_000,
  },
  {
    id: 'm_mmt',
    name: 'MakeMyTrip',
    category: 'travel',
    blurb: 'Flights & hotels',
    monogram: 'MT',
    tint: '#E63946',
    creditEnabled: true,
    suggestedAmount: 1_20_000,
  },
  {
    id: 'm_jewels',
    name: 'Reliance Jewels',
    category: 'jewellery',
    blurb: 'Gold & diamond jewellery',
    monogram: 'RJ',
    tint: '#FFD700',
    creditEnabled: true,
    suggestedAmount: 80_000,
  },
  {
    id: 'm_apollo',
    name: 'Apollo Pharmacy',
    category: 'healthcare',
    blurb: 'Medicines & diagnostics',
    monogram: 'AP',
    tint: '#00C853',
    creditEnabled: true,
    suggestedAmount: 12_000,
  },
  {
    id: 'm_bigbazaar',
    name: 'BigBazaar',
    category: 'grocery',
    blurb: 'Daily groceries',
    monogram: 'BB',
    tint: '#F77F00',
    creditEnabled: true,
    suggestedAmount: 450,
  },
  {
    id: 'm_indianoil',
    name: 'Indian Oil',
    category: 'fuel',
    blurb: 'Fuel & lubricants',
    monogram: 'IO',
    tint: '#0077B6',
    creditEnabled: true,
    suggestedAmount: 2_500,
  },
  {
    id: 'm_kirana',
    name: 'Sharma General Store',
    category: 'electronics',
    blurb: 'Neighbourhood store · outside credit network',
    monogram: 'SG',
    tint: '#8D99AE',
    creditEnabled: false,
    suggestedAmount: 24_000,
  },
  {
    id: 'm_p2p',
    name: 'Rahul Sharma',
    category: 'p2p',
    blurb: 'Send money to a contact',
    monogram: 'RS',
    tint: '#6C63FF',
    creditEnabled: true,
    suggestedAmount: 35_000,
  },
];

export function getMerchant(id: string): Merchant | undefined {
  return MERCHANTS.find((merchant) => merchant.id === id);
}
