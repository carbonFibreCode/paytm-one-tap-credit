'use client';

/**
 * Last-resort boundary — catches errors in the root layout itself, where
 * `error.tsx` cannot run. Must render its own <html> and <body>.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#05070f',
          color: '#e6e9f2',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center', padding: 24 }}>
          <p style={{ fontSize: 13, opacity: 0.7 }}>The app could not start.</p>
          {error.digest ? (
            <p style={{ fontSize: 10, opacity: 0.5, fontFamily: 'monospace' }}>ref {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              padding: '10px 16px',
              borderRadius: 12,
              border: 0,
              background: '#00BAF2',
              color: '#03253a',
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
