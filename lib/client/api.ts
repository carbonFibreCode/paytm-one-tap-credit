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

import type { Decision, EmiOption, Instrument, Language, NudgeHistoryEntry } from '../types';

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
export const N8N_OUTCOME_URL = process.env.NEXT_PUBLIC_N8N_OUTCOME_WEBHOOK_URL ?? '';
export const N8N_EDITOR_URL = process.env.NEXT_PUBLIC_N8N_EDITOR_URL ?? '';

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
      // Our routes answer with `{ error }`; prefer that over dumping the raw body.
      const detail = await response.text().catch(() => '');
      let message = detail.slice(0, 160);
      try {
        const parsed = JSON.parse(detail);
        if (typeof parsed?.error === 'string') message = parsed.error;
      } catch {
        // Not JSON — the truncated body is the best we have.
      }
      throw new Error(`${response.status} ${message}`.trim());
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

/**
 * Tell n8n what the user did with an offer.
 *
 * Deliberately fire-and-forget: the accept/decline animation must never wait on
 * a workflow, and a logging failure must never surface to the user. The outcome
 * is already persisted locally — this only feeds the audit trail and the digest.
 */
export interface PaymentReport {
  userId: string;
  merchantId: string;
  amount: number;
  method: 'upi' | 'wallet' | 'postpaid' | 'card';
  partner?: string;
  tenure?: EmiOption;
  /** The decision this payment answered, so the ledger can be joined to the trail. */
  decisionKey?: string;
  at: string;
}

/**
 * Record the payment in the credit ledger. Same posture as `reportOutcome`:
 * the success screen is already showing, and a ledger that is down changes
 * only what the *next* decision knows.
 */
export function reportPayment(payment: PaymentReport): void {
  void fetch('/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payment),
    keepalive: true,
  }).catch(() => {
    // The local history already has it.
  });
}

/** Demo reset — forget this user's payments and credit accounts on the server. */
export function resetUserCredit(userId: string): void {
  void fetch(`/api/payments?userId=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    keepalive: true,
  }).catch(() => {
    // Best effort; the drawer will show whatever the next profile read returns.
  });
}

export function reportOutcome(outcome: {
  transactionId: string;
  userId: string;
  product: string | null;
  outcome: 'shown' | 'accepted' | 'declined';
}): void {
  if (!N8N_OUTCOME_URL) return;
  void fetch(N8N_OUTCOME_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...outcome, at: new Date().toISOString() }),
    keepalive: true,
  }).catch(() => {
    // Nothing to do — the trail is a side-effect, not part of the payment.
  });
}
