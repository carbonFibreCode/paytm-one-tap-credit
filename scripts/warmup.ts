/**
 * Wake everything up before presenting.
 *
 *   npm run warmup                     # the deployed app
 *   npm run warmup -- http://localhost:3000
 *
 * Three things go cold and each costs a second on the first request:
 *
 *   Neon compute   suspends after ~5 minutes idle on the free plan, and that
 *                  is not configurable there — so it *will* be asleep if you
 *                  set up and then talk for ten minutes.
 *   Vercel lambda  cold starts after a quiet spell.
 *   Cognee recall  is served from an in-process cache that a cold start empties.
 *
 * Run this a minute before you present. It reports the second timing for each
 * step, which is the number you will actually see on stage.
 */

const base = (process.argv[2] ?? 'https://paytm-one-tap-credit.vercel.app').replace(/\/+$/, '');

async function time(label: string, run: () => Promise<unknown>): Promise<number> {
  const startedAt = Date.now();
  try {
    await run();
  } catch (error) {
    console.log(`  ${label.padEnd(22)} FAILED — ${error instanceof Error ? error.message : error}`);
    return -1;
  }
  const ms = Date.now() - startedAt;
  console.log(`  ${label.padEnd(22)} ${ms}ms`);
  return ms;
}

async function json(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

const decision = { userId: 'u_rohit', merchantId: 'm_kroma', amount: 50_000 };

async function main(): Promise<void> {
  console.log(`warming ${base}\n`);

  console.log('first pass (cold):');
  await time('health', () => json('/api/health'));
  await time('decide', () => json('/api/decide', decision));
  await time('intents', () => json('/api/intents'));
  await time('qr page', () => fetch(`${base}/qr`).then((r) => r.text()));

  console.log('\nsecond pass (what you will see):');
  await time('health', () => json('/api/health'));
  const warm = await time('decide', () => json('/api/decide', decision));
  await time('intents', () => json('/api/intents'));

  const health = (await json('/api/health')) as {
    database?: { reachable?: boolean; decisions?: number };
    configured?: Record<string, boolean>;
    nudgeCopy?: string;
  };

  console.log('\nready check:');
  const ok = (label: string, good: boolean, detail = '') =>
    console.log(`  ${good ? 'ok  ' : 'WARN'} ${label.padEnd(22)} ${detail}`);

  ok('database reachable', health.database?.reachable === true);
  ok(
    'QR signing key set',
    health.configured?.signing === true,
    health.configured?.signing ? '' : 'printed codes will be refused',
  );
  ok('decision under 400ms', warm > 0 && warm < 400, `${warm}ms`);
  ok(
    'trail is clean',
    (health.database?.decisions ?? 0) === 0,
    `${health.database?.decisions ?? '?'} decisions logged`,
  );
  console.log(
    `  note nudge copy           ${health.nudgeCopy === 'sarvam' ? 'Sarvam (live)' : 'templates — SARVAM_API_KEY not set'}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
