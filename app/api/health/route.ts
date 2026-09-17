/**
 * GET /api/health — liveness and configuration, for the n8n healthcheck node
 * and for confirming at a glance whether Sarvam is live or on templates.
 */

import { NextResponse } from 'next/server';
import { sarvamConfigured } from '@/lib/nudge/sarvam';
import { PERSONAS } from '@/lib/personas';
import { MERCHANTS } from '@/lib/merchants';
import { ENGINE_VERSION } from '../decide/route';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    engine: ENGINE_VERSION,
    nudgeCopy: sarvamConfigured() ? 'sarvam' : 'fallback',
    personas: PERSONAS.length,
    merchants: MERCHANTS.length,
    time: new Date().toISOString(),
  });
}
