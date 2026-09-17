/**
 * Client-side API calls.
 *
 * The checkout screen prefers the orchestrated path — POST to the n8n webhook,
 * which calls `/api/decide`, branches on the result, calls `/api/nudge-text`
 * and responds with the whole payload. That is the pipeline the pitch describes,
 * and it is what we demo.
 *
 * If n8n is unreachable, slow, or not configured, we fall back to calling our
 * own routes directly. The user sees no difference; the demo drawer shows which
 * path actually served the response. Venue wi-fi should never be able to break
 * the demo.
 */

import type { Decision, Instrument, Language, NudgeHistoryEntry } from '../types';

const N8N_TIMEOUT_MS = 3_000;
const DIRECT_TIMEOUT_MS = 8_000;

export type OrchestrationMode = 'orchestrated' | 'direct';
export type ServedBy = 'n8n' | 'direct';

export interface DecideParams {
  userId: string;
  merchantId: string;
  amount: number;
  selectedInstrument?: Instrument;
  nudgeHistory: NudgeHistoryEntry[];
  language?: Language;
}

export interface DecideOutcome {
  decision: Decision;
  /** Copy for the nudge — present only when the orchestrated path returned it. */
  nudgeText?: { text: string; source: string; reason: string | null; latencyMs: number | null };
  servedBy: ServedBy;
  latencyMs: number;
  /** Set when we intended n8n but fell back. */
  fallbackReason?: string;
}

export const N8N_WEBHOOK_URL = process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL ?? '';

export function n8nConfigured(): boolean {
  return N8N_WEBHOOK_URL.length > 0;
}

async function postJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${response.status} ${detail.slice(0, 160)}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Ask for a decision, preferring the orchestrated path when it is available. */
export async function requestDecision(
  params: DecideParams,
  mode: OrchestrationMode,
): Promise<DecideOutcome> {
  const payload = {
    transactionId: `txn_${params.userId}_${params.merchantId}_${params.amount}`,
    userId: params.userId,
    merchantId: params.merchantId,
    amount: params.amount,
    selectedInstrument: params.selectedInstrument,
    nudgeHistory: params.nudgeHistory,
    language: params.language,
    timestamp: new Date().toISOString(),
  };

  if (mode === 'orchestrated' && n8nConfigured()) {
    const startedAt = Date.now();
    try {
      const result = await postJson<DecideOutcome['decision'] & { nudgeText?: DecideOutcome['nudgeText'] }>(
        N8N_WEBHOOK_URL,
        payload,
        N8N_TIMEOUT_MS,
      );
      // n8n workflows can be wired to respond with the decision at the top
      // level or wrapped; accept either rather than failing the demo on shape.
      const decision = (('decision' in (result as object)
        ? (result as unknown as { decision: Decision }).decision
        : result) as unknown) as Decision;

      if (decision && typeof decision.showNudge === 'boolean') {
        return {
          decision,
          nudgeText: (result as { nudgeText?: DecideOutcome['nudgeText'] }).nudgeText,
          servedBy: 'n8n',
          latencyMs: Date.now() - startedAt,
        };
      }
      throw new Error('n8n response did not contain a decision');
    } catch (error) {
      const fallbackReason =
        error instanceof Error && error.name === 'AbortError'
          ? `n8n timed out after ${N8N_TIMEOUT_MS}ms`
          : `n8n unavailable — ${error instanceof Error ? error.message : String(error)}`;
      const direct = await requestDecisionDirect(payload);
      return { ...direct, fallbackReason };
    }
  }

  return requestDecisionDirect(payload);
}

async function requestDecisionDirect(payload: unknown): Promise<DecideOutcome> {
  const startedAt = Date.now();
  const decision = await postJson<Decision>('/api/decide', payload, DIRECT_TIMEOUT_MS);
  return { decision, servedBy: 'direct', latencyMs: Date.now() - startedAt };
}

export interface NudgeTextParams {
  product: 'postpaid' | 'card';
  partner: string;
  amount: number;
  merchantName: string;
  merchantCategory: string;
  months: number;
  emi: number;
  noCost: boolean;
  language: Language;
}

export interface NudgeTextResult {
  nudgeText: string;
  source: string;
  reason: string | null;
  latencyMs: number | null;
  language: Language;
}

export async function requestNudgeText(params: NudgeTextParams): Promise<NudgeTextResult> {
  return postJson<NudgeTextResult>('/api/nudge-text', params, DIRECT_TIMEOUT_MS);
}
