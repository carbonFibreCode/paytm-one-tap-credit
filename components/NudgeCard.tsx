'use client';

/**
 * The nudge.
 *
 * A compact card sitting in the normal flow between the amount and the keypad —
 * not a sheet covering them. That is deliberate: a panel that slides over the
 * keypad forces the user to dismiss it before they can keep typing, and every
 * appearance shifts what is under their thumb.
 *
 * Two things here are principle rather than decoration:
 *
 *  - The dismiss control is a real, reachable X. RBI and NPCI guidance on
 *    customer choice is not a slide for us; a decline you cannot find is a dark
 *    pattern.
 *  - The copy line shimmers until Sarvam answers. The offer never waits on a
 *    language model.
 */

import { motion } from 'framer-motion';
import { Coins, X } from 'lucide-react';
import type { Decision } from '@/lib/types';
import { formatINR } from '@/lib/format';
import { useApp, type NudgeCopy } from '@/lib/client/state';

export function NudgeCard({
  decision,
  copy,
  copyLoading,
  onAccept,
  onDecline,
}: {
  decision: Decision;
  copy: NudgeCopy | null;
  copyLoading: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { toggleTrace, explainMode } = useApp();
  const offer = decision.offer;
  if (!offer) return null;

  const headline = offer.tenures.find((tenure) => tenure.noCost) ?? offer.tenures[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="relative w-full rounded-2xl border border-brand/45 bg-elevated/80 p-3 pr-8 text-left"
    >
      <button
        type="button"
        onClick={onDecline}
        aria-label="Dismiss this offer and pay normally"
        className="absolute right-1.5 top-1.5 rounded-lg p-1.5 text-faint transition hover:bg-line hover:text-body active:scale-95"
      >
        <X size={13} />
      </button>

      <button type="button" onClick={onAccept} className="flex w-full items-center gap-3 text-left">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
          <Coins size={20} />
        </span>

        <span className="min-w-0 flex-1">
          {copyLoading && !copy ? (
            <span className="block space-y-1.5 py-0.5" aria-busy="true">
              <span className="shimmer block h-3 w-full rounded" />
              <span className="shimmer block h-3 w-2/3 rounded" />
            </span>
          ) : (
            <span className="block text-[13px] font-semibold leading-snug text-white">
              {copy?.text ?? decision.trace.summary}
            </span>
          )}

          <span className="mt-1 flex items-center gap-2">
            <span className="text-[11px] text-brand underline underline-offset-2">Learn more</span>
            <span className="text-[10px] text-faint">
              {headline.months} &times; {formatINR(headline.emi)}
              {headline.noCost ? ' · no cost' : ''}
            </span>
          </span>
        </span>
      </button>

      <div className="mt-2 flex items-center justify-between border-t border-line/70 pt-2">
        <button
          type="button"
          onClick={() => toggleTrace(true)}
          className="text-[10px] text-muted underline-offset-2 hover:text-brand hover:underline"
        >
          Why am I seeing this?
        </button>
        {explainMode && copy ? <CopySource copy={copy} /> : null}
      </div>
    </motion.div>
  );
}

/** Where the copy came from — useful in the demo, hidden in production view. */
function CopySource({ copy }: { copy: NudgeCopy }) {
  const isLive = copy.source === 'sarvam';
  return (
    <span
      title={copy.reason ?? undefined}
      className={`shrink-0 text-[9px] ${isLive ? 'text-good' : 'text-faint'}`}
    >
      {isLive
        ? `Sarvam${copy.latencyMs ? ` · ${copy.latencyMs}ms` : ''}`
        : copy.source === 'cache'
          ? 'Sarvam · cached'
          : 'template'}
    </span>
  );
}
