/**
 * Cognee — persistent memory of how each user answers credit offers.
 *
 * Cognee ships as `@cognee/cognee-ts`, a native Node addon (Rust behind Neon),
 * not as a REST API. That matters: it is 257 MB of platform-specific binary, so
 * it cannot run inside a Vercel serverless function. It runs as a **sidecar**
 * instead, and this module is the HTTP client for it — see `cognee-service/`.
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

const SERVICE_URL = process.env.COGNEE_SERVICE_URL ?? '';
const DATASET = process.env.COGNEE_DATASET ?? 'one-tap-credit';
const TIMEOUT_MS = 4_000;

export function cogneeConfigured(): boolean {
  return SERVICE_URL.length > 0;
}

async function callSidecar<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${SERVICE_URL.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataset: DATASET, ...(body as object) }),
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
    return { stored: true, via: 'local-audit', reason: 'COGNEE_SERVICE_URL not configured' };
  }

  try {
    await callSidecar('/remember', memory);
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
 * The sidecar returns counts it derived from its own structured index, not free
 * text from a graph query — so nothing downstream ever sees model-generated
 * prose. If it is unreachable we fall back to the local trail rather than
 * failing the decision.
 */
export async function recallMemory(userId: string): Promise<MemoryContext> {
  if (cogneeConfigured()) {
    try {
      const result = await callSidecar<{ memory: MemoryContext }>('/recall', { userId });
      if (result?.memory && typeof result.memory.acceptedCount === 'number') {
        return { ...result.memory, source: 'cognee' };
      }
    } catch {
      // Memory is an enhancement, never a dependency of the decision path.
    }
  }

  return memoryFromRecords(userId, await readRecords());
}
