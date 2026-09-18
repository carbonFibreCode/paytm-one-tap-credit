'use client';

/**
 * Fetches a persona's derived profile from `/api/profile`.
 *
 * Shared by the demo drawer and the home info sheet so the request, the
 * cancellation and the payload shape are only described once.
 */

import { useEffect, useState } from 'react';
import type { LedgerEntry, ProductState, SignalComponent } from '../types';

export interface ProfilePayload {
  userId: string;
  displayName: string;
  preferredLanguage: string;
  tagline: string;
  demonstrates: string;
  eligibilitySignal: number;
  eligibilityBreakdown: SignalComponent[];
  features: {
    accountAgeDays: number;
    txnCount: number;
    avgMonthlyInflow: number;
    fixedMonthlyOutflow: number;
    affordabilityCapacity: number;
    detectedObligations: Array<{ merchant: string; amount: number; occurrences: number }>;
  };
  products: ProductState[];
  ledger: { total: number; recent: LedgerEntry[] };
}

/** Returns null while loading, or if the request fails — callers show a skeleton. */
export function useProfile(userId: string, enabled: boolean): ProfilePayload | null {
  const [profile, setProfile] = useState<ProfilePayload | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setProfile(null);

    fetch(`/api/profile?userId=${encodeURIComponent(userId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, enabled]);

  return profile;
}
