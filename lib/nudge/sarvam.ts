/**
 * Sarvam-generated nudge copy.
 *
 * Sarvam's job is phrasing, never deciding. The engine has already settled what
 * to offer and on what terms; this layer only says it well, in the user's
 * language. That separation is deliberate — a language model must never be able
 * to talk a user into credit the engine did not approve.
 *
 * Three protections wrap the call:
 *   1. a hard timeout — the checkout renders on templates rather than waiting
 *   2. output validation — any number the model introduces that we did not
 *      supply invalidates the response
 *   3. a cache — repeat contexts never pay the latency twice
 */

import type { Language } from '../types';
import { formatINR } from '../format';
import { renderTemplate, type NudgeContext } from './templates';

const TIMEOUT_MS = 2_500;
const MAX_LENGTH = 160;

const BASE_URL = process.env.SARVAM_BASE_URL ?? 'https://api.sarvam.ai';
const MODEL = process.env.SARVAM_MODEL ?? 'sarvam-m';

export type NudgeSource = 'sarvam' | 'template' | 'cache';

export interface NudgeText {
  text: string;
  source: NudgeSource;
  /** Why we fell back, when we did — surfaced in the demo drawer. */
  reason?: string;
  latencyMs?: number;
}

const LANGUAGE_INSTRUCTION: Record<Language, string> = {
  en: 'English',
  hi: 'Hindi (Devanagari script, natural conversational Hinglish is fine)',
  ta: 'Tamil (Tamil script)',
  bn: 'Bengali (Bengali script)',
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Indic digit ranges, so a model answering in Devanagari still validates. */
const DIGIT_OFFSETS: Array<[number, number]> = [
  [0x0966, 0x096f], // Devanagari
  [0x09e6, 0x09ef], // Bengali
  [0x0be6, 0x0bef], // Tamil
];

export function normaliseDigits(text: string): string {
  return [...text]
    .map((character) => {
      const code = character.codePointAt(0)!;
      for (const [start, end] of DIGIT_OFFSETS) {
        if (code >= start && code <= end) return String(code - start);
      }
      return character;
    })
    .join('');
}

/** Every distinct number appearing in the text, commas removed. */
export function extractNumbers(text: string): number[] {
  const matches = normaliseDigits(text).match(/\d[\d,]*/g) ?? [];
  return matches.map((match) => Number(match.replace(/,/g, ''))).filter((n) => !Number.isNaN(n));
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Accept only copy that states the facts we supplied and invents nothing.
 *
 * The important rule is the last one: if the model mentions a number we did not
 * give it — an interest rate, a credit limit, a discount — the copy is rejected
 * outright and the template runs instead.
 */
export function validateNudgeText(text: string, context: NudgeContext): ValidationResult {
  const cleaned = text.trim();

  if (cleaned.length === 0) return { ok: false, reason: 'empty response' };
  if (cleaned.length > MAX_LENGTH) {
    return { ok: false, reason: `too long (${cleaned.length} > ${MAX_LENGTH} chars)` };
  }
  if (cleaned.includes('\n')) return { ok: false, reason: 'more than one line' };

  const numbers = extractNumbers(cleaned);
  if (!numbers.includes(context.amount)) {
    return { ok: false, reason: 'does not state the transaction amount' };
  }

  const allowed = new Set<number>([context.amount, context.emi, context.months]);
  // A no-cost plan may legitimately say "0" interest; an interest-bearing one
  // may not, since we never told it the rate.
  if (context.noCost) allowed.add(0);

  const invented = numbers.filter((value) => !allowed.has(value));
  if (invented.length > 0) {
    return {
      ok: false,
      reason: `invented figures not supplied by the engine: ${invented.join(', ')}`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = new Map<string, string>();

/** Amount is bucketed so near-identical transactions share a cache entry. */
function cacheKey(context: NudgeContext): string {
  const band = Math.floor(context.amount / 5_000) * 5_000;
  return [
    context.language,
    context.product,
    context.merchantCategory,
    band,
    context.months,
    context.noCost ? 'nocost' : 'interest',
  ].join('|');
}

export function clearNudgeCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function buildPrompt(context: NudgeContext): { system: string; user: string } {
  const system = [
    'You write one-line prompts shown inside the Paytm app at the moment of payment.',
    'You are given the exact terms of a pre-approved credit offer. Your only job is to phrase them naturally.',
    '',
    'Rules, all mandatory:',
    '- Reply with ONE line of plain text. No quotes, no emoji, no preamble, no explanation.',
    '- Under 140 characters.',
    '- Use ONLY the figures given to you. Never introduce an interest rate, a credit limit, a discount, a deadline or any other number.',
    '- Never promise approval, and never imply the user must take the offer.',
    '- Warm and matter-of-fact. It is a helpful suggestion, not an advertisement.',
  ].join('\n');

  const costLine = context.noCost
    ? `The plan is no-cost: ${context.months} instalments, no interest or extra charges.`
    : `The plan is ${context.months} monthly instalments. Do not mention interest — the rate is shown separately in the app.`;

  const user = [
    `Language: ${LANGUAGE_INSTRUCTION[context.language]}`,
    `Merchant: ${context.merchantName} (${context.merchantCategory})`,
    `Transaction amount: ${formatINR(context.amount)}`,
    `Credit product: ${context.partner}`,
    `Monthly instalment: ${formatINR(context.emi)} for ${context.months} months`,
    costLine,
    '',
    `Write the one-line prompt in ${LANGUAGE_INSTRUCTION[context.language]}.`,
  ].join('\n');

  return { system, user };
}

/** Is a live Sarvam call even possible? */
export function sarvamConfigured(): boolean {
  return Boolean(process.env.SARVAM_API_KEY);
}

async function callSarvam(context: NudgeContext): Promise<string> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new Error('SARVAM_API_KEY is not set');

  const { system, user } = buildPrompt(context);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Sarvam's documented scheme is the subscription-key header; the bearer
        // is sent alongside it so either gateway convention is accepted.
        'api-subscription-key': apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.7,
        max_tokens: 120,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Sarvam returned ${response.status} ${body.slice(0, 120)}`);
    }

    const payload = await response.json();
    const text: unknown = payload?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('Sarvam response had no message content');

    // Models often wrap a one-liner in quotes; strip them rather than reject.
    return text.trim().replace(/^["'“”]|["'“”]$/g, '').trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Nudge copy for this offer — Sarvam when it is available and trustworthy,
 * templates otherwise. Never throws, and never returns empty: the checkout
 * always has something to render.
 */
export async function generateNudgeText(context: NudgeContext): Promise<NudgeText> {
  const key = cacheKey(context);
  const cached = cache.get(key);
  if (cached) return { text: cached, source: 'cache' };

  const fallback = () => renderTemplate(context);

  if (!sarvamConfigured()) {
    return { text: fallback(), source: 'template', reason: 'SARVAM_API_KEY not configured' };
  }

  const startedAt = Date.now();
  try {
    const generated = await callSarvam(context);
    const latencyMs = Date.now() - startedAt;

    const validation = validateNudgeText(generated, context);
    if (!validation.ok) {
      return {
        text: fallback(),
        source: 'template',
        reason: `Sarvam output rejected — ${validation.reason}`,
        latencyMs,
      };
    }

    cache.set(key, generated);
    return { text: generated, source: 'sarvam', latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const reason =
      error instanceof Error && error.name === 'AbortError'
        ? `Sarvam timed out after ${TIMEOUT_MS}ms`
        : `Sarvam call failed — ${error instanceof Error ? error.message : String(error)}`;
    return { text: fallback(), source: 'template', reason, latencyMs };
  }
}
