'use client';

/**
 * Paytm's bottom bar, with the scanner raised in the middle.
 *
 * Only Home and Scan navigate; the rest are visual. Payment screens hide the
 * bar entirely, which is what the real app does once a transaction starts.
 */

import { History, House, Tag, UserRound } from 'lucide-react';
import { useApp } from '@/lib/client/state';
import type { Screen } from '@/lib/client/state';

export function BottomNav({ active }: { active: 'home' | 'scanner' }) {
  const { go } = useApp();

  const items: Array<{ icon: typeof House; label: string; screen?: Screen }> = [
    { icon: House, label: 'Home', screen: 'home' },
    { icon: History, label: 'History' },
    { icon: Tag, label: 'Offers' },
    { icon: UserRound, label: 'Profile', screen: 'persona' },
  ];

  return (
    <div className="relative shrink-0 border-t border-line bg-surface">
      <div className="grid grid-cols-5 items-end px-2 pb-2 pt-2">
        {items.slice(0, 2).map((item) => (
          <NavItem key={item.label} {...item} active={active} onGo={go} />
        ))}

        {/* Centre slot — the raised scan button sits above it. */}
        <div aria-hidden="true" />

        {items.slice(2).map((item) => (
          <NavItem key={item.label} {...item} active={active} onGo={go} />
        ))}
      </div>

      <button
        type="button"
        onClick={() => go('scanner')}
        aria-label="Scan any QR code"
        className={`absolute -top-6 left-1/2 flex h-14 w-14 -translate-x-1/2 flex-col items-center justify-center rounded-full border-4 border-ink bg-brand text-[#03253a] shadow-[0_8px_24px_-4px_rgba(0,186,242,0.6)] transition active:scale-95 ${
          active === 'scanner' ? 'ring-2 ring-brand/50' : ''
        }`}
      >
        <ScanGlyph />
      </button>
      <span className="pointer-events-none absolute -bottom-0 left-1/2 w-20 -translate-x-1/2 text-center text-[9px] font-medium text-brand">
        Scan
      </span>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  screen,
  active,
  onGo,
}: {
  icon: typeof House;
  label: string;
  screen?: Screen;
  active: string;
  onGo: (screen: Screen) => void;
}) {
  const isActive = screen === active;
  return (
    <button
      type="button"
      onClick={() => screen && onGo(screen)}
      className={`flex flex-col items-center gap-1 py-1 transition ${
        isActive ? 'text-brand' : 'text-faint hover:text-muted'
      }`}
    >
      <Icon size={18} />
      <span className="text-[9px] font-medium">{label}</span>
    </button>
  );
}

/** Paytm's scan mark: viewfinder corners around a QR block. */
function ScanGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" fill="currentColor" />
    </svg>
  );
}
