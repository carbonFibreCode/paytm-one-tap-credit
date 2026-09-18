'use client';

/**
 * The shell that makes the demo read as a phone: bezel, status bar, app bar.
 *
 * On a laptop this renders inside a device frame so it projects cleanly onto a
 * screen. On an actual phone the frame drops away and the app fills the
 * viewport, so the same deployed URL works for "here, try it yourself".
 */

import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink sm:bg-[#080b14] sm:p-6">
      <div
        className="
          relative flex h-dvh w-full flex-col overflow-hidden bg-ink
          sm:h-[860px] sm:w-[400px] sm:rounded-[2.75rem] sm:border-[10px] sm:border-[#1a2132]
          sm:shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]
        "
      >
        {/* Notch — frame only, hidden when the app is genuinely full-screen. */}
        <div className="pointer-events-none absolute left-1/2 top-0 z-50 hidden h-6 w-32 -translate-x-1/2 rounded-b-2xl bg-[#1a2132] sm:block" />
        {children}
      </div>
    </div>
  );
}

export function AppBar({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <div className="pt-safe flex shrink-0 items-center gap-3 px-5 pb-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className="-ml-2 rounded-full p-2 text-body transition hover:bg-elevated active:scale-95"
        >
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-semibold leading-tight">{title}</h1>
        {subtitle ? <p className="truncate text-[11px] text-muted">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

/** Merchant monogram tile, standing in for a logo. */
export function Monogram({
  text,
  tint,
  size = 40,
}: {
  text: string;
  tint: string;
  size?: number;
}) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl font-semibold"
      style={{
        width: size,
        height: size,
        background: `${tint}1f`,
        color: tint,
        fontSize: size * 0.34,
        border: `1px solid ${tint}33`,
      }}
    >
      {text}
    </span>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-elevated text-muted border-line',
    good: 'bg-good/10 text-good border-good/25',
    warn: 'bg-warn/10 text-warn border-warn/25',
    bad: 'bg-bad/10 text-bad border-bad/25',
    brand: 'bg-brand/10 text-brand border-brand/25',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
