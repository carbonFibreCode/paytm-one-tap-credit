/**
 * Cognee — persistent memory of how each user answers credit offers.
 *
 * The rule this layer lives by: **memory supplies facts, never judgements.**
 * What comes back is counts and categories — "declined twice, once on
 * electronics" — never a sentence like "this user dislikes credit". A
 * fabricated claim must not be able to move a lending decision, so there is
 * nothing here for a model to fabricate.
 *
 * What memory is allowed to touch is equally deliberate: it adjusts *relevance*
 * only. It can make us less likely to interrupt someone who keeps saying no; it
 * can never unlock eligibility, affordability, or any other hard gate.
 *
 * Without credentials this falls back to the local audit trail, so the feature
 * works offline and the demo never depends on a third party being up.
 */

import type { MemoryContext } from '../engine/score';
import { readRecords, type AuditRecord } from '../audit/store';

const BASE_URL = process.env.COGNEE_API_URL ?? 'https://api.cognee.ai';
const DATASET = process.env.COGNEE_DATASET ?? 'one-tap-credit';
const TIMEOUT_MS = 3_000;

export function cogneeConfigured(): boolean {
  return Boolean(process.env.COGNEE_API_KEY);
}

function authHeaders(): Record<string, string> {
  const key = process.env.COGNEE_API_KEY ?? '';
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'X-Api-Key': key,
  };
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await run(controller.signal);
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

/**
 * Write one outcome into Cognee.
 *
 * Stored as a short natural-language statement of fact plus structured
 * metadata, which is the shape Cognee builds its graph from.
 */
export async function rememberOutcome(memory: OutcomeMemory): Promise<{ stored: boolean; via: string; reason?: string }> {
  if (!cogneeConfigured()) {
    // The local audit trail already holds it — nothing further to do.
    return { stored: true, via: 'local-audit', reason: 'COGNEE_API_KEY not configured' };
  }

  const statement =
    `User ${memory.userId} ${memory.outcome} a ${memory.product ?? 'credit'} offer` +
    (memory.merchantCategory ? ` on a ${memory.merchantCategory} purchase` : '') +
    ` on ${memory.at.slice(0, 10)}.`;

  try {
    const response = await withTimeout((signal) =>
      fetch(`${BASE_URL}/api/v1/add`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          data: statement,
          datasetName: DATASET,
          metadata: { ...memory, kind: 'nudge-outcome' },
        }),
        signal,
      }),
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { stored: false, via: 'cognee', reason: `${response.status} ${detail.slice(0, 120)}` };
    }
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
 * Recall what we know about how this user answers offers.
 *
 * Cognee's response is reduced to counts before it leaves this function, so
 * nothing downstream ever sees free text from a retrieval layer.
 */
export async function recallMemory(userId: string): Promise<MemoryContext> {
  if (cogneeConfigured()) {
    try {
      const response = await withTimeout((signal) =>
        fetch(`${BASE_URL}/api/v1/search`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            query: `credit offer outcomes for user ${userId}`,
            datasetName: DATASET,
            searchType: 'INSIGHTS',
          }),
          signal,
        }),
      );

      if (response.ok) {
        const payload: unknown = await response.json();
        const hits = extractMetadata(payload).filter(
          (item) => item.kind === 'nudge-outcome' && item.userId === userId,
        );

        if (hits.length > 0) {
          return {
            acceptedCount: hits.filter((item) => item.outcome === 'accepted').length,
            declinedCount: hits.filter((item) => item.outcome === 'declined').length,
            declinedCategories: [
              ...new Set(
                hits
                  .filter((item) => item.outcome === 'declined' && item.merchantCategory)
                  .map((item) => String(item.merchantCategory)),
              ),
            ],
            source: 'cognee',
          };
        }
      }
    } catch {
      // Fall through to the local trail — memory is an enhancement, never a
      // dependency of the decision path.
    }
  }

  return memoryFromRecords(userId, await readRecords());
}

/**
 * Pull metadata objects out of whatever shape the search returned.
 *
 * Retrieval APIs differ in how they nest results, and this one is only
 * consulted for structured metadata, so a shape we do not recognise degrades to
 * "no memory" rather than throwing.
 */
function extractMetadata(payload: unknown): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];

  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    if (record.kind === 'nudge-outcome') found.push(record);
    if (record.metadata && typeof record.metadata === 'object') {
      walk(record.metadata, depth + 1);
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') walk(value, depth + 1);
    }
  };

  walk(payload, 0);
  return found;
}
