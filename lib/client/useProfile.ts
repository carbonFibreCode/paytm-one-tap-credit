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

/** Returns null while loading, or if the request fails — callers show a skeleton. */
export function useProfile(userId: string, enabled: boolean): ProfilePayload | null {
  // Keyed by user so a stale profile is never shown for the wrong persona:
  // switching users reads as "loading" until the new response lands, with no
  // reset-in-effect needed.
  const [loaded, setLoaded] = useState<{ userId: string; profile: ProfilePayload } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    fetch(`/api/profile?userId=${encodeURIComponent(userId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: ProfilePayload | null) => {
        if (!cancelled && data) setLoaded({ userId, profile: data });
      })
      .catch(() => {
        // Callers keep showing the skeleton.
      });

    return () => {
      cancelled = true;
    };
  }, [userId, enabled]);

  return loaded?.userId === userId ? loaded.profile : null;
}
