import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink px-6">
      <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-6 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Not found</p>
        <p className="mt-2 text-[13px] leading-relaxed text-body">There is nothing at this address.</p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-xl bg-brand px-4 py-2.5 text-[12px] font-semibold text-[#03253a]"
        >
          Open the app
        </Link>
      </div>
    </main>
  );
}
