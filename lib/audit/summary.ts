/**
 * Rolling the trail up into the funnel the pitch deck describes.
 *
 * Reporting, not storage: the store decides what a record is and where it
 * lives, this decides what a day of them adds up to.
 */

import { round } from '../math';
import type { AuditRecord } from './store';

export interface AuditSummary {
  generatedAt: string;
  sinceDays: number;
  totals: {
    transactions: number;
    nudged: number;
    withheld: number;
    accepted: number;
    declined: number;
  };
  /** Nudges shown ÷ transactions assessed. */
  nudgeRate: number;
  /** Accepted ÷ nudges shown. */
  acceptanceRate: number;
  averages: { score: number; eligibilitySignal: number };
  withheldByGate: Array<{ gate: string; count: number }>;
  byProduct: Array<{ product: string; count: number }>;
  servedBy: Array<{ path: string; count: number }>;
}

function tally(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** Roll the log up into the funnel the pitch deck describes. */
export function summarise(records: AuditRecord[], sinceDays = 1): AuditSummary {
  const cutoff = Date.now() - sinceDays * 86_400_000;
  const recent = records.filter((record) => Date.parse(record.at) >= cutoff);

  const decisions = recent.filter((record) => record.type === 'decision');
  const outcomes = recent.filter((record) => record.type === 'outcome');

  const nudged = decisions.filter((record) => record.showNudge === true);
  const withheld = decisions.filter((record) => record.showNudge === false);
  const accepted = outcomes.filter((record) => record.outcome === 'accepted');
  const declined = outcomes.filter((record) => record.outcome === 'declined');

  const mean = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    generatedAt: new Date().toISOString(),
    sinceDays,
    totals: {
      transactions: decisions.length,
      nudged: nudged.length,
      withheld: withheld.length,
      accepted: accepted.length,
      declined: declined.length,
    },
    nudgeRate: decisions.length === 0 ? 0 : round((nudged.length / decisions.length) * 100),
    acceptanceRate: nudged.length === 0 ? 0 : round((accepted.length / nudged.length) * 100),
    averages: {
      score: round(mean(decisions.map((record) => record.score ?? 0))),
      eligibilitySignal: round(mean(decisions.map((record) => record.eligibilitySignal ?? 0))),
    },
    withheldByGate: tally(withheld.map((record) => record.blockedBy ?? 'UNKNOWN')).map(
      ([gate, count]) => ({ gate, count }),
    ),
    byProduct: tally(nudged.map((record) => record.product ?? 'unknown')).map(
      ([product, count]) => ({ product, count }),
    ),
    servedBy: tally(decisions.map((record) => record.servedBy ?? 'unknown')).map(
      ([path, count]) => ({ path, count }),
    ),
  };
}
