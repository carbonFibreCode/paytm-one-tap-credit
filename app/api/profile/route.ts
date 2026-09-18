/**
 * GET /api/profile?userId=u_rohit — the memory layer, exposed.
 *
 * Returns the derived profile plus the ledger it was derived from, so the demo
 * can show the chain: raw transactions → detected signals → eligibility score.
 * This is what makes "the system already knows" a claim we can back up.
 */

import { NextResponse } from 'next/server';
import { buildProfileWithLedger, getPersona } from '@/lib/personas';
import { personOrDefault, PEOPLE } from '@/lib/people';
import { getRoute, unknown } from '@/lib/api/route';
import { liveCreditOrEmpty } from '@/lib/credit/store';

/** Most recent rows only — enough to show the pattern without shipping 250 entries. */
const LEDGER_PAGE_SIZE = 40;

export const GET = getRoute(async (request) => {
  const userId = new URL(request.url).searchParams.get('userId');

  if (!userId) {
    // No user asked for — list who is available.
    return NextResponse.json({
      personas: PEOPLE.map((person) => ({
        userId: person.userId,
        displayName: person.displayName,
        preferredLanguage: person.preferredLanguage,
        tagline: person.tagline,
        demonstrates: person.demonstrates,
      })),
    });
  }

  const persona = getPersona(userId);
  if (!persona) throw unknown('userId', userId);

  const live = await liveCreditOrEmpty(userId);
  const { profile, ledger } = buildProfileWithLedger(persona, new Date().toISOString(), live);
  const person = personOrDefault(userId);

  return NextResponse.json({
    liveCredit: live,
    userId: profile.userId,
    displayName: profile.displayName,
    preferredLanguage: profile.preferredLanguage,
    tagline: person.tagline,
    demonstrates: person.demonstrates,
    eligibilitySignal: profile.eligibilitySignal,
    eligibilityBreakdown: profile.eligibilityBreakdown,
    features: profile.features,
    products: profile.products,
    ledger: { total: ledger.length, recent: ledger.slice(-LEDGER_PAGE_SIZE).reverse() },
  });
});
