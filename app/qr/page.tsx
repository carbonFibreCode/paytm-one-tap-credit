/**
 * Printable merchant QR codes.
 *
 * Open this on a laptop and scan the codes with the app on a phone — that turns
 * the scanner from a simulation into a real end-to-end demo: a camera reads an
 * actual UPI QR, the engine decides, and the nudge appears.
 *
 * Rendered on the server as inline SVG, so there is no QR library in the client
 * bundle and the page prints cleanly.
 */

import QRCode from 'qrcode';
import { MERCHANTS } from '@/lib/merchants';
import { buildUpiPayload, upiVpa } from '@/lib/upi';
import { formatINR } from '@/lib/format';

export const metadata = {
  title: 'Merchant QR codes — One-Tap Credit',
  description: 'Scan these with the app to run the full payment flow from a real camera.',
};

export default async function QrPage() {
  const codes = await Promise.all(
    MERCHANTS.map(async (merchant) => {
      const payload = buildUpiPayload(merchant, merchant.suggestedAmount);
      const svg = await QRCode.toString(payload, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#05070f', light: '#ffffff' },
      });
      return { merchant, payload, svg };
    }),
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-[22px] font-semibold text-body">Merchant QR codes</h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">
          Each code is a standard UPI intent — the same shape a real Paytm merchant QR carries —
          with the amount pre-filled. Open the app on a phone, tap <strong>Scan &amp; Pay</strong>,
          allow the camera, and point it at one of these.
        </p>
        <p className="mt-2 text-[11px] text-faint">
          QR decoding uses the browser&rsquo;s built-in detector, which Chrome on Android supports
          and Safari does not. On Safari the merchant list below the viewfinder does the same job.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {codes.map(({ merchant, payload, svg }) => (
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
              <span className="shrink-0 text-[12px] font-semibold text-brand">
                {formatINR(merchant.suggestedAmount)}
              </span>
            </div>

            <div
              className="mt-3 overflow-hidden rounded-xl bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
              // The SVG is generated on the server from our own data — no user input reaches it.
              dangerouslySetInnerHTML={{ __html: svg }}
            />

            <p className="mt-2 text-[9px] leading-relaxed text-faint">
              {merchant.creditEnabled ? merchant.blurb : `${merchant.blurb} · outside credit network`}
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
        </ul>
      </footer>
    </main>
  );
}
