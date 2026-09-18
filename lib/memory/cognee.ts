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
const TIMEOUT_MS = 4_000;

export function cogneeConfigured(): boolean {
  return API_URL.length > 0 && API_KEY.length > 0;
}

async function callCognee<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Every endpoint is under /api/v1 — omitting the prefix 404s.
    const response = await fetch(`${API_URL}/api/v1${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
      body: JSON.stringify(body),
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

  try {
    await callCognee('/remember', { data: statement, datasetName: DATASET });
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
 * Recall how this user has answered offers before.
 *
 * Asks for raw chunks rather than a graph completion, then parses the embedded
 * JSON back out. That is the whole trick: what reaches the decision engine is
 * the structured facts we wrote, not prose a model generated about them. If the
 * shape is unrecognisable we fall back rather than guessing.
 */
export async function recallMemory(userId: string): Promise<MemoryContext> {
  if (cogneeConfigured()) {
    try {
      const result = await callCognee<unknown>('/search', {
        query: `nudge-outcome ${userId}`,
        search_type: 'CHUNKS',
        datasets: [DATASET],
      });

      const outcomes = extractOutcomes(result).filter((item) => item.userId === userId);
      if (outcomes.length > 0) {
        return {
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
        };
      }
    } catch {
      // Memory is an enhancement, never a dependency of the decision path.
    }
  }

  return memoryFromRecords(userId, await readRecords());
}

/**
 * Pull our own `nudge-outcome` records back out of a search response.
 *
 * Retrieval APIs nest results differently, and every record we wrote carries an
 * embedded JSON object, so the safest approach is to scan the whole response for
 * those objects rather than depend on an exact response shape.
 */
function extractOutcomes(payload: unknown): Array<Record<string, unknown>> {
  const text = JSON.stringify(payload ?? '');
  const found: Array<Record<string, unknown>> = [];

  for (const match of text.matchAll(/\{[^{}]*?nudge-outcome[^{}]*?\}/g)) {
    try {
      // The JSON was embedded in a string, so quotes arrive escaped.
      const parsed = JSON.parse(match[0].replace(/\\"/g, '"'));
      if (parsed?.kind === 'nudge-outcome') found.push(parsed);
    } catch {
      // Not one of ours — skip it.
    }
  }
  return found;
}
