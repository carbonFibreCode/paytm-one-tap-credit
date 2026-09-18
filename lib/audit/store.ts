/**
 * Append-only decision log.
 *
 * Slide 11 of the deck promises "a human-readable audit trail on every nudge
 * decision". This is where that trail is kept: one JSON object per line, in a
 * file, written by the n8n workflow rather than by the request path — so
 * logging can never slow down or break a payment.
 *
 * A file rather than a database on purpose. It needs no credentials, it works
 * with the venue wifi unplugged, and `tail -f` on it during the demo is a more
 * convincing artefact than a dashboard we drew ourselves.
 *
 * Serverless hosts give you a read-only, ephemeral filesystem, so every write is
 * mirrored into an in-process buffer and file errors are swallowed. On Vercel
 * the buffer survives a warm lambda but not a cold start — which is the gap the
 * database closes. When `DATABASE_URL` is set, every record is also written to
 * Postgres and reads come from there first; the file and buffer stay as the
 * fallback, so an unreachable database degrades to exactly what ran before.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DecisionTrace } from '../types';
import { round } from '../math';
import { dbConfigured } from '../db/client';
import { insertRecord, readRecordsFromDb } from './db';

const DATA_DIR = path.join(process.cwd(), '.data');
const LOG_PATH = path.join(DATA_DIR, 'decisions.jsonl');

export interface AuditRecord {
  at: string;
  type: 'decision' | 'outcome';
  transactionId: string;
  userId: string;
  userName?: string;
  amount?: number;
  merchantName?: string;
  merchantCategory?: string;
  showNudge?: boolean;
  product?: string | null;
  score?: number;
  eligibilitySignal?: number;
  blockedBy?: string | null;
  blockedReason?: string | null;
  /** 'n8n' when the orchestrated path served it, 'direct' otherwise. */
  servedBy?: string;
  latencyMs?: number;
  /** For outcome records. */
  outcome?: 'shown' | 'accepted' | 'declined';
  nudgeSource?: string;
  /** Full gates/factors breakdown, kept so an old decision stays explainable. */
  trace?: DecisionTrace;
  engineVersion?: string;
}

/** Mirrors the file so reads still work where the filesystem is read-only. */
const buffer: AuditRecord[] = [];
let fileWritable = true;

/** Where the last read was answered from — surfaced by the health endpoint. */
export type AuditBackend = 'database' | 'file' | 'memory';
let lastBackend: AuditBackend = 'memory';
export function auditBackend(): AuditBackend {
  return dbConfigured() ? lastBackend : fileWritable ? 'file' : 'memory';
}

export async function appendRecord(record: AuditRecord): Promise<void> {
  buffer.push(record);

  // Database and file are written together; neither failing stops the other.
  await Promise.allSettled([appendToDb(record), appendToFile(record)]);
}

async function appendToDb(record: AuditRecord): Promise<void> {
  if (!dbConfigured()) return;
  try {
    await insertRecord(record);
  } catch (error) {
    // Logging is a side-effect. Report it, keep the file copy, never rethrow.
    console.warn('[audit] database write failed:', (error as Error).message);
  }
}

async function appendToFile(record: AuditRecord): Promise<void> {
  if (!fileWritable) return;
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // Read-only filesystem: stop trying, and let the buffer answer reads.
    fileWritable = false;
  }
}

export async function readRecords(): Promise<AuditRecord[]> {
  if (dbConfigured()) {
    try {
      const records = await readRecordsFromDb();
      lastBackend = 'database';
      return records;
    } catch (error) {
      console.warn('[audit] database read failed, using local trail:', (error as Error).message);
      lastBackend = fileWritable ? 'file' : 'memory';
    }
  }

  if (!fileWritable) return [...buffer];

  try {
    const raw = await readFile(LOG_PATH, 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as AuditRecord];
        } catch {
          // A half-written final line must not break the digest.
          return [];
        }
      });
  } catch {
    return [...buffer];
  }
}

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
