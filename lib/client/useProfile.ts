'use client';

/**
 * Fetches a persona's derived profile from `/api/profile`.
 *
 * SWR rather than a hand-rolled effect: the demo drawer and the info sheet ask
 * for the same profile, and SWR serves both from one request. It also handles
 * the cancellation and the stale-response race that the previous version had
 * to manage by hand.
 */

import useSWR from 'swr';
import type { LedgerEntry, LiveCredit, ProductState, SignalComponent } from '../types';

export interface ProfilePayload {
  userId: string;
  displayName: string;
  preferredLanguage: string;
  tagline: string;
  demonstrates: string;
  eligibilitySignal: number;
  eligibilityBreakdown: SignalComponent[];
  liveCredit: LiveCredit;
  features: {
    accountAgeDays: number;
    txnCount: number;
    avgMonthlyInflow: number;
    fixedMonthlyOutflow: number;
    affordabilityCapacity: number;
    detectedObligations: Array<{
      merchant: string;
      amount: number;
      occurrences: number;
      source?: 'ledger' | 'account';
    }>;
  };
  products: ProductState[];
  ledger: { total: number; recent: LedgerEntry[] };
}

async function fetchProfile(url: string): Promise<ProfilePayload> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

/** Returns null while loading, or if the request fails — callers show a skeleton. */
export function useProfile(userId: string, enabled: boolean): ProfilePayload | null {
  const { data } = useSWR(
    enabled ? `/api/profile?userId=${encodeURIComponent(userId)}` : null,
    fetchProfile,
    {
      // A payment changes the profile, so it must not be served stale when the
      // drawer is reopened — but it should not refetch while it is just sitting
      // there behind a closed sheet.
      revalidateOnFocus: false,
      keepPreviousData: false,
    },
  );
  return data ?? null;
}
