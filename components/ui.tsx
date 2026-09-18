'use client';

/**
 * Shared UI primitives.
 *
 * Only the pieces that were genuinely the same markup in several files. The
 * `Section` and `Stat` components that also appeared three times each are
 * *not* here: those were the same name wrapping three different designs — a
 * heading level and spacing that differ on purpose — and merging them would
 * have changed how the screens look. Same name, different component is a
 * naming problem, not duplication.
 */

import type { ReactNode } from 'react';

/**
 * A progress bar for "points out of max". Identical markup previously lived in
 * DecisionTrace, ProfileSheet and DecisionSheet; `tone` is the only thing that
 * ever varied.
 */
export function Bar({
  value,
  max,
  tone = 'brand',
}: {
  value: number;
  max: number;
  tone?: 'brand' | 'warn';
}) {
  const pct = max === 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${
          tone === 'warn' ? 'bg-warn' : 'bg-brand'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Shimmering placeholder rows, shown while a profile is in flight. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="shimmer h-3 rounded" style={{ width: `${90 - index * 12}%` }} />
      ))}
    </div>
  );
}

/**
 * The selectable pill used for personas, amounts, merchants, languages and the
 * orchestration toggle — seven copies of the same active/inactive ternary.
 */
export function Chip({
  active,
  onClick,
  disabled,
  children,
  className = '',
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-lg border px-2.5 py-1 text-[11px] transition disabled:opacity-40 ${
        active
          ? 'border-brand/50 bg-brand/10 text-brand'
          : 'border-line bg-elevated text-muted hover:text-body'
      } ${className}`}
    >
      {children}
    </button>
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
