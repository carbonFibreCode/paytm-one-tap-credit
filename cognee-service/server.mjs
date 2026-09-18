/**
 * Cognee memory sidecar.
 *
 * Two endpoints, both called by n8n and by the Next.js app:
 *
 *   POST /remember  { userId, outcome, merchantCategory, product, at }
 *   POST /recall    { userId }  →  { memory: { acceptedCount, declinedCount, ... } }
 *
 * ## Why a sidecar
 *
 * `@cognee/cognee-ts` is a native Node addon — 257 MB of platform-specific
 * binary. It cannot run in a Vercel serverless function, so it lives here and
 * the app talks to it over HTTP.
 *
 * ## Why counts come from a ledger, not from the graph
 *
 * Every outcome is written twice: into Cognee's knowledge graph (semantic, good
 * for exploring and visualising), and into a small structured ledger on disk
 * (exact, good for arithmetic). `/recall` answers from the ledger.
 *
 * That is deliberate. A graph query returns generated prose, and prose is a
 * terrible basis for a lending decision — there is no way to audit it and
 * nothing stops it being subtly wrong. The graph is what you *explore*; the
 * ledger is what moves a score. It is the same separation the engine already
 * makes between Sarvam writing copy and the engine making decisions.
 */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load `.env` beside this file, so credentials live on disk rather than in a
// shell command that would end up in scrollback.
const ENV_FILE = new URL('.env', import.meta.url);
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = Number(process.env.PORT ?? 4000);
const DATASET = process.env.COGNEE_DATASET ?? 'one-tap-credit';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = path.join(HERE, '.data', 'outcomes.json');

// ---------------------------------------------------------------------------
// Cognee — optional. Without an LLM key the graph is skipped and the ledger
// still answers, so the sidecar is useful before any credentials arrive.
// ---------------------------------------------------------------------------

let cognee = null;
let cogneeStatus = 'not initialised';

async function initCognee() {
  if (!process.env.OPENAI_TOKEN) {
    cogneeStatus = 'disabled — OPENAI_TOKEN not set (Cognee needs an LLM to build the graph)';
    return;
  }
  try {
    const { init, Cognee } = await import('@cognee/cognee-ts');
    init();
    cognee = new Cognee({
      llmModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      llmApiKey: process.env.OPENAI_TOKEN,
    });
    await cognee.warm();
    cogneeStatus = 'ready';
    console.log(`[cognee] ready · dataset "${DATASET}"`);
  } catch (error) {
    cognee = null;
    cogneeStatus = `failed — ${error?.message ?? error}`;
    console.warn(`[cognee] ${cogneeStatus}`);
  }
}

// ---------------------------------------------------------------------------
// Structured ledger — the exact record `/recall` answers from.
// ---------------------------------------------------------------------------

async function readLedger() {
  try {
    return JSON.parse(await readFile(LEDGER, 'utf8'));
  } catch {
    return [];
  }
}

async function appendLedger(entry) {
  const entries = await readLedger();
  entries.push(entry);
  await mkdir(path.dirname(LEDGER), { recursive: true });
  await writeFile(LEDGER, JSON.stringify(entries, null, 2), 'utf8');
  return entries;
}

function summarise(entries, userId) {
  const mine = entries.filter((entry) => entry.userId === userId);
  return {
    acceptedCount: mine.filter((entry) => entry.outcome === 'accepted').length,
    declinedCount: mine.filter((entry) => entry.outcome === 'declined').length,
    declinedCategories: [
      ...new Set(
        mine
          .filter((entry) => entry.outcome === 'declined' && entry.merchantCategory)
          .map((entry) => entry.merchantCategory),
      ),
    ],
    source: 'cognee',
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleRemember(body) {
  const { userId, outcome } = body;
  if (!userId || !['shown', 'accepted', 'declined'].includes(outcome)) {
    return { status: 400, payload: { error: '`userId` and a valid `outcome` are required' } };
  }

  const entry = {
    userId,
    transactionId: body.transactionId ?? 'unknown',
    product: body.product ?? null,
    merchantCategory: body.merchantCategory ?? null,
    outcome,
    at: body.at ?? new Date().toISOString(),
  };

  await appendLedger(entry);

  // The graph write is best-effort: the ledger is already durable, and a slow
  // or failing graph must not turn into a failed outcome report.
  let graph = 'skipped';
  if (cognee) {
    const statement =
      `User ${entry.userId} ${entry.outcome} a ${entry.product ?? 'credit'} offer` +
      (entry.merchantCategory ? ` on a ${entry.merchantCategory} purchase` : '') +
      ` on ${entry.at.slice(0, 10)}.`;
    try {
      await cognee.remember({ type: 'text', text: statement }, DATASET);
      graph = 'written';
    } catch (error) {
      graph = `failed — ${error?.message ?? error}`;
    }
  }

  return { status: 200, payload: { stored: true, graph, cognee: cogneeStatus } };
}

async function handleRecall(body) {
  if (!body.userId) {
    return { status: 400, payload: { error: '`userId` is required' } };
  }
  const memory = summarise(await readLedger(), body.userId);
  return { status: 200, payload: { memory, cognee: cogneeStatus } };
}

/**
 * Ask the knowledge graph a question in plain language.
 *
 * Exposed for the demo — it is genuinely impressive to query and visualise — but
 * deliberately *not* wired into scoring. Prose does not move a credit decision.
 */
async function handleAsk(body) {
  if (!cognee) {
    return { status: 503, payload: { error: `Cognee unavailable: ${cogneeStatus}` } };
  }
  const result = await cognee.recall(body.question ?? 'What happened recently?');
  return { status: 200, payload: { answer: result?.searchResponse?.result?.data ?? null } };
}

const ROUTES = { '/remember': handleRemember, '/recall': handleRecall, '/ask': handleAsk };

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  if (req.method === 'GET' && req.url === '/health') {
    return res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ status: 'ok', dataset: DATASET, cognee: cogneeStatus }));
  }

  const handler = ROUTES[req.url ?? ''];
  if (req.method !== 'POST' || !handler) {
    return res.writeHead(404, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: 'Not found' }));
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const { status, payload } = await handler(body);
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: error?.message ?? String(error) }));
  }
}).listen(PORT, async () => {
  console.log(`[cognee-service] listening on http://localhost:${PORT}`);
  await initCognee();
});
