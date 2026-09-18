/**
 * Cognee — persistent memory of how each user answers credit offers.
 *
 * Talks to Cognee Cloud's REST API directly. Cognee also ships a native Node
 * addon (`@cognee/cognee-ts`, 257 MB of platform-specific binary) which cannot
 * run in a serverless function — the hosted API avoids that entirely, so the
 * app on Vercel can call it with nothing extra installed.
 *
 * Two rules this layer lives by, both enforced below:
 *
 *   1. **Memory supplies facts, never judgements.** What comes back is counts
 *      and categories, never prose. A knowledge-graph query is a fine way to
 *      explore a user's history and a terrible way to justify a lending
 *      decision, so the numbers that move a score come from structured records.
 *   2. **Memory adjusts relevance only.** It can make us less likely to
 *      interrupt someone who keeps saying no; it can never unlock eligibility,
 *      affordability, or any other hard gate.
 *
 * With no sidecar configured this falls back to the local audit trail, so the
 * feature works offline and the decision path never depends on a third party.
 */

import type { MemoryContext } from '../engine/score';
import { readRecords, type AuditRecord } from '../audit/store';

/** Per-tenant base URL, copied from the API Keys page in Cognee Cloud. */
const API_URL = (process.env.COGNEE_API_URL ?? '').replace(/\/+$/, '');
const API_KEY = process.env.COGNEE_API_KEY ?? '';
const DATASET = process.env.COGNEE_DATASET ?? 'one-tap-credit';
/** Writes are quick. Searches measured at 5–6s, so they get their own budget. */
const WRITE_TIMEOUT_MS = 6_000;
const SEARCH_TIMEOUT_MS = 12_000;
/** How long a cached recall stays usable before we refresh it. */
const CACHE_TTL_MS = 5 * 60_000;

export function cogneeConfigured(): boolean {
  return API_URL.length > 0 && API_KEY.length > 0;
}

async function callCognee<T>(
  path: string,
  body: BodyInit,
  json: boolean,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Every endpoint is under /api/v1 — omitting the prefix 404s.
    const response = await fetch(`${API_URL}/api/v1${path}`, {
      method: 'POST',
      // For multipart, fetch must set Content-Type itself so the boundary is right.
      headers: json
        ? { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY }
        : { 'X-Api-Key': API_KEY },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${(await response.text().catch(() => '')).slice(0, 120)}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface OutcomeMemory {
  userId: string;
  transactionId: string;
  product: string | null;
  merchantCategory?: string;
  outcome: 'shown' | 'accepted' | 'declined';
  at: string;
}

export interface RememberResult {
  stored: boolean;
  via: string;
  reason?: string;
}

/** Write one outcome into Cognee's graph, via the sidecar. */
export async function rememberOutcome(memory: OutcomeMemory): Promise<RememberResult> {
  if (!cogneeConfigured()) {
    // The local audit trail already holds it — nothing further to do.
    return { stored: true, via: 'local-audit', reason: 'COGNEE_API_URL / COGNEE_API_KEY not set' };
  }

  // Written as a plain sentence plus the structured facts, so the graph gets
  // something to extract entities from and we keep something exact to count.
  const statement =
    `User ${memory.userId} ${memory.outcome} a ${memory.product ?? 'credit'} offer` +
    (memory.merchantCategory ? ` on a ${memory.merchantCategory} purchase` : '') +
    ` on ${memory.at.slice(0, 10)}. ` +
    JSON.stringify({ kind: 'nudge-outcome', ...memory });

  // `/remember` is multipart/form-data: `data` expects file uploads, and
  // `raw_data` is the field for plain text. A JSON body is silently ignored,
  // which surfaces as "Either datasetId or datasetName must be provided".
  const form = new FormData();
  form.append('raw_data', statement);
  form.append('datasetName', DATASET);

  try {
    await callCognee('/remember', form, false, WRITE_TIMEOUT_MS);
    return { stored: true, via: 'cognee' };
  } catch (error) {
    return {
      stored: false,
      via: 'cognee',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Derive a memory context from whatever the local audit trail already holds. */
export function memoryFromRecords(userId: string, records: AuditRecord[]): MemoryContext {
  const outcomes = records.filter(
    (record) => record.type === 'outcome' && record.userId === userId,
  );

  return {
    acceptedCount: outcomes.filter((record) => record.outcome === 'accepted').length,
    declinedCount: outcomes.filter((record) => record.outcome === 'declined').length,
    declinedCategories: [
      ...new Set(
        outcomes
          .filter((record) => record.outcome === 'declined' && record.merchantCategory)
          .map((record) => record.merchantCategory as string),
      ),
    ],
    source: 'local-audit',
  };
}

/**
 * Cached Cognee recalls, keyed by user.
 *
 * Cognee's search takes 5–6 seconds. That is fine for a knowledge graph and far
 * too slow to sit inside a checkout, so it never blocks a decision: reads are
 * served from this cache, and a miss kicks off a refresh in the background
 * while the local trail answers immediately.
 */
const recallCache = new Map<string, { memory: MemoryContext; at: number }>();
const inFlight = new Set<string>();

async function refreshFromCognee(userId: string): Promise<void> {
  if (inFlight.has(userId)) return;
  inFlight.add(userId);

  try {
    const result = await callCognee<unknown>(
      '/search',
      JSON.stringify({
        // camelCase — the API rejects the snake_case form the docs show.
        query: `nudge-outcome ${userId}`,
        searchType: 'CHUNKS',
        datasets: [DATASET],
      }),
      true,
      SEARCH_TIMEOUT_MS,
    );

    const outcomes = extractOutcomes(result).filter((item) => item.userId === userId);
    if (outcomes.length === 0) return;

    recallCache.set(userId, {
      at: Date.now(),
      memory: {
        acceptedCount: outcomes.filter((item) => item.outcome === 'accepted').length,
        declinedCount: outcomes.filter((item) => item.outcome === 'declined').length,
        declinedCategories: [
          ...new Set(
            outcomes
              .filter((item) => item.outcome === 'declined' && item.merchantCategory)
              .map((item) => String(item.merchantCategory)),
          ),
        ],
        source: 'cognee',
      },
    });
  } catch {
    // Memory is an enhancement, never a dependency of the decision path.
  } finally {
    inFlight.delete(userId);
  }
}

/**
 * Recall how this user has answered offers before.
 *
 * Asks for raw chunks rather than a graph completion, then parses the embedded
 * JSON back out. That is the whole trick: what reaches the decision engine is
 * the structured facts we wrote, not prose a model generated about them.
 *
 * Cognee indexes asynchronously — `/remember` returns `status: "running"` and
 * the record becomes searchable a few seconds later. During that window this
 * returns nothing and we fall through to the local trail, which n8n wrote at
 * the same moment. The effect is that memory reads stay instant even though
 * indexing is not.
 */
export async function recallMemory(userId: string): Promise<MemoryContext> {
  if (cogneeConfigured()) {
    const cached = recallCache.get(userId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.memory;

    // Warm the cache for next time without making this caller wait for it.
    void refreshFromCognee(userId);
  }

  return memoryFromRecords(userId, await readRecords());
}

/** Force a synchronous refresh. Used by the warm-up route, never by checkout. */
export async function warmMemory(userId: string): Promise<MemoryContext> {
  if (!cogneeConfigured()) return memoryFromRecords(userId, await readRecords());
  await refreshFromCognee(userId);
  return recallCache.get(userId)?.memory ?? memoryFromRecords(userId, await readRecords());
}

/**
 * Pull our own `nudge-outcome` records back out of a search response.
 *
 * Walks the response for string values and parses any embedded object out of
 * them, rather than regexing over `JSON.stringify(response)` — stringifying
 * re-escapes the quotes inside each chunk's text, which makes the embedded JSON
 * unparseable. Reading the raw string values avoids that entirely.
 *
 * Scanning the whole tree rather than a fixed path also means a change to how
 * results are nested cannot silently break recall.
 */
function extractOutcomes(payload: unknown): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  const collect = (text: string) => {
    // Embedded objects are flat, so a brace pair with no nesting is enough.
    for (const match of text.matchAll(/\{[^{}]*\}/g)) {
      if (!match[0].includes('nudge-outcome')) continue;
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed?.kind !== 'nudge-outcome') continue;
        // The same statement can come back as several overlapping chunks.
        const key = `${parsed.userId}|${parsed.transactionId}|${parsed.outcome}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(parsed);
      } catch {
        // Not one of ours, or truncated mid-chunk — skip it.
      }
    }
  };

  const walk = (node: unknown, depth: number) => {
    if (depth > 8 || node === null) return;
    if (typeof node === 'string') return collect(node);
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      for (const value of Object.values(node as Record<string, unknown>)) {
        walk(value, depth + 1);
      }
    }
  };

  walk(payload, 0);
  return found;
}
