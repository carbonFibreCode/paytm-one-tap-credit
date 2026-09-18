/**
 * Merchant QR codes — stickers and bills.
 *
 * Open this on a laptop and scan the codes with the app on a phone — that turns
 * the scanner from a simulation into a real end-to-end demo: a camera reads an
 * actual signed UPI intent, the server verifies it, the engine decides, and the
 * nudge appears.
 *
 * Two kinds, the same two a real merchant has:
 *
 *   static   the sticker by the till — one per merchant, never expires, no
 *            amount (the app pre-fills the demo amount at checkout)
 *   dynamic  a bill — generated below for one amount, expires in 15 minutes,
 *            refused after it is paid
 *
 * Both are rows in `payment_intents`; the SVG is rendered from the stored
 * payload. Without a database the page falls back to unsigned merchant labels,
 * which the scanner still accepts.
 */

import { renderQrSvg } from '@/lib/qr';
import { dbConfigured } from '@/lib/db/client';
import { ensureStaticIntents } from '@/lib/intents/store';
import { signingConfigured } from '@/lib/intents/sign';
import { MERCHANTS } from '@/lib/merchants';
import { buildUpiPayload, upiVpa } from '@/lib/upi';
import { formatINR } from '@/lib/format';
import { DynamicQr } from '@/components/DynamicQr';

export const metadata = {
  title: 'Merchant QR codes — One-Tap Credit',
  description: 'Scan these with the app to run the full payment flow from a real camera.',
};

// Static intents are created on first render; never bake them into the build.
export const dynamic = 'force-dynamic';

export default async function QrPage() {
  const stored = dbConfigured() ? await ensureStaticIntents().catch(() => []) : [];

  const codes = await Promise.all(
    MERCHANTS.map(async (merchant) => {
      const intent = stored.find((row) => row.merchantId === merchant.id) ?? null;
      const payload = intent?.payload ?? buildUpiPayload(merchant);
      return { merchant, intent, payload, svg: await renderQrSvg(payload) };
    }),
  );
  const signed = codes.some((code) => code.intent !== null);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-[22px] font-semibold text-body">Merchant QR codes</h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">
          Each code is a standard UPI intent — the same shape a real Paytm merchant QR carries.
          Open the app on a phone, tap <strong>Scan &amp; Pay</strong>, allow the camera, and point
          it at one of these.
        </p>
        <p className="mt-2 text-[11px] text-faint">
          {signed
            ? `Signed payment intents, stored in Postgres${
                signingConfigured() ? '' : ' (development signing key)'
              }. The scanner verifies the signature before it locks on — an altered code is refused.`
            : 'No database configured — showing unsigned merchant labels.'}{' '}
          QR decoding uses the browser&rsquo;s built-in detector, which Chrome on Android supports
          and Safari does not. On Safari the merchant list below the viewfinder does the same job.
        </p>
      </header>

      {signed ? (
        <section className="mb-8">
          <h2 className="mb-2 text-[13px] font-semibold text-body">Bill QR — the merchant&rsquo;s till</h2>
          <DynamicQr merchants={MERCHANTS} />
        </section>
      ) : null}

      <h2 className="mb-2 text-[13px] font-semibold text-body">Sticker QRs — one per merchant</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {codes.map(({ merchant, intent, payload, svg }) => (
          <article
            key={merchant.id}
            className="break-inside-avoid rounded-2xl border border-line bg-surface p-4"
          >
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-semibold"
                style={{
                  background: `${merchant.tint}1f`,
                  color: merchant.tint,
                  border: `1px solid ${merchant.tint}33`,
                }}
              >
                {merchant.monogram}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-body">{merchant.name}</p>
                <p className="truncate text-[10px] text-muted">{upiVpa(merchant)}</p>
              </div>
              <span className="shrink-0 text-right text-[10px] text-muted">
                <span className="block text-[12px] font-semibold text-brand">
                  {formatINR(merchant.suggestedAmount)}
                </span>
                pre-filled in app
              </span>
            </div>

            <div
              className="mt-3 overflow-hidden rounded-xl bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
              // The SVG is generated on the server from our own data — no user input reaches it.
              dangerouslySetInnerHTML={{ __html: svg }}
            />

            <p className="mt-2 text-[9px] leading-relaxed text-faint">
              {merchant.creditEnabled ? merchant.blurb : `${merchant.blurb} · outside credit network`}
              {intent ? (
                <>
                  {' · '}
                  <span className="text-brand">signed</span> · ref{' '}
                  <code className="font-mono">{intent.ref}</code>
                </>
              ) : null}
            </p>
            <code className="mt-1.5 block break-all font-mono text-[8px] leading-tight text-faint/70">
              {payload}
            </code>
          </article>
        ))}
      </div>

      <footer className="mt-10 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[13px] font-semibold text-body">What each one demonstrates</h2>
        <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted">
          <li>
            <strong className="text-body">Kroma Electronics ₹50,000</strong> — the headline nudge:
            Postpaid, 3 instalments of ₹16,667 at no cost.
          </li>
          <li>
            <strong className="text-body">Reliance Jewels ₹80,000</strong> — crosses the ₹75,000
            switch point, so the card wins over Postpaid.
          </li>
          <li>
            <strong className="text-body">BigBazaar ₹450</strong> — below the floor. No nudge, and
            the engine says why.
          </li>
          <li>
            <strong className="text-body">Rahul Sharma ₹35,000</strong> — a person-to-person
            transfer. Blocked outright, whatever the amount.
          </li>
          <li>
            <strong className="text-body">Sharma General Store</strong> — outside the credit
            network.
          </li>
          <li>
            <strong className="text-body">A bill QR, paid, then scanned again</strong> — refused:
            the intent is already paid. Edit one character of a payload and it is refused for a
            failed signature.
          </li>
        </ul>
      </footer>
    </main>
  );
}
