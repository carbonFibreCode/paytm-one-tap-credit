'use client';

/**
 * The nudge.
 *
 * Three things here are deliberate rather than decorative:
 *
 *  - The card animates in immediately and the copy line shimmers until Sarvam
 *    responds. The offer never waits on a language model.
 *  - "No thanks, pay normally" carries the same visual weight as the accept
 *    button. RBI and NPCI guidance on customer choice is not a slide for us; a
 *    decline the user cannot find is a dark pattern.
 *  - "Why am I seeing this?" is on the card itself, not buried in settings.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import type { Decision } from '@/lib/types';
import { formatINR } from '@/lib/format';
import type { NudgeCopy } from '@/lib/client/state';
import { DecisionTrace } from './DecisionTrace';
import { Pill } from './Chrome';

export function NudgeCard({
  decision,
  copy,
  copyLoading,
  amount,
  onAccept,
  onDecline,
}: {
  decision: Decision;
  copy: NudgeCopy | null;
  copyLoading: boolean;
  amount: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [showTrace, setShowTrace] = useState(false);
  const offer = decision.offer;
  if (!offer) return null;

  const headline = offer.tenures.find((tenure) => tenure.noCost) ?? offer.tenures[0];

  return (
    <motion.div
      initial={{ y: '100%', opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.9 }}
      className="pointer-events-auto rounded-t-3xl border-t border-brand/25 bg-gradient-to-b from-[#0d2a4a] to-surface shadow-[0_-18px_50px_-12px_rgba(0,186,242,0.28)]"
    >
      <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/15" />

      <div className="space-y-3.5 px-5 pb-5 pt-3">
        <div className="flex items-center gap-2">
          <Pill tone="brand">Pre-approved</Pill>
          <span className="truncate text-[11px] text-muted">{offer.partner}</span>
          <span className="ml-auto shrink-0 text-[11px] text-faint">
            limit {formatINR(offer.available)}
          </span>
        </div>

        {/* The generated line. Shimmers rather than blocking the card. */}
        <div className="min-h-[52px]">
          {copyLoading && !copy ? (
            <div className="space-y-2" aria-live="polite" aria-busy="true">
              <div className="shimmer h-4 w-full rounded" />
              <div className="shimmer h-4 w-3/4 rounded" />
            </div>
          ) : (
            <p className="text-[17px] font-semibold leading-snug text-white">
              {copy?.text ?? decision.trace.summary}
            </p>
          )}
        </div>

        {/* Plans. Read-only here; the tenure is chosen on the next screen. */}
        <div className="flex gap-2 overflow-x-auto scroll-none">
          {offer.tenures.map((tenure) => (
            <div
              key={tenure.months}
              className={`shrink-0 rounded-xl border px-3 py-2 ${
                tenure.months === headline.months
                  ? 'border-brand/50 bg-brand/10'
                  : 'border-line bg-elevated/60'
              }`}
            >
              <div className="text-[13px] font-semibold text-white">
                {formatINR(tenure.emi)}
                <span className="text-[10px] font-normal text-muted">/mo</span>
              </div>
              <div className="text-[10px] text-muted">
                {tenure.months} months{tenure.noCost ? ' · no cost' : ''}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onAccept}
          className="cta-glow w-full rounded-2xl bg-brand py-3.5 text-[15px] font-semibold text-[#03253a] transition active:scale-[0.98]"
        >
          Activate &amp; Pay {formatINR(amount)}
        </button>

        {/* Equal weight, by design. */}
        <button
          type="button"
          onClick={onDecline}
          className="w-full rounded-2xl border border-line bg-elevated py-3 text-[14px] font-medium text-body transition hover:bg-line active:scale-[0.98]"
        >
          {decision.decline?.label ?? 'No thanks, pay normally'}
        </button>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowTrace((open) => !open)}
            className="text-[11px] text-brand underline-offset-2 hover:underline"
            aria-expanded={showTrace}
          >
            Why am I seeing this? {showTrace ? '▴' : '▾'}
          </button>
          {copy ? <CopySource copy={copy} /> : null}
        </div>

        <AnimatePresence initial={false}>
          {showTrace ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <DecisionTrace decision={decision} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** Where the copy came from — useful in the demo, honest in principle. */
function CopySource({ copy }: { copy: NudgeCopy }) {
  const isLive = copy.source === 'sarvam';
  return (
    <span
      title={copy.reason ?? undefined}
      className={`shrink-0 text-[10px] ${isLive ? 'text-good' : 'text-faint'}`}
    >
      {isLive
        ? `Sarvam${copy.latencyMs ? ` · ${copy.latencyMs}ms` : ''}`
        : copy.source === 'cache'
          ? 'Sarvam · cached'
          : 'template fallback'}
    </span>
  );
}
