/**
 * GET /api/health — liveness and configuration, for the n8n healthcheck node
 * and for confirming at a glance whether Sarvam is live or on templates.
 */

import { NextResponse } from 'next/server';
import { sarvamConfigured } from '@/lib/nudge/sarvam';
import { PERSONAS } from '@/lib/personas';
import { MERCHANTS } from '@/lib/merchants';
import { dbConfigured } from '@/lib/db/client';
import { countRecords } from '@/lib/audit/db';
import { ENGINE_VERSION } from '../decide/route';

/** Reports the database without letting it fail the healthcheck. */
async function databaseStatus() {
  if (!dbConfigured()) return { configured: false as const };
  try {
    return { configured: true as const, reachable: true as const, ...(await countRecords()) };
  } catch (error) {
    return { configured: true as const, reachable: false as const, error: (error as Error).message };
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    engine: ENGINE_VERSION,
    database: await databaseStatus(),
    nudgeCopy: sarvamConfigured() ? 'sarvam' : 'fallback',
    personas: PERSONAS.length,
    merchants: MERCHANTS.length,
    time: new Date().toISOString(),
  });
}
