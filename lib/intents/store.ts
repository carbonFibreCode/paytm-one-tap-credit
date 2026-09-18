/**
 * Payment intents — the lifecycle behind a QR code.
 *
 *   static   one per merchant, printed, never expires, no amount
 *   dynamic  one per bill, generated at the till with the amount, expires
 *
 *   created ──scan──▶ scanned ──pay──▶ paid
 *       └────────── expires_at passes ──▶ expired
 *
 * `scanIntent()` is the payer-side check a UPI app performs before it shows a
 * pay screen: signature verifies, the reference is one we issued, the payload
 * is byte-for-byte what we issued, and it is neither expired nor already paid.
 * Any failure names its reason so the scanner can say *why* it refused.
 */

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, withTimeout } from '../db/client';
import { insertIntentSchema, paymentIntents, type IntentRow } from '../db/schema';
import { getMerchant, MERCHANTS, type Merchant } from '../fixtures/merchants';
import { buildUpiPayload, handleFor, merchantCategoryCode, parseUpiPayload, upiVpa } from '../upi';
import { log } from '../log';
import { signIntent, verifyIntent } from './sign';

/** How long a bill's QR stays payable. */
export const DYNAMIC_TTL_MINUTES = 15;

/** `OTCS` + merchant handle: stable, so the printed sticker is always the same code. */
export function staticRef(merchant: Merchant): string {
  return `OTCS${handleFor(merchant).toUpperCase()}`;
}

/** `OTCD` + handle + 10 hex chars: unique per bill, readable on a receipt. */
export function dynamicRef(merchant: Merchant): string {
  return `OTCD${handleFor(merchant).toUpperCase()}${randomBytes(5).toString('hex').toUpperCase()}`;
}

function draft(
  merchant: Merchant,
  kind: 'static' | 'dynamic',
  amount: number | undefined,
  ref: string,
  now: string,
  ttlMinutes = DYNAMIC_TTL_MINUTES,
) {
  const unsigned = buildUpiPayload(merchant, amount, { tr: ref });
  const signature = signIntent(unsigned);
  return insertIntentSchema.parse({
    ref,
    merchantId: merchant.id,
    vpa: upiVpa(merchant),
    mcc: merchantCategoryCode(merchant),
    kind,
    amount: amount ?? null,
    payload: buildUpiPayload(merchant, amount, { tr: ref, sign: signature }),
    signature,
    status: 'created',
    expiresAt:
      kind === 'dynamic' ? new Date(Date.parse(now) + ttlMinutes * 60_000).toISOString() : null,
    createdAt: now,
  });
}

/** Every merchant's static code, created on first call and stable after that. */
export async function ensureStaticIntents(now = new Date().toISOString()): Promise<IntentRow[]> {
  const client = db();
  if (!client) return [];
  await withTimeout(
    client
      .insert(paymentIntents)
      .values(
        MERCHANTS.map((merchant) => draft(merchant, 'static', undefined, staticRef(merchant), now)),
      )
      .onConflictDoNothing({ target: paymentIntents.ref }),
  );
  return withTimeout(client.select().from(paymentIntents).where(eq(paymentIntents.kind, 'static')));
}

/** A bill: this merchant, this amount, payable for the next `ttlMinutes`. */
export async function createDynamicIntent(
  merchantId: string,
  amount: number,
  now = new Date().toISOString(),
  ttlMinutes = DYNAMIC_TTL_MINUTES,
): Promise<IntentRow> {
  const client = db();
  if (!client) throw new Error('database not configured');
  const merchant = getMerchant(merchantId);
  if (!merchant) throw new Error(`Unknown merchantId \`${merchantId}\``);
  const [row] = await withTimeout(
    client
      .insert(paymentIntents)
      .values(draft(merchant, 'dynamic', amount, dynamicRef(merchant), now, ttlMinutes))
      .returning(),
  );
  return row;
}

export async function findIntent(ref: string): Promise<IntentRow | null> {
  const client = db();
  if (!client) return null;
  const [row] = await withTimeout(
    client.select().from(paymentIntents).where(eq(paymentIntents.ref, ref)).limit(1),
  );
  return row ?? null;
}

export type IntentState = 'created' | 'scanned' | 'paid' | 'expired';

/** Pure: the stored status, overridden by the clock when the code has expired. */
export function intentState(
  row: Pick<IntentRow, 'status' | 'expiresAt'>,
  now: string | Date,
): IntentState {
  if (row.status === 'paid') return 'paid';
  if (row.expiresAt && row.expiresAt.getTime() <= new Date(now).getTime()) return 'expired';
  return row.status;
}

export type ScanRefusal = 'unsigned' | 'tampered' | 'unknown' | 'mismatch' | 'expired' | 'paid';

export type ScanResult =
  | { ok: true; intent: IntentRow; merchantId: string; amount?: number }
  | { ok: false; reason: ScanRefusal; status: number; message: string };

const REFUSALS: Record<ScanRefusal, { status: number; message: string }> = {
  unsigned: { status: 400, message: 'This QR carries no payment intent.' },
  tampered: {
    status: 401,
    message: 'Signature check failed — this QR has been altered. Do not pay.',
  },
  unknown: { status: 404, message: 'This QR was not issued by us.' },
  mismatch: { status: 401, message: 'This QR does not match the intent it claims to be.' },
  expired: { status: 410, message: 'This bill has expired. Ask the merchant for a fresh QR.' },
  paid: { status: 409, message: 'This bill has already been paid.' },
};

function refuse(reason: ScanRefusal, ref?: string): ScanResult {
  // A refusal is the security control working; it should be visible.
  log.info({ event: 'intent.refused', reason, ref });
  return { ok: false, reason, ...REFUSALS[reason] };
}

/** The payer-side check. Marks a fresh intent as scanned on success. */
export async function scanIntent(
  payload: string,
  now = new Date().toISOString(),
): Promise<ScanResult> {
  const parsed = parseUpiPayload(payload);
  if (!parsed?.tr) return refuse('unsigned');
  if (!verifyIntent(payload)) return refuse('tampered', parsed.tr);

  const row = await findIntent(parsed.tr);
  if (!row) return refuse('unknown', parsed.tr);
  if (row.payload !== payload) return refuse('mismatch', parsed.tr);

  const state = intentState(row, now);
  if (state === 'expired') return refuse('expired', row.ref);
  if (state === 'paid') return refuse('paid', row.ref);

  if (state === 'created') {
    await withTimeout(
      db()!
        .update(paymentIntents)
        .set({ status: 'scanned', scannedAt: new Date(now) })
        .where(eq(paymentIntents.ref, row.ref)),
    );
  }
  return {
    ok: true,
    intent: { ...row, status: 'scanned', scannedAt: row.scannedAt ?? new Date(now) },
    merchantId: row.merchantId,
    amount: row.amount ?? undefined,
  };
}

/** Record which decision a scan led to. Best-effort; the trail has the key either way. */
export async function attachDecision(ref: string, decisionKey: string): Promise<void> {
  const client = db();
  if (!client) return;
  await withTimeout(
    client.update(paymentIntents).set({ decisionKey }).where(eq(paymentIntents.ref, ref)),
  );
}
