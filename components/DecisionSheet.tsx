'use client';

/**
 * The full audit trail, given room to breathe.
 *
 * The checkout only ever shows the score and the single requirement that was
 * not met. Everything else — all fourteen checks, every score factor, every
 * signal component — lives here, one tap away, so the payment screen stays a
 * payment screen.
 */

import { X } from 'lucide-react';
import type { Decision } from '@/lib/types';
import { useApp } from '@/lib/client/state';
import { weakestSignal } from '@/lib/engine/explain';
import { humaniseGate } from '@/lib/format';
import { DecisionTrace } from './DecisionTrace';
import { Sheet } from './Sheet';
import { Pill } from './Chrome';
import { Bar } from './ui';

export function DecisionSheet() {
  const { traceOpen, toggleTrace, decision, clearHistory } = useApp();

  return (
    <Sheet
      open={traceOpen && Boolean(decision)}
      onClose={() => toggleTrace(false)}
      label="Decision details"
      maxHeightClass="max-h-[92%]"
      header={
        decision ? (
          <div className="flex items-start gap-3 border-b border-line px-5 pb-3 pt-1">
            <div className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <Pill tone={decision.showNudge ? 'good' : 'bad'}>
                  {decision.showNudge ? 'Offer shown' : 'No nudge'}
                </Pill>
                <span className="truncate text-[12px] font-semibold text-body">
                  {decision.showNudge
                    ? 'All checks passed'
                    : humaniseGate(decision.blockedBy ?? 'SCORE_THRESHOLD')}
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => toggleTrace(false)}
              aria-label="Close decision details"
              className="-mr-1 shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-elevated hover:text-body"
            >
              <X size={16} />
            </button>
          </div>
        ) : null
      }
    >
      {decision ? (
        <div className="scroll-slim flex-1 space-y-4 overflow-y-auto px-5 pb-6 pt-4">
          <p className="text-[12px] leading-relaxed text-body">
            {decision.blockedReason ?? decision.trace.summary}
          </p>

          <div className="flex gap-2">
            <Stat label="Relevance" value={decision.score} />
            <Stat label="Eligibility signal" value={decision.eligibilitySignal} />
          </div>

          {decision.showNudge ? null : <Shortfall decision={decision} />}

          {decision.blockedBy === 'FREQUENCY_CAP' ? (
            <div className="flex items-center gap-2 rounded-xl border border-line bg-elevated p-2.5">
              <span className="min-w-0 flex-1 text-[10px] leading-snug text-muted">
                You declined an offer recently, so we are staying quiet for seven days.
              </span>
              <button
                type="button"
                onClick={clearHistory}
                className="shrink-0 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1 text-[10px] font-medium text-brand transition active:scale-95"
              >
                Reset
              </button>
            </div>
          ) : null}

          <div className="border-t border-line pt-4">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">
              Full decision trail
            </h3>
            <DecisionTrace decision={decision} />
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-xl border border-line bg-elevated px-3 py-2">
      <p className="text-[9px] uppercase tracking-wide text-faint">{label}</p>
      <p className="text-[16px] font-semibold text-body">
        {value}
        <span className="text-[10px] font-normal text-faint">/100</span>
      </p>
    </div>
  );
}

/** Compact "here is the one thing that fell short" block used on the checkout. */
export function Shortfall({ decision }: { decision: Decision }) {
  const weakest = weakestSignal(decision.eligibilityBreakdown);
  if (!weakest) return null;

  return (
    <div className="rounded-xl border border-line bg-ink/40 p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Pill tone="warn">weakest</Pill>
          <span className="text-[11px] font-medium text-body">{weakest.label}</span>
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted">
          {weakest.points}/{weakest.max}
        </span>
      </div>
      <Bar value={weakest.points} max={weakest.max} tone="warn" />
      <p className="mt-1.5 text-[10px] leading-snug text-faint">{weakest.detail}</p>
    </div>
  );
}
