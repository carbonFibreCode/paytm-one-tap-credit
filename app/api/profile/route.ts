/**
 * GET /api/profile?userId=u_rohit — the memory layer, exposed.
 *
 * Returns the derived profile plus the ledger it was derived from, so the demo
 * can show the chain: raw transactions → detected signals → eligibility score.
 * This is what makes "the system already knows" a claim we can back up.
 */

import { NextResponse } from 'next/server';
import { buildProfileWithLedger, getPersona, PERSONAS } from '@/lib/personas';

/** Most recent rows only — enough to show the pattern without shipping 250 entries. */
const LEDGER_PAGE_SIZE = 40;

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get('userId');

  if (!userId) {
    // No user asked for — list who is available.
    return NextResponse.json({
      personas: PERSONAS.map((persona) => ({
        userId: persona.spec.userId,
        displayName: persona.spec.displayName,
        preferredLanguage: persona.spec.preferredLanguage,
        tagline: persona.tagline,
        demonstrates: persona.demonstrates,
      })),
    });
  }

  const persona = getPersona(userId);
  if (!persona) {
    return NextResponse.json({ error: `Unknown userId \`${userId}\`` }, { status: 404 });
  }

  const now = new Date().toISOString();
  const { profile, ledger } = buildProfileWithLedger(persona, now);

  return NextResponse.json({
    userId: profile.userId,
    displayName: profile.displayName,
    preferredLanguage: profile.preferredLanguage,
    tagline: persona.tagline,
    demonstrates: persona.demonstrates,
    eligibilitySignal: profile.eligibilitySignal,
    eligibilityBreakdown: profile.eligibilityBreakdown,
    features: profile.features,
    products: profile.products,
    ledger: {
      total: ledger.length,
      recent: ledger.slice(-LEDGER_PAGE_SIZE).reverse(),
    },
  });
}
