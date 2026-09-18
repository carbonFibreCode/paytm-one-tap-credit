/**
 * Environment, validated once.
 *
 * Every optional integration stays optional — the app runs with none of these
 * set, on templates, the local audit trail and the direct decision path. What
 * this module adds is that a *misconfigured* value fails loudly at boot rather
 * than silently changing behaviour at runtime.
 *
 * The one hard rule: in production, `QR_SIGNING_SECRET` must be set. Without
 * it the signing layer falls back to a constant that is committed to this
 * repository, and every forged QR in the world would verify.
 *
 * Server-only. `NEXT_PUBLIC_*` values are read directly where they are used,
 * because Next inlines them into the client bundle at build time and they
 * cannot be read through an indirection.
 */

import { z } from 'zod';

const optionalUrl = z.string().url('must be a URL').or(z.literal('')).optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Neon Postgres. Unset: audit trail is the local file plus an in-memory buffer. */
  DATABASE_URL: z
    .string()
    .refine((value) => value === '' || /^postgres(ql)?:\/\//.test(value), {
      message: 'must be a postgres:// connection string',
    })
    .optional(),

  /** Signs every QR payload. Required in production — see the note above. */
  QR_SIGNING_SECRET: z.string().optional(),

  /** Cognee Cloud. Both must be present for memory to leave the local trail. */
  COGNEE_API_URL: optionalUrl,
  COGNEE_API_KEY: z.string().optional(),
  COGNEE_DATASET: z.string().default('one-tap-credit'),

  /** Sarvam. Unset: nudge copy comes from templates and says so. */
  SARVAM_API_KEY: z.string().optional(),
  SARVAM_BASE_URL: optionalUrl,
  SARVAM_MODEL: z.string().default('sarvam-m'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${detail}`);
  }

  const value = parsed.data;

  // A build signs nothing, and CI builds without secrets on purpose — this
  // guard is about a *running* production server. `next build` sets
  // NEXT_PHASE, which is how we tell the two apart.
  const building = process.env.NEXT_PHASE === 'phase-production-build';
  if (value.NODE_ENV === 'production' && !building && !value.QR_SIGNING_SECRET) {
    throw new Error(
      'QR_SIGNING_SECRET must be set in production — without it, QR codes are signed with a key committed to this repository.',
    );
  }
  return value;
}

export const env = load();

/** Which optional integrations are actually wired up. */
export const configured = {
  database: Boolean(env.DATABASE_URL),
  signing: Boolean(env.QR_SIGNING_SECRET),
  cognee: Boolean(env.COGNEE_API_URL && env.COGNEE_API_KEY),
  sarvam: Boolean(env.SARVAM_API_KEY),
} as const;
