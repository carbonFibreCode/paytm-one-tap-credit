'use client';

/**
 * The audit trail.
 *
 * Slide 11 of the deck promises "a human-readable audit trail on every nudge
 * decision" — this is that, rendered. It shows the same structure whether the
 * engine offered credit or refused to, which is the point: a decision to stay
 * silent is as explainable as a decision to ask.
 */

import { useState } from 'react';
import type { Decision } from '@/lib/types';
import { humaniseGate } from '@/lib/format';
import { Pill } from './Chrome';
import { Bar } from './ui';

export function DecisionTrace({ decision }: { decision: Decision }) {
  const [tab, setTab] = useState<'checks' | 'score' | 'signal'>('checks');

  const failed = decision.trace.gates.find((gate) => !gate.passed);

  return (
    <div className="rounded-2xl border border-line bg-ink/40 text-[11px]">
      <div className="flex gap-1 border-b border-line p-1">
        {(
          [
            ['checks', `Checks (${decision.trace.gates.length})`],
            ['score', `Relevance ${decision.score}`],
            ['signal', `Signal ${decision.eligibilitySignal}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg px-2 py-1.5 font-medium transition ${
              tab === key ? 'bg-elevated text-body' : 'text-faint hover:text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-3">
        {tab === 'checks' ? (
          <ul className="space-y-2">
            {decision.trace.gates.map((gate) => (
              <li key={gate.id} className="flex gap-2">
                <span
                  className={`mt-px shrink-0 font-mono text-[11px] ${
                    gate.passed ? 'text-good' : 'text-bad'
                  }`}
                  aria-hidden="true"
                >
                  {gate.passed ? '✓' : '✕'}
                </span>
                <span className="min-w-0">
                  <span className={gate.passed ? 'text-muted' : 'font-medium text-body'}>
                    {humaniseGate(gate.id)}
                  </span>
                  <span className="block text-faint">{gate.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {tab === 'score' ? (
          <div className="space-y-3">
            {decision.trace.factors.map((factor) => (
              <div key={factor.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-body">{factor.label}</span>
                  <span className="shrink-0 font-mono text-muted">
                    {factor.points}/{factor.weight}
                  </span>
                </div>
                <Bar value={factor.points} max={factor.weight} />
                <p className="mt-1 text-faint">{factor.detail}</p>
              </div>
            ))}
            <p className="border-t border-line pt-2 text-faint">
              Relevance asks whether this is a good moment to interrupt — not whether the user
              qualifies. That is the signal tab.
            </p>
          </div>
        ) : null}

        {tab === 'signal' ? (
          <div className="space-y-3">
            {decision.eligibilityBreakdown.map((component) => (
              <div key={component.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-body">{component.label}</span>
                  <span className="shrink-0 font-mono text-muted">
                    {component.points}/{component.max}
                  </span>
                </div>
                <Bar value={component.points} max={component.max} />
                <p className="mt-1 text-faint">{component.detail}</p>
              </div>
            ))}
            <p className="border-t border-line pt-2 text-faint">
              Every line above is derived from the user&rsquo;s own transaction history. In
              production this is Paytm&rsquo;s underwriting; here it is synthetic, and shown so the
              number has a visible origin.
            </p>
          </div>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-line p-3">
        {failed ? (
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="bad">Blocked by {humaniseGate(failed.id)}</Pill>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="good">All {decision.trace.gates.length} checks passed</Pill>
            <Pill tone="brand">{decision.product === 'card' ? 'Credit card' : 'Postpaid'}</Pill>
          </div>
        )}
        <p className="text-faint">
          <span className="text-muted">Why this product: </span>
          {decision.trace.productRationale}
        </p>
        <p className="text-faint">
          <span className="text-muted">What would change it: </span>
          {decision.trace.counterfactual}
        </p>
      </div>
    </div>
  );
}
