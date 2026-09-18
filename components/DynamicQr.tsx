'use client';

/**
 * The merchant's till: generate a QR for one bill.
 *
 * A dynamic QR is what a POS prints for a specific amount — it carries the
 * amount, a unique reference and a signature, and it expires. Scanning it in
 * the app fixes the amount at checkout, and paying it marks the intent paid.
 */

import { useEffect, useState } from 'react';
import { formatINR } from '@/lib/format';
import { renderQrSvg } from '@/lib/qr';
import type { Merchant } from '@/lib/fixtures/merchants';

interface Issued {
  ref: string;
  payload: string;
  amount: number;
  expiresAt: string;
  svg: string;
}

export function DynamicQr({ merchants }: { merchants: Merchant[] }) {
  const [merchantId, setMerchantId] = useState(merchants[0]?.id ?? '');
  const [amount, setAmount] = useState(merchants[0]?.suggestedAmount ?? 0);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A ticking clock, so the countdown and the expired state are live.
  useEffect(() => {
    if (!issued) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [issued]);

  const merchant = merchants.find((candidate) => candidate.id === merchantId);
  const secondsLeft = issued
    ? Math.max(0, Math.round((Date.parse(issued.expiresAt) - now) / 1_000))
    : 0;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId, amount }),
      });
      const body = (await response.json()) as {
        intent?: { ref: string; payload: string; amount: number; expiresAt: string };
        error?: string;
      };
      if (!response.ok || !body.intent) throw new Error(body.error ?? `${response.status}`);
      const svg = await renderQrSvg(body.intent.payload);
      setIssued({ ...body.intent, svg });
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-brand/40 bg-surface p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[10px] font-medium text-muted">
          Merchant
          <select
            value={merchantId}
            onChange={(event) => {
              setMerchantId(event.target.value);
              const next = merchants.find((candidate) => candidate.id === event.target.value);
              if (next) setAmount(next.suggestedAmount);
            }}
            className="rounded-lg border border-line bg-elevated px-2.5 py-2 text-[12px] text-body"
          >
            {merchants.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-[140px] flex-col gap-1 text-[10px] font-medium text-muted">
          Amount (₹)
          <input
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(event) => setAmount(Math.max(0, Math.round(Number(event.target.value))))}
            className="rounded-lg border border-line bg-elevated px-2.5 py-2 text-[12px] tabular-nums text-body"
          />
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={busy || !merchant || amount <= 0}
          className="rounded-lg bg-brand px-4 py-2 text-[12px] font-semibold text-[#03253a] transition active:scale-95 disabled:opacity-50"
        >
          {busy ? 'Issuing…' : 'Generate bill QR'}
        </button>
      </div>

      {error ? <p className="mt-3 text-[11px] text-[#ff6b6b]">{error}</p> : null}

      {issued && merchant ? (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <div
            className={`w-full max-w-[260px] shrink-0 overflow-hidden rounded-xl bg-white p-2 [&>svg]:h-full [&>svg]:w-full ${
              secondsLeft === 0 ? 'opacity-30 grayscale' : ''
            }`}
            // Rendered from our own signed payload — no user input reaches the SVG.
            dangerouslySetInnerHTML={{ __html: issued.svg }}
          />
          <div className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted">
            <p className="text-[13px] font-semibold text-body">
              {merchant.name} · {formatINR(issued.amount)}
            </p>
            <p className="mt-1">
              Reference <code className="font-mono text-body">{issued.ref}</code>
            </p>
            <p className={secondsLeft === 0 ? 'text-[#ff6b6b]' : 'text-brand'}>
              {secondsLeft === 0
                ? 'Expired — the scanner will refuse it. Generate a fresh one.'
                : `Payable for ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}
            </p>
            <p className="mt-2 text-[10px] text-faint">
              Signed intent, stored as a row — the image is rendered from it. Scanning fixes the
              amount at checkout; paying marks it paid; scanning again is refused.
            </p>
            <code className="mt-2 block break-all font-mono text-[8px] leading-tight text-faint/70">
              {issued.payload}
            </code>
          </div>
        </div>
      ) : null}
    </section>
  );
}
