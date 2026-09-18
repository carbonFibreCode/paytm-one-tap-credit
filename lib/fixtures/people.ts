/**
 * Display-level person data — the single source of truth for who the demo
 * users are.
 *
 * Deliberately free of any engine imports so screens can pull from it without
 * dragging the ledger generator into the client bundle. The heavier
 * `lib/personas.ts` builds on top of this rather than restating it.
 */

import type { Language } from '../types';

export interface Person {
  userId: string;
  displayName: string;
  initials: string;
  preferredLanguage: Language;
  /** Paytm wallet balance. UPI draws from the linked bank, not from this. */
  balance: number;
  bankName: string;
  bankLast4: string;
  upiId: string;
  /** One-line summary shown on the switcher and in the demo drawer. */
  tagline: string;
  /** What this persona exists to prove about the engine. */
  demonstrates: string;
}

export const PEOPLE: Person[] = [
  {
    userId: 'u_rohit',
    displayName: 'Rohit Sharma',
    initials: 'RS',
    preferredLanguage: 'hi',
    balance: 12_480,
    bankName: 'HDFC Bank',
    bankLast4: '4821',
    upiId: 'rohit.sharma@ptaxis',
    tagline: 'Salaried, clean repayment record, plenty of headroom',
    demonstrates: 'The happy path — and the Postpaid to Card switch at higher amounts',
  },
  {
    userId: 'u_priya',
    displayName: 'Priya Nair',
    initials: 'PN',
    preferredLanguage: 'en',
    balance: 8_260,
    bankName: 'ICICI Bank',
    bankLast4: '3307',
    upiId: 'priya.nair@ptsbi',
    tagline: 'Good record, but already carrying two large EMIs',
    demonstrates: 'The affordability gate — eligible on paper, declined responsibly',
  },
  {
    userId: 'u_aman',
    displayName: 'Aman Verma',
    initials: 'AV',
    preferredLanguage: 'hi',
    balance: 4_110,
    bankName: 'Kotak Bank',
    bankLast4: '9014',
    upiId: 'aman.verma@ptyes',
    tagline: 'Joined three weeks ago',
    demonstrates: 'Cold start — too little history to score, so we stay silent',
  },
  {
    userId: 'u_deepak',
    displayName: 'Deepak Rao',
    initials: 'DR',
    preferredLanguage: 'en',
    balance: 6_940,
    bankName: 'Axis Bank',
    bankLast4: '7752',
    upiId: 'deepak.rao@ptaxis',
    tagline: 'Freelancer with lumpy, irregular income',
    demonstrates: 'A weak eligibility signal, with the derivation shown line by line',
  },
  {
    userId: 'u_meera',
    displayName: 'Meera Iyer',
    initials: 'MI',
    preferredLanguage: 'ta',
    balance: 15_320,
    bankName: 'HDFC Bank',
    bankLast4: '2288',
    upiId: 'meera.iyer@ptaxis',
    tagline: 'Already uses Postpaid, ₹18,000 of limit left',
    demonstrates: 'Limit-aware suppression — never offer an offer that cannot complete',
  },
  {
    userId: 'u_vikram',
    displayName: 'Vikram Singh',
    initials: 'VS',
    preferredLanguage: 'bn',
    balance: 9_870,
    bankName: 'SBI',
    bankLast4: '6130',
    upiId: 'vikram.singh@ptsbi',
    tagline: 'Turned down by the partner bank 12 days ago',
    demonstrates: 'Bank cooling-off — we do not re-pitch a rejected application',
  },
];

export function getPerson(userId: string): Person | undefined {
  return PEOPLE.find((person) => person.userId === userId);
}

/** Falls back to the first persona so a bad id can never blank the UI. */
export function personOrDefault(userId: string): Person {
  return getPerson(userId) ?? PEOPLE[0];
}
