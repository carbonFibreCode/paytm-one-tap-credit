'use client';

/**
 * Launch screen — pick who is paying.
 *
 * Every persona is here to make the engine behave differently, so starting the
 * demo by choosing one puts that front and centre instead of hiding it in a
 * drawer. It also reads like a real profile switcher rather than a debug menu.
 */

import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { PEOPLE } from '@/lib/people';
import { useApp } from '@/lib/client/state';
import { formatINR } from '@/lib/format';

export function PersonaScreen() {
  const { setUser, userId } = useApp();

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-brand-deep via-ink to-ink">

      <div className="pt-safe px-6 pb-5">
        <PaytmWordmark />
        <h1 className="mt-6 text-[22px] font-semibold leading-tight text-white">
          Who&rsquo;s paying today?
        </h1>
        <p className="mt-1.5 text-[12px] leading-relaxed text-white/55">
          Each profile has a different transaction history, so the credit engine reaches a
          different decision. Pick one to begin.
        </p>
      </div>

      <div className="scroll-slim flex-1 space-y-2 overflow-y-auto px-5 pb-6">
        {PEOPLE.map((person, index) => (
          <motion.button
            key={person.userId}
            type="button"
            onClick={() => setUser(person.userId)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.045, duration: 0.28 }}
            className={`flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition active:scale-[0.99] ${
              person.userId === userId
                ? 'border-brand/50 bg-brand/10'
                : 'border-line bg-surface hover:border-brand/30 hover:bg-elevated'
            }`}
          >
            <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-deep text-[14px] font-semibold text-white">
              {person.initials}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-body">
                {person.displayName}
              </span>

              {/* Wraps rather than truncating — these sentences are the point. */}
              <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                {person.tagline}
              </span>

              <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-faint">
                <span>{formatINR(person.balance)} balance</span>
                <span aria-hidden="true">&middot;</span>
                <span>
                  {person.bankName} &bull;&bull;{person.bankLast4}
                </span>
              </span>
            </span>

            <ChevronRight size={16} className="mt-1 shrink-0 self-start text-faint" />
          </motion.button>
        ))}

        <p className="pt-3 text-center text-[10px] leading-relaxed text-faint">
          Prototype for the Paytm Build for India AI Hackathon.
          <br />
          Profiles, merchants and transaction history are synthetic.
        </p>
      </div>
    </div>
  );
}

/** Paytm's two-tone wordmark, drawn rather than imported as an asset. */
export function PaytmWordmark({ size = 26 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-baseline font-bold tracking-tight"
      style={{ fontSize: size }}
      aria-label="Paytm"
    >
      <span style={{ color: '#00BAF2' }}>pay</span>
      <span style={{ color: '#20336B' }} className="brightness-150">
        tm
      </span>
    </span>
  );
}
