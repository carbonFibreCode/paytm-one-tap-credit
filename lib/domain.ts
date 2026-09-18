/**
 * Domain vocabulary — the single source of truth for every enumeration.
 *
 * Each list is an `as const` array. TypeScript unions (`lib/types.ts`) and Zod
 * validators (`lib/schemas.ts`) are both *derived* from these, so a value added
 * here reaches the types and the API contracts in the same edit. No Zod here:
 * this module is imported by client code and must stay dependency-free.
 */

// --- enumerations ------------------------------------------------------------

export const MERCHANT_CATEGORIES = [
  // discretionary — credit is relevant here
  'electronics',
  'travel',
  'jewellery',
  'apparel',
  'healthcare',
  // essential / recurring — low relevance, high annoyance
  'grocery',
  'fuel',
  'bills',
  // never eligible for a credit nudge, at any amount
  'p2p',
  'wallet_load',
  'gambling',
  'crypto',
] as const;
export type MerchantCategory = (typeof MERCHANT_CATEGORIES)[number];

export const PRODUCT_IDS = ['postpaid', 'card'] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

export const LANGUAGES = ['hi', 'en', 'ta', 'bn'] as const;
export type Language = (typeof LANGUAGES)[number];

export const INSTRUMENTS = ['upi', 'wallet', 'debit_card', 'credit_card', 'postpaid', 'netbanking'] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export const NUDGE_OUTCOMES = ['shown', 'accepted', 'declined'] as const;
export type NudgeOutcome = (typeof NUDGE_OUTCOMES)[number];

export const PAYMENT_METHODS = ['upi', 'wallet', 'postpaid', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** ₹1 crore — beyond any plausible checkout, and the keypad's hard stop. */
export const MAX_SAFE_AMOUNT = 1_00_00_000;

// --- merchant categories, described once ------------------------------------

export interface CategoryMeta {
  /** What a person would call it. */
  label: string;
  /** Merchant category code, roughly following the ISO 18245 groupings. */
  mcc: string;
  /**
   * How relevant a credit offer is for this category, 0..1. The relevance gate
   * uses a floor; the relevance score uses the value itself.
   */
  relevance: number;
  /** A purchase a user chooses to make — where an instalment plan can help. */
  discretionary: boolean;
  /**
   * Never receives a credit nudge at any amount, for any user. Transfers and
   * wallet top-ups matter most: borrowed money routed into them becomes
   * untraceable cash, which is exactly what lending rules exist to prevent.
   */
  prohibited: boolean;
}

export const CATEGORY_META: Record<MerchantCategory, CategoryMeta> = {
  electronics: { label: 'Electronics', mcc: '5732', relevance: 0.9, discretionary: true, prohibited: false },
  travel: { label: 'Travel', mcc: '4722', relevance: 0.85, discretionary: true, prohibited: false },
  jewellery: { label: 'Jewellery', mcc: '5944', relevance: 0.8, discretionary: true, prohibited: false },
  apparel: { label: 'Apparel', mcc: '5651', relevance: 0.45, discretionary: true, prohibited: false },
  healthcare: { label: 'Healthcare', mcc: '5912', relevance: 0.6, discretionary: true, prohibited: false },
  grocery: { label: 'Groceries', mcc: '5411', relevance: 0.15, discretionary: false, prohibited: false },
  fuel: { label: 'Fuel', mcc: '5541', relevance: 0.1, discretionary: false, prohibited: false },
  bills: { label: 'Bill payments', mcc: '4900', relevance: 0.15, discretionary: false, prohibited: false },
  p2p: { label: 'Person-to-person transfers', mcc: '0000', relevance: 0, discretionary: false, prohibited: true },
  wallet_load: { label: 'Wallet top-ups', mcc: '6540', relevance: 0, discretionary: false, prohibited: true },
  gambling: { label: 'Gaming and betting', mcc: '7995', relevance: 0, discretionary: false, prohibited: true },
  crypto: { label: 'Crypto purchases', mcc: '6051', relevance: 0, discretionary: false, prohibited: true },
};

export const DISCRETIONARY_CATEGORIES = MERCHANT_CATEGORIES.filter(
  (category) => CATEGORY_META[category].discretionary,
);
export const PROHIBITED_CATEGORIES = MERCHANT_CATEGORIES.filter(
  (category) => CATEGORY_META[category].prohibited,
);

// --- display names ------------------------------------------------------------

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  hi: 'हिन्दी',
  ta: 'தமிழ்',
  bn: 'বাংলা',
};
