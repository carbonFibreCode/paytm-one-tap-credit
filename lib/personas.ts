/**
 * Demo personas.
 *
 * Each one exists to exercise a specific path through the engine — including
 * four different ways of *declining* to nudge. Credit limits and eligibility
 * flags are bank-assigned in production (SBI / HDFC / IDFC First / Suryoday);
 * here they are synthetic, and deliberately so: we are not reproducing Paytm's
 * underwriting, only the decision layer that sits on top of it.
 */

import type { ProductState, UserProfile } from './types';
import { generateLedger, type PersonaSpec } from './memory/ledger';
import { computeFeatures, type CreditRecord } from './memory/features';
import { deriveEligibilitySignal } from './memory/signal';
import { addDays } from './dates';

export interface Persona {
  spec: PersonaSpec;
  credit: CreditRecord;
  products: ProductState[];
  optedOut: boolean;
  /** Days since a partner bank turned down an application, if any. */
  bankRejectionDaysAgo?: number;
  /** One-line summary shown in the demo drawer. */
  tagline: string;
  /** What this persona is here to prove. */
  demonstrates: string;
}

export const PERSONAS: Persona[] = [
  {
    tagline: 'Salaried, clean repayment record, plenty of headroom',
    demonstrates: 'The happy path — and the Postpaid → Card switch at higher amounts',
    spec: {
      userId: 'u_rohit',
      displayName: 'Rohit Sharma',
      preferredLanguage: 'hi',
      accountAgeDays: 540,
      monthlySalary: 95_000,
      salaryDay: 1,
      salaryJitter: 1,
      salaryVariance: 0.02,
      rent: 22_000,
      emis: [{ merchant: 'Bajaj Finserv EMI', amount: 4_500 }],
      monthlyDiscretionary: 18_000,
      discretionaryMix: { electronics: 4, apparel: 3, travel: 2, healthcare: 1 },
      monthlyEssentials: 14_000,
      volatility: 0.15,
      spendGrowth: 1.02,
      bigTickets: [
        { monthsAgo: 4, category: 'travel', amount: 38_000 },
        { monthsAgo: 9, category: 'electronics', amount: 22_000 },
      ],
      priorCreditRepayments: 8,
      latePayments: 0,
    },
    credit: { priorRepayments: 8, latePayments: 0 },
    optedOut: false,
    products: [
      {
        id: 'postpaid',
        eligible: true,
        active: false,
        limit: 1_00_000,
        available: 1_00_000,
        partner: 'Paytm Postpaid',
      },
      {
        id: 'card',
        eligible: true,
        active: false,
        limit: 2_50_000,
        available: 2_50_000,
        partner: 'Paytm HDFC Bank Credit Card',
      },
    ],
  },
  {
    tagline: 'Good record, but already carrying two large EMIs',
    demonstrates: 'The affordability gate — eligible on paper, declined responsibly',
    spec: {
      userId: 'u_priya',
      displayName: 'Priya Nair',
      preferredLanguage: 'en',
      accountAgeDays: 480,
      monthlySalary: 70_000,
      salaryDay: 2,
      salaryJitter: 1,
      salaryVariance: 0.02,
      rent: 25_000,
      emis: [
        { merchant: 'HDFC Auto Loan', amount: 18_500 },
        { merchant: 'Bajaj EMI Card', amount: 6_500 },
      ],
      monthlyDiscretionary: 9_000,
      discretionaryMix: { apparel: 4, healthcare: 3, electronics: 2 },
      monthlyEssentials: 11_000,
      volatility: 0.18,
      spendGrowth: 1.01,
      bigTickets: [],
      priorCreditRepayments: 4,
      latePayments: 0,
    },
    credit: { priorRepayments: 4, latePayments: 0 },
    optedOut: false,
    products: [
      {
        id: 'postpaid',
        eligible: true,
        active: false,
        limit: 60_000,
        available: 60_000,
        partner: 'Paytm Postpaid',
      },
      {
        id: 'card',
        eligible: false,
        active: false,
        limit: 0,
        available: 0,
        partner: 'Paytm SBI Card',
      },
    ],
  },
  {
    tagline: 'Joined three weeks ago',
    demonstrates: 'Cold start — too little history to score, so we stay silent',
    spec: {
      userId: 'u_aman',
      displayName: 'Aman Verma',
      preferredLanguage: 'hi',
      accountAgeDays: 21,
      monthlySalary: 55_000,
      salaryDay: 1,
      salaryJitter: 1,
      salaryVariance: 0.02,
      rent: 0,
      emis: [],
      monthlyDiscretionary: 6_000,
      discretionaryMix: { electronics: 3, apparel: 2 },
      monthlyEssentials: 7_000,
      volatility: 0.2,
      spendGrowth: 1,
      bigTickets: [],
      priorCreditRepayments: 0,
      latePayments: 0,
    },
    credit: { priorRepayments: 0, latePayments: 0 },
    optedOut: false,
    products: [
      {
        id: 'postpaid',
        eligible: false,
        active: false,
        limit: 0,
        available: 0,
        partner: 'Paytm Postpaid',
      },
      {
        id: 'card',
        eligible: false,
        active: false,
        limit: 0,
        available: 0,
        partner: 'Paytm SBI Card',
      },
    ],
  },
  {
    tagline: 'Freelancer with lumpy, irregular income',
    demonstrates: 'A weak eligibility signal, with the derivation shown line by line',
    spec: {
      userId: 'u_deepak',
      displayName: 'Deepak Rao',
      preferredLanguage: 'en',
      accountAgeDays: 400,
      monthlySalary: 32_000,
      salaryDay: 14,
      salaryJitter: 9,
      salaryVariance: 0.4,
      rent: 14_000,
      emis: [{ merchant: 'Moneyview Loan', amount: 3_800 }],
      monthlyDiscretionary: 7_500,
      discretionaryMix: { electronics: 3, travel: 2, apparel: 2 },
      monthlyEssentials: 8_500,
      volatility: 0.45,
      spendGrowth: 1.03,
      bigTickets: [],
      priorCreditRepayments: 0,
      latePayments: 0,
    },
    credit: { priorRepayments: 0, latePayments: 0 },
    optedOut: false,
    products: [
      {
        id: 'postpaid',
        eligible: true,
        active: false,
        limit: 25_000,
        available: 25_000,
        partner: 'Paytm Postpaid',
      },
      {
        id: 'card',
        eligible: false,
        active: false,
        limit: 0,
        available: 0,
        partner: 'Paytm SBI Card',
      },
    ],
  },
  {
    tagline: 'Already uses Postpaid, ₹18,000 of limit left',
    demonstrates: 'Limit-aware suppression — never offer an offer that cannot complete',
    spec: {
      userId: 'u_meera',
      displayName: 'Meera Iyer',
      preferredLanguage: 'ta',
      accountAgeDays: 620,
      monthlySalary: 88_000,
      salaryDay: 1,
      salaryJitter: 1,
      salaryVariance: 0.02,
      rent: 24_000,
      emis: [],
      monthlyDiscretionary: 16_000,
      discretionaryMix: { jewellery: 4, apparel: 3, travel: 2 },
      monthlyEssentials: 13_000,
      volatility: 0.16,
      spendGrowth: 1.02,
      bigTickets: [{ monthsAgo: 5, category: 'jewellery', amount: 45_000 }],
      priorCreditRepayments: 11,
      latePayments: 1,
    },
    credit: { priorRepayments: 11, latePayments: 1 },
    optedOut: false,
    products: [
      {
        id: 'postpaid',
        eligible: true,
        active: true,
        limit: 60_000,
        available: 18_000,
        partner: 'Paytm Postpaid',
      },
      {
        id: 'card',
        eligible: false,
        active: false,
        limit: 0,
        available: 0,
        partner: 'Paytm SBI Card',
      },
    ],
  },
  {
    tagline: 'Turned down by the partner bank 12 days ago',
    demonstrates: 'Bank cooling-off — we do not re-pitch a rejected application',
    spec: {
      userId: 'u_vikram',
      displayName: 'Vikram Singh',
      preferredLanguage: 'bn',
      accountAgeDays: 510,
      monthlySalary: 64_000,
      salaryDay: 5,
      salaryJitter: 2,
      salaryVariance: 0.03,
      rent: 16_000,
      emis: [{ merchant: 'Tata Capital EMI', amount: 5_200 }],
      monthlyDiscretionary: 11_000,
      discretionaryMix: { electronics: 3, travel: 3, apparel: 2 },
      monthlyEssentials: 10_000,
      volatility: 0.2,
      spendGrowth: 1.02,
      bigTickets: [],
      priorCreditRepayments: 5,
      latePayments: 1,
    },
    credit: { priorRepayments: 5, latePayments: 1 },
    optedOut: false,
    bankRejectionDaysAgo: 12,
    products: [
      {
        id: 'postpaid',
        eligible: true,
        active: false,
        limit: 45_000,
        available: 45_000,
        partner: 'Paytm Postpaid',
      },
      {
        id: 'card',
        eligible: false,
        active: false,
        limit: 0,
        available: 0,
        partner: 'Paytm SBI Card',
      },
    ],
  },
];

export function getPersona(userId: string): Persona | undefined {
  return PERSONAS.find((persona) => persona.spec.userId === userId);
}

/**
 * Assemble a full profile: generate the ledger, derive features from it, then
 * derive the eligibility signal from those features.
 */
export function buildProfile(persona: Persona, asOf: string): UserProfile {
  const ledger = generateLedger(persona.spec, asOf);
  const features = computeFeatures(ledger, asOf, persona.credit);
  const { score, breakdown } = deriveEligibilitySignal(features);

  return {
    userId: persona.spec.userId,
    displayName: persona.spec.displayName,
    preferredLanguage: persona.spec.preferredLanguage,
    features,
    eligibilitySignal: score,
    eligibilityBreakdown: breakdown,
    products: persona.products,
    optedOut: persona.optedOut,
    bankRejectionAt:
      persona.bankRejectionDaysAgo === undefined
        ? undefined
        : addDays(asOf.slice(0, 10), -persona.bankRejectionDaysAgo),
  };
}

/** Profile plus the underlying ledger, for the "show me the history" view. */
export function buildProfileWithLedger(persona: Persona, asOf: string) {
  return {
    profile: buildProfile(persona, asOf),
    ledger: generateLedger(persona.spec, asOf),
  };
}
