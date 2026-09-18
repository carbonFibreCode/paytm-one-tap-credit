/**
 * Database client — Neon Postgres over HTTP.
 *
 * HTTP rather than TCP because this runs in serverless functions: every warm
 * lambda holding a socket open is how Postgres runs out of connections. The
 * same endpoint is reachable from an n8n HTTP node with nothing to pool.
 *
 * Unconfigured is a supported state. Without `DATABASE_URL` the app behaves
 * exactly as it did before the database existed — file trail, in-memory
 * buffer, Cognee for memory. Nothing here may ever be the reason a payment
 * fails.
 */

import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { configured, env } from '../env';
import * as schema from './schema';

/** Budget for one query inside a request. Same region should land in ~10–30ms. */
export const DB_TIMEOUT_MS = 800;

export function dbConfigured(): boolean {
  return configured.database;
}

let cached: NeonHttpDatabase<typeof schema> | null = null;

/** The client, or null when no database is configured. Built once per lambda. */
export function db(): NeonHttpDatabase<typeof schema> | null {
  if (!dbConfigured()) return null;
  cached ??= drizzle(neon(env.DATABASE_URL!), { schema, casing: 'snake_case' });
  return cached;
}

/**
 * Cap a database call so a slow or unreachable Neon degrades to the fallback
 * instead of stalling the caller.
 */
export function withTimeout<T>(promise: Promise<T>, ms = DB_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`database call exceeded ${ms}ms`)), ms),
    ),
  ]);
}
