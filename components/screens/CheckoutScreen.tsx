'use client';

/**
 * The checkout screen — where the whole idea lives or dies.
 *
 * The layout is built so the keypad can never move. Everything that changes —
 * the amount, the nudge, the engine strip — lives in a flexible middle region,
 * while the pay button and keypad are pinned below it. Before this, a nudge
 * appearing would push the keys down mid-tap and the wrong digit got pressed.
 *
 * Amount changes are debounced before they reach the engine, so holding down a
 * key fires one decision rather than six.
 */

import { AnimatePresence } from 'framer-motion';
import { BadgeCheck, ChevronRight } from 'lucide-react';
import type { Instrument } from '@/lib/types';
import { useApp } from '@/lib/client/state';
import { amountInWords, formatINR, humaniseGate } from '@/lib/format';
import { personOrDefault } from '@/lib/fixtures/people';
import { AppBar, Monogram, Pill } from '../Chrome';
import { NudgeCard } from '../NudgeCard';

const METHODS: Array<{ id: Instrument; label: string }> = [
  { id: 'upi', label: 'UPI' },
  { id: 'wallet', label: 'Paytm Balance' },
  { id: 'debit_card', label: 'Debit card' },
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
    userId,
  } = useApp();

  const person = personOrDefault(userId);
  if (!merchant) return null;

  const showNudge = Boolean(decision?.showNudge && decision.offer) && !nudgeDismissed;

  // The wallet holds a finite balance; UPI draws on the linked bank, so only the
  // wallet can actually run short — and that shortfall is exactly the moment a
  // credit offer is worth something.
  const shortOnWallet = instrument === 'wallet' && amount > person.balance;

  const fundingSource =
    instrument === 'wallet'
      ? `Paytm Balance · ${formatINR(person.balance)}`
      : instrument === 'upi'
        ? `${person.bankName} ••${person.bankLast4} · ${person.upiId}`
        : `${person.bankName} Debit ••${person.bankLast4}`;

  const press = (key: string) => {
    if (key === 'back') return setAmount(Math.floor(amount / 10));
    const next = Number(`${amount}${key}`);
    if (next <= 1_00_00_000) setAmount(next);
  };

  return (
    <div className="flex h-full flex-col">
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

      {/* Flexible middle. Everything that can change size lives here, so the
          keypad below it never shifts under the user's thumb. */}
      <div className="scroll-none flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pb-2">
        <Monogram text={merchant.monogram} tint={merchant.tint} size={44} />
        <p className="mt-2 flex items-center gap-1 text-[14px] font-semibold text-body">
          {merchant.name}
          {merchant.creditEnabled ? (
            <BadgeCheck size={15} className="text-brand" aria-label="Verified" />
          ) : null}
        </p>
        <p className="text-[10px] text-muted">Verified name · A/c linked on Paytm</p>

        <div className="mt-4 flex items-start gap-1">
          <span className="mt-2 text-[22px] font-light text-muted">₹</span>
          <span className="text-[40px] font-semibold leading-none tracking-tight text-white tabular-nums">
            {amount.toLocaleString('en-IN')}
          </span>
        </div>
        <p className="mt-1.5 h-4 text-center text-[10px] text-faint">{amountInWords(amount)}</p>

        <div className="mt-4 w-full">
          <AnimatePresence mode="wait">
            {showNudge && decision ? (
              <NudgeCard
                key="nudge"
                decision={decision}
                copy={nudgeCopy}
                copyLoading={nudgeCopyLoading}
                onAccept={acceptNudge}
                onDecline={declineNudge}
              />
            ) : decision && !decision.showNudge && !decisionLoading ? (
              <EngineStrip key="engine" />
            ) : null}
          </AnimatePresence>
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
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
        <p className="mt-2 text-center text-[10px] text-faint">{fundingSource}</p>

        {decisionError ? (
          <p className="mt-2 w-full rounded-xl border border-bad/30 bg-bad/10 p-2 text-[11px] text-bad">
            Could not score this transaction — {decisionError}
          </p>
        ) : null}
      </div>

      {/* Pinned. Never moves. */}
      <div className="shrink-0">
        <div className="px-5 pb-3">
          <button
            type="button"
            onClick={payNormally}
            disabled={shortOnWallet || amount <= 0}
            className="w-full rounded-2xl bg-brand-deep py-3.5 text-[15px] font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
          >
            {shortOnWallet ? 'Insufficient Paytm Balance' : 'Proceed securely'}
          </button>
          {shortOnWallet ? (
            <p className="mt-1.5 text-center text-[10px] text-warn">
              Short by {formatINR(amount - person.balance)}. Switch to UPI, or use the offer above.
            </p>
          ) : null}
        </div>

        <Keypad onPress={press} />
      </div>
    </div>
  );
}

/** Visible proof that the engine ran and chose silence. */
function EngineStrip() {
  const { decision, clearHistory, toggleTrace } = useApp();
  if (!decision) return null;

  const capped = decision.blockedBy === 'FREQUENCY_CAP';

  return (
    <div className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-line bg-surface/70 p-2.5">
      <Pill>engine</Pill>
      <button
        type="button"
        onClick={() => toggleTrace(true)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
          No nudge · {decision.blockedBy ? humaniseGate(decision.blockedBy) : 'below threshold'}
        </span>
        <ChevronRight size={14} className="shrink-0 text-faint" />
      </button>
      {capped ? (
        <button
          type="button"
          onClick={clearHistory}
          className="shrink-0 rounded-lg border border-brand/40 bg-brand/10 px-2 py-1 text-[10px] font-medium text-brand transition active:scale-95"
        >
          Reset
        </button>
      ) : null}
    </div>
  );
}

function Keypad({ onPress }: { onPress: (key: string) => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
  return (
    <div className="grid shrink-0 grid-cols-3 gap-px border-t border-line bg-line/40">
      {keys.map((key, index) =>
        key === '' ? (
          <div key={index} className="bg-ink py-3" />
        ) : (
          <button
            key={index}
            type="button"
            onClick={() => onPress(key)}
            aria-label={key === 'back' ? 'Delete last digit' : key}
            className="bg-ink py-3 text-[19px] font-medium text-body transition active:bg-elevated"
          >
            {key === 'back' ? '⌫' : key}
          </button>
        ),
      )}
    </div>
  );
}
