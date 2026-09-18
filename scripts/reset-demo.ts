/**
 * Reset the demo database to a clean slate.
 *
 *   npm run db:reset -- --dry-run     show what would go, change nothing
 *   npm run db:reset -- --yes         do it
 *
 * Clears every row the demo writes — decisions, outcomes, payments, credit
 * accounts, instalment schedules and spent bill QRs — then recreates the eight
 * static merchant codes.
 *
 * Two things make this safe to run right before presenting:
 *
 *   1. `decisions` is append-only: a trigger rejects DELETE, so this uses
 *      TRUNCATE, which row-level triggers do not see. Wiping the trail is a
 *      deliberate act, which is exactly why it takes a flag.
 *
 *   2. A static QR's reference and signature are both derived — the merchant
 *      handle and an HMAC over the payload — so recreating them reproduces
 *      byte-identical codes. Anything already printed keeps working. This
 *      script proves that rather than assuming it: it captures the payloads
 *      before the truncate and compares them after.
 */

import { sql } from 'drizzle-orm';
import { db, dbConfigured } from '../lib/db/client';
import { paymentIntents } from '../lib/db/schema';
import { ensureStaticIntents } from '../lib/intents/store';
import { signingConfigured } from '../lib/intents/sign';

/** Every table the demo writes to. Order is irrelevant — one TRUNCATE, one transaction. */
const DEMO_TABLES = [
  'decisions',
  'nudge_events',
  'emi_installments',
  'credit_accounts',
  'payments',
  'payment_intents',
] as const;

const COUNTS = sql`
  select 'decisions' as t, count(*)::int as n from decisions
  union all select 'nudge_events', count(*)::int from nudge_events
  union all select 'payments', count(*)::int from payments
  union all select 'credit_accounts', count(*)::int from credit_accounts
  union all select 'emi_installments', count(*)::int from emi_installments
  union all select 'payment_intents (static)', count(*)::int from payment_intents where kind = 'static'
  union all select 'payment_intents (dynamic)', count(*)::int from payment_intents where kind = 'dynamic'
  order by 1
`;

async function counts(): Promise<Array<{ t: string; n: number }>> {
  const result = await db()!.execute(COUNTS);
  return result.rows as Array<{ t: string; n: number }>;
}

function show(label: string, rows: Array<{ t: string; n: number }>): void {
  console.log(`\n${label}`);
  for (const row of rows) console.log(`  ${row.t.padEnd(26)} ${row.n}`);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const confirmed = args.has('--yes');

  if (!dbConfigured()) {
    console.error('DATABASE_URL is not set — nothing to reset.');
    process.exit(1);
  }

  // Say which database, so a reset can never land on the wrong one unnoticed.
  const host = new URL(process.env.DATABASE_URL!).host;
  console.log(`database : ${host}`);
  console.log(
    `signing  : ${signingConfigured() ? 'configured' : 'DEVELOPMENT KEY — printed QRs will not match production'}`,
  );

  const before = await counts();
  show('before', before);

  if (!dryRun && !confirmed) {
    console.log('\nThis deletes every row above, including the audit trail.');
    console.log('Re-run with --yes to do it, or --dry-run to see this without changing anything.');
    process.exit(1);
  }

  // Keep the static payloads so the recreated codes can be proven identical.
  const client = db()!;
  const previous = await client
    .select({ ref: paymentIntents.ref, payload: paymentIntents.payload })
    .from(paymentIntents)
    .where(sql`kind = 'static'`);

  if (dryRun) {
    console.log(`\n[dry run] would TRUNCATE ${DEMO_TABLES.join(', ')}`);
    console.log(`[dry run] would recreate ${previous.length || 8} static merchant codes`);
    return;
  }

  // One statement, one transaction: the tables reference each other, and a
  // half-cleared ledger is worse than a full one.
  await client.execute(
    sql.raw(`truncate table ${DEMO_TABLES.join(', ')} restart identity cascade`),
  );

  const recreated = await ensureStaticIntents();

  // Prove the printed codes still scan.
  const byRef = new Map(recreated.map((row) => [row.ref, row.payload]));
  const changed = previous.filter((row) => byRef.get(row.ref) !== row.payload);
  const missing = previous.filter((row) => !byRef.has(row.ref));

  show('after', await counts());

  if (previous.length === 0) {
    console.log(`\nstatic codes : ${recreated.length} created (none to compare against)`);
  } else if (changed.length === 0 && missing.length === 0) {
    console.log(
      `\nstatic codes : ${recreated.length} recreated, all byte-identical — printed QRs still scan`,
    );
  } else {
    console.error(`\nstatic codes : ${changed.length} changed, ${missing.length} missing`);
    for (const row of [...changed, ...missing]) console.error(`  ${row.ref}`);
    console.error('Anything already printed will now be refused. Reprint from /qr.');
    process.exitCode = 1;
  }

  console.log("\nStill to do by hand: clear the demo phone's site data, or use");
  console.log('the drawer\'s "Reset user" on each persona — nudge history and');
  console.log('payments live in localStorage and this cannot reach them.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
