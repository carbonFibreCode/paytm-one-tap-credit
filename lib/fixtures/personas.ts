/**
 * Demo personas.
 *
 * Each one exists to exercise a specific path through the engine — including
 * four different ways of *declining* to nudge. Credit limits and eligibility
 * flags are bank-assigned in production (SBI / HDFC / IDFC First / Suryoday);
 * here they are synthetic, and deliberately so: we are not reproducing Paytm's
 * underwriting, only the decision layer that sits on top of it.
 */

import type { ProductState } from '../types';
import type { PersonaSpec } from '../profile/ledger';
import type { CreditRecord } from '../profile/features';

export interface Persona {
  spec: PersonaSpec;
  products: ProductState[];
  optedOut: boolean;
  /** Days since a partner bank turned down an application, if any. */
  bankRejectionDaysAgo?: number;
}

export const PERSONAS: Persona[] = [
  {
    spec: {
      userId: 'u_rohit',
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
    spec: {
      userId: 'u_priya',
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
    spec: {
      userId: 'u_aman',
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
    spec: {
      userId: 'u_deepak',
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
    spec: {
      userId: 'u_meera',
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
    spec: {
      userId: 'u_vikram',
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
 * The repayment record the lender holds, which the spec already states — kept
 * derived so the two can never disagree about how many cycles a persona has
 * closed.
 */
export function creditRecordFor(persona: Persona): CreditRecord {
  return {
    priorRepayments: persona.spec.priorCreditRepayments,
    latePayments: persona.spec.latePayments,
  };
}
