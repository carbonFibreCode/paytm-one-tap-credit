/**
 * Structured logging.
 *
 * Server-only — never import this from a client component; pino is a Node
 * module and the browser has no use for it.
 *
 * JSON to stdout, with no transport configured. That is deliberate: pino's
 * pretty/file transports run in worker threads, which do not survive Next's
 * bundling or a serverless function, and Vercel already captures stdout and
 * indexes JSON fields.
 *
 * The events below are the ones worth having after a bad demo run. Each is a
 * named event with the same field spellings every time, so a log search is
 * `event:"n8n.fallback"` rather than a grep for prose:
 *
 *   decision.served        a decision was returned, and how long it took
 *   db.write_failed        the audit trail fell back to the local file
 *   db.read_failed         the trail was read from the file, not Postgres
 *   credit.read_failed     live obligations unavailable; assumed none
 *   cognee.refresh_failed  memory stopped refreshing (previously silent)
 *   sarvam.rejected        model output refused; template used instead
 *   sarvam.failed          model unreachable or slow; template used instead
 *   intent.refused         a scanned QR was turned away, and why
 *   route.failed           an unhandled throw inside a route
 *   signing.dev_key        QR signing fell back to the development key
 */

import pino from 'pino';
import { env } from './env';

export const log = pino({
  level: env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: undefined, // no pid/hostname — noise in a serverless log
  redact: {
    paths: ['payload', '*.apiKey', '*.authorization', 'DATABASE_URL'],
    remove: true,
  },
});

/**
 * A logger stamped with the request id, so the five routes a single
 * orchestrated decision touches can be read as one story. Vercel sets
 * `x-vercel-id`; locally we mint one.
 */
export function requestLog(request: Request) {
  return log.child({ requestId: request.headers.get('x-vercel-id') ?? crypto.randomUUID() });
}

/** Normalise a thrown value into something worth putting in a log line. */
export function errorInfo(error: unknown): { err: string } {
  return { err: error instanceof Error ? error.message : String(error) };
}
