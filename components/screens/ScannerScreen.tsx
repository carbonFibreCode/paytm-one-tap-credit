'use client';

/**
 * Scan & Pay.
 *
 * There is no camera here — tapping a merchant below simulates a QR lock-on and
 * routes into the same checkout the merchant list uses. It exists because
 * scanning is how most Paytm payments actually start, and a credit nudge that
 * only appears from a list would feel like a prototype rather than the app.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Images, Zap } from 'lucide-react';
import { MERCHANTS } from '@/lib/merchants';
import { useApp } from '@/lib/client/state';
import { formatINR } from '@/lib/format';
import { Monogram, StatusBar } from '../Chrome';
import { BottomNav } from '../BottomNav';

/** How long the lock-on animation holds before the checkout opens. */
const LOCK_ON_MS = 700;

export function ScannerScreen() {
  const { selectMerchant, go } = useApp();
  const [locked, setLocked] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending lock-on must not fire after the screen is gone.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const scan = (merchantId: string) => {
    if (locked) return;
    setLocked(merchantId);
    timer.current = setTimeout(() => selectMerchant(merchantId), LOCK_ON_MS);
  };

  const lockedMerchant = MERCHANTS.find((merchant) => merchant.id === locked);

  return (
    <div className="flex h-full flex-col bg-black">
      <StatusBar />

      <div className="flex shrink-0 items-center gap-3 px-4 py-2">
        <button
          type="button"
          onClick={() => go('home')}
          aria-label="Go back"
          className="-ml-2 rounded-full p-2 text-white transition active:scale-95"
        >
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <h1 className="flex-1 text-[14px] font-semibold text-white">Scan any QR code</h1>
        <Zap size={16} className="text-white/70" aria-hidden="true" />
        <Images size={16} className="text-white/70" aria-hidden="true" />
      </div>

      {/* --- viewfinder --- */}
      <div className="relative mx-auto mt-2 aspect-square w-[74%] shrink-0">
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#12203a] via-[#0a1424] to-black" />

        {[
          'left-0 top-0 border-l-4 border-t-4 rounded-tl-3xl',
          'right-0 top-0 border-r-4 border-t-4 rounded-tr-3xl',
          'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-3xl',
          'right-0 bottom-0 border-r-4 border-b-4 rounded-br-3xl',
        ].map((corner) => (
          <span key={corner} className={`absolute h-10 w-10 border-brand ${corner}`} />
        ))}

        {/* sweeping scan line */}
        {!locked ? (
          <motion.div
            initial={{ top: '8%' }}
            animate={{ top: ['8%', '88%', '8%'] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-x-6 h-0.5 rounded-full bg-brand shadow-[0_0_18px_4px_rgba(0,186,242,0.55)]"
          />
        ) : null}

        <AnimatePresence>
          {lockedMerchant ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2"
            >
              <Monogram text={lockedMerchant.monogram} tint={lockedMerchant.tint} size={56} />
              <p className="text-[13px] font-semibold text-white">{lockedMerchant.name}</p>
              <p className="text-[10px] text-brand">QR detected</p>
            </motion.div>
          ) : (
            <motion.p
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 bottom-5 text-center text-[11px] text-white/50"
            >
              Align the QR code within the frame
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* --- simulated nearby QRs --- */}
      <div className="scroll-slim mt-4 flex-1 overflow-y-auto px-4 pb-24">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-white/40">
          Nearby merchant QRs &mdash; tap to scan
        </p>
        <div className="space-y-1.5">
          {MERCHANTS.map((merchant) => (
            <button
              key={merchant.id}
              type="button"
              onClick={() => scan(merchant.id)}
              disabled={Boolean(locked)}
              className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-2.5 text-left transition hover:bg-white/10 active:scale-[0.99] disabled:opacity-40"
            >
              <Monogram text={merchant.monogram} tint={merchant.tint} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-white">
                  {merchant.name}
                </span>
                <span className="block truncate text-[10px] text-white/45">{merchant.blurb}</span>
              </span>
              <span className="shrink-0 text-[10px] text-white/40">
                {formatINR(merchant.suggestedAmount)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <BottomNav active="scanner" />
    </div>
  );
}
