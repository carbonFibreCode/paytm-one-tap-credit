/**
 * Shared domain types for the One-Tap Credit decision layer.
 *
 * Everything here is deliberately plain data: the engine is a pure function of
 * its inputs, so a decision can always be reproduced from the request alone.
 */

/** Merchant categories we can see at checkout. */
export type MerchantCategory =
  // discretionary — credit is relevant here
  | 'electronics'
  | 'travel'
  | 'jewellery'
  | 'apparel'
  | 'healthcare'
  // essential / recurring — low relevance, high annoyance
  | 'grocery'
  | 'fuel'
  | 'bills'
  // never eligible for a credit nudge, at any amount
  | 'p2p'
  | 'wallet_load'
  | 'gambling'
  | 'crypto';

/** Categories that only ever appear in a user's history, never at checkout. */
export type LedgerCategory = MerchantCategory | 'salary' | 'rent' | 'emi';

export type ProductId = 'postpaid' | 'card';

export type Language = 'hi' | 'en' | 'ta' | 'bn';

export type Instrument =
  | 'upi'
  | 'wallet'
  | 'debit_card'
  | 'credit_card'
  | 'postpaid'
  | 'netbanking';

// ---------------------------------------------------------------------------
// Memory layer — the "warm information" the pitch is built on
// ---------------------------------------------------------------------------

/** One row in a user's synthetic transaction history. */
export interface LedgerEntry {
  id: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  direction: 'credit' | 'debit';
  /** Whole rupees. Never fractional — money is integer here. */
  amount: number;
  category: LedgerCategory;
  merchant: string;
  instrument: Instrument;
}

/** A recurring obligation detected from the ledger (not declared up front). */
export interface RecurringObligation {
  merchant: string;
  amount: number;
  category: LedgerCategory;
  /** How many distinct months this charge was seen in. */
  occurrences: number;
  /**
   * `ledger` when detected from repeated charges; `account` when it is a live
   * credit account this system opened. Absent means ledger.
   */
  source?: 'ledger' | 'account';
}

/**
 * What the credit ledger says this user is carrying *right now*.
 *
 * Read from the database by the caller and handed to the profile builder as
 * an explicit input — the engine never reaches for it itself, which is what
 * keeps a decision reproducible from its inputs alone.
 */
export interface LiveCredit {
  /** One entry per active account: the next instalment due. */
  obligations: RecurringObligation[];
  /** Principal still to be repaid, per product — counts against the limit. */
  outstanding: Record<ProductId, number>;
}

/**
 * Behavioural features derived from the ledger.
 *
 * Every field here is *computed* from {@link LedgerEntry} rows — none of it is
 * declared on the persona. That is the whole point: the eligibility signal has
 * a traceable origin instead of being a hardcoded number.
 */
export interface BehaviouralFeatures {
  accountAgeDays: number;
  txnCount: number;
  monthsObserved: number;

  /** Detected salary-like credits, averaged per month. */
  avgMonthlyInflow: number;
  /** 0..1 — how predictable the salary date is. */
  inflowRegularity: number;

  avgMonthlySpend: number;
  /** 0..1 — coefficient of variation of monthly spend, clamped. Lower is steadier. */
  spendVolatility: number;
  /** Recent 3 months of spend ÷ prior 3 months. >1 means spending is rising. */
  spendTrend: number;

  /** Rent + detected EMIs per month. */
  fixedMonthlyOutflow: number;
  /** Just the detected EMI obligations. */
  existingEmiOutflow: number;
  detectedObligations: RecurringObligation[];

  /** Share of discretionary spend per category, 0..1, sums to ~1. */
  categoryAffinity: Partial<Record<MerchantCategory, number>>;
  /** Purchases over ₹10,000 in the last 6 months. */
  bigTicketCount6m: number;

  priorCreditRepayments: number;
  /** 0..1. Defaults to 0 when there is no history to judge. */
  onTimeRepaymentRate: number;

  /** Inflow minus fixed obligations. */
  disposableMonthly: number;
  /** The most we consider it responsible to add in new EMI load per month. */
  affordabilityCapacity: number;
}

/** One line of the "how we got to this number" breakdown. */
export interface SignalComponent {
  id: string;
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface ProductState {
  id: ProductId;
  /** Comes from Paytm's real underwriting in production; synthetic here. */
  eligible: boolean;
  /** Already set up and usable by this user. */
  active: boolean;
  limit: number;
  available: number;
  partner: string;
}

export interface UserProfile {
  userId: string;
  displayName: string;
  preferredLanguage: Language;
  features: BehaviouralFeatures;
  /** 0..100, derived from {@link BehaviouralFeatures}. */
  eligibilitySignal: number;
  eligibilityBreakdown: SignalComponent[];
  products: ProductState[];
  optedOut: boolean;
  /** ISO date of a partner-bank rejection, if any — triggers a cooling-off. */
  bankRejectionAt?: string;
}

// ---------------------------------------------------------------------------
// Decision contract
// ---------------------------------------------------------------------------

export type NudgeOutcome = 'shown' | 'accepted' | 'declined';

export interface NudgeHistoryEntry {
  product: ProductId;
  /** ISO timestamp. */
  decidedAt: string;
  outcome: NudgeOutcome;
}

export interface DecisionRequest {
  transactionId: string;
  userId: string;
  /** Whole rupees. */
  amount: number;
  merchantId: string;
  merchantName: string;
  merchantCategory: MerchantCategory;
  /** ISO timestamp. Supplied by the caller so the engine stays clock-free. */
  timestamp: string;
  /** Instrument the user has currently selected at checkout. */
  selectedInstrument?: Instrument;
  /** Owned by the client (localStorage), so frequency caps survive cold starts. */
  nudgeHistory?: NudgeHistoryEntry[];
  /** The scanned payment intent this transaction came from, if any. Ignored by the engine. */
  intentRef?: string;
}

/** Machine-readable reason a nudge was withheld. */
export type GateId =
  | 'AMOUNT_FLOOR'
  | 'AMOUNT_CEILING'
  | 'CATEGORY_PROHIBITED'
  | 'CATEGORY_RELEVANCE'
  | 'MERCHANT_NOT_ENABLED'
  | 'OPTED_OUT'
  | 'COLD_START'
  | 'NOT_ELIGIBLE'
  | 'NO_PRODUCT'
  | 'INSUFFICIENT_LIMIT'
  | 'ALREADY_ACTIVE'
  | 'AFFORDABILITY'
  | 'FREQUENCY_CAP'
  | 'BANK_COOLOFF'
  /** Not a hard gate — every gate passed but the moment scored too low. */
  | 'SCORE_THRESHOLD';

export interface GateResult {
  id: GateId;
  passed: boolean;
  /** Human-readable, shown verbatim in the audit trail. */
  detail: string;
}

export interface ScoreFactor {
  id: string;
  label: string;
  weight: number;
  /** 0..1 */
  value: number;
  points: number;
  detail: string;
}

export interface EmiOption {
  months: number;
  /** Instalment for the first `months - 1` payments. */
  emi: number;
  /** Final instalment, carrying the rounding remainder. */
  lastEmi: number;
  total: number;
  interest: number;
  noCost: boolean;
  /** ISO date of the first instalment. */
  firstDueDate: string;
}

export interface Offer {
  product: ProductId;
  partner: string;
  limit: number;
  available: number;
  tenures: EmiOption[];
}

export interface DecisionTrace {
  gates: GateResult[];
  factors: ScoreFactor[];
  /** Why the chosen product beat the alternative. */
  productRationale: string;
  /** What would have had to differ for the outcome to flip. */
  counterfactual: string;
  /** Plain-language summary shown behind "Why am I seeing this?". */
  summary: string;
}

export interface Decision {
  transactionId: string;
  showNudge: boolean;
  product: ProductId | null;
  /** 0..100. Present even when a gate blocked, for the audit trail. */
  score: number;
  /** The first gate that failed, if any. */
  blockedBy: GateId | null;
  blockedReason: string | null;
  offer: Offer | null;
  decline: { label: string; suppressDays: number } | null;
  trace: DecisionTrace;
  /** Signal origin, surfaced so the UI can show the derivation. */
  eligibilitySignal: number;
  eligibilityBreakdown: SignalComponent[];
}
