'use client';

/**
 * The checkout screen — where the whole idea lives or dies.
 *
 * The keypad is functional rather than decorative: changing the amount re-runs
 * the engine live, so the nudge appearing and disappearing as you type is the
 * most convincing thing in the demo.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { BadgeCheck } from 'lucide-react';
import { useState } from 'react';
import type { Instrument } from '@/lib/types';
import { useApp } from '@/lib/client/state';
import { formatINR, humaniseGate } from '@/lib/format';
import { AppBar, Monogram, Pill, StatusBar } from '../Chrome';
import { NudgeCard } from '../NudgeCard';
import { DecisionTrace } from '../DecisionTrace';

const METHODS: Array<{ id: Instrument; label: string }> = [
  { id: 'upi', label: 'UPI' },
  { id: 'debit_card', label: 'Debit card' },
  { id: 'netbanking', label: 'Net banking' },
];

export function CheckoutScreen() {
  const {
    merchant,
    amount,
    setAmount,
    instrument,
    setInstrument,
    decision,
    decisionLoading,
    decisionError,
    nudgeCopy,
    nudgeCopyLoading,
    nudgeDismissed,
    acceptNudge,
    declineNudge,
    payNormally,
    go,
    toggleDrawer,
  } = useApp();

  if (!merchant) return null;

  const showNudge = Boolean(decision?.showNudge && decision.offer) && !nudgeDismissed;

  const press = (key: string) => {
    if (key === 'back') {
      setAmount(Math.floor(amount / 10));
      return;
    }
    const next = Number(`${amount}${key}`);
    // Keep the amount inside something a checkout could plausibly show.
    if (next <= 1_00_00_000) setAmount(next);
  };

  return (
    <div className="relative flex h-full flex-col">
      <StatusBar />
      <AppBar
        title="Payment"
        onBack={() => go('home')}
        right={
          <button
            type="button"
            onClick={() => toggleDrawer(true)}
            className="rounded-lg border border-line px-2 py-1 text-[10px] font-medium text-muted transition hover:text-body"
          >
            Demo
          </button>
        }
      />

      <div className="flex flex-col items-center px-5 pt-1">
        <Monogram text={merchant.monogram} tint={merchant.tint} size={48} />
        <p className="mt-2 flex items-center gap-1 text-[14px] font-semibold text-body">
          {merchant.name}
          {merchant.creditEnabled ? (
            <BadgeCheck size={15} className="text-brand" aria-label="Verified" />
          ) : null}
        </p>
        <p className="text-[10px] text-muted">Verified name · A/c linked on Paytm</p>

        <div className="mt-5 flex items-start gap-1">
          <span className="mt-2 text-[24px] font-light text-muted">₹</span>
          <span className="text-[44px] font-semibold leading-none tracking-tight text-white tabular-nums">
            {amount.toLocaleString('en-IN')}
          </span>
        </div>
        <p className="mt-1 h-4 text-[10px] text-faint">
          {decisionLoading ? 'Checking eligibility…' : decision ? `${decision.score}/100 relevance` : ''}
        </p>

        <div className="mt-4 flex gap-2">
          {METHODS.map((method) => (
            <button
              key={method.id}
              type="button"
              onClick={() => setInstrument(method.id)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
                instrument === method.id
                  ? 'border-brand/50 bg-brand/10 text-brand'
                  : 'border-line bg-elevated text-muted hover:text-body'
              }`}
            >
              {method.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1" />

      {decisionError ? (
        <p className="mx-5 mb-2 rounded-xl border border-bad/30 bg-bad/10 p-2 text-[11px] text-bad">
          Decision service unreachable — {decisionError}
        </p>
      ) : null}

      <Keypad onPress={press} />

      <div className="px-5 pb-5">
        <button
          type="button"
          onClick={payNormally}
          className="w-full rounded-2xl bg-brand-deep py-3.5 text-[15px] font-semibold text-white transition active:scale-[0.98]"
        >
          Proceed securely
        </button>
      </div>

      {/* The engine's decision when it chose not to interrupt. Marked as a
          developer overlay — a real checkout would show nothing at all. */}
      {decision && !decision.showNudge && !decisionLoading ? (
        <EngineStrip />
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0">
        <AnimatePresence>
          {showNudge && decision ? (
            <NudgeCard
              key="nudge"
              decision={decision}
              copy={nudgeCopy}
              copyLoading={nudgeCopyLoading}
              amount={amount}
              onAccept={acceptNudge}
              onDecline={declineNudge}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Visible proof that the engine ran and chose silence. */
function EngineStrip() {
  const { decision } = useApp();
  const [open, setOpen] = useState(false);
  if (!decision) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-5 mb-5 rounded-2xl border border-dashed border-line bg-surface/70"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 p-3 text-left"
        aria-expanded={open}
      >
        <Pill>engine</Pill>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
          No nudge · {decision.blockedBy ? humaniseGate(decision.blockedBy) : 'below threshold'}
        </span>
        <span className="shrink-0 text-[11px] text-faint">{open ? '▴' : '▾'}</span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 px-3 pb-3">
              <p className="text-[11px] leading-relaxed text-body">{decision.blockedReason}</p>
              <DecisionTrace decision={decision} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function Keypad({ onPress }: { onPress: (key: string) => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
  return (
    <div className="grid shrink-0 grid-cols-3 gap-px border-y border-line bg-line/40">
      {keys.map((key, index) =>
        key === '' ? (
          <div key={index} className="bg-ink py-3.5" />
        ) : (
          <button
            key={index}
            type="button"
            onClick={() => onPress(key)}
            aria-label={key === 'back' ? 'Delete last digit' : key}
            className="bg-ink py-3.5 text-[19px] font-medium text-body transition active:bg-elevated"
          >
            {key === 'back' ? '⌫' : key}
          </button>
        ),
      )}
    </div>
  );
}
