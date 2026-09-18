'use client';

/**
 * Route error boundary.
 *
 * An uncaught render error would otherwise blank the phone mid-demo. This
 * keeps the frame, says what happened in one line, and offers a retry that
 * re-renders the segment without a full reload — local state survives.
 */

import { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the browser console and, on Vercel, in the function logs.
    console.error('[render]', error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink px-6">
      <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-6 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">
          Something went wrong
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-body">
          The screen could not be drawn. Your session is intact — try again.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-[10px] text-faint">ref {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[12px] font-semibold text-[#03253a] transition active:scale-95"
        >
          <RotateCcw size={14} />
          Try again
        </button>
      </div>
    </main>
  );
}
