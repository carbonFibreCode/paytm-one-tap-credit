'use client';

/**
 * "Who am I paying as?" — the info sheet behind the header's info icon.
 *
 * Distinct from the demo drawer: that one changes things, this one only
 * explains. It answers the question a judge asks first — who is this user, what
 * is Paytm already approved them for, and where does that number come from.
 */

import { Landmark, Languages, Wallet, X } from 'lucide-react';
import { useApp } from '@/lib/client/state';
import { useProfile } from '@/lib/client/useProfile';
import { personOrDefault } from '@/lib/fixtures/people';
import { LANGUAGE_NAMES } from '@/lib/domain';
import { formatINR } from '@/lib/format';
import { Pill } from './Chrome';
import { Sheet } from './Sheet';
import { Bar, Skeleton } from './ui';

export function ProfileSheet() {
  const { infoOpen, toggleInfo, userId, go } = useApp();
  const person = personOrDefault(userId);
  const profile = useProfile(userId, infoOpen);

  return (
    <Sheet
      open={infoOpen}
      onClose={() => toggleInfo(false)}
      label="Profile details"
      header={
        <div className="flex items-start gap-3 px-5 pb-3 pt-1">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-deep text-[14px] font-semibold text-white">
            {person.initials}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-body">{person.displayName}</h2>
            <p className="truncate text-[11px] text-muted">{person.upiId}</p>
          </div>
          <button
            type="button"
            onClick={() => toggleInfo(false)}
            aria-label="Close"
            className="rounded-lg p-1 text-muted transition hover:text-body"
          >
            <X size={16} />
          </button>
        </div>
      }
    >
      <div className="scroll-slim flex-1 space-y-5 overflow-y-auto px-5 pb-6 pt-1">
        <div className="grid grid-cols-3 gap-2">
          <Fact icon={<Wallet size={14} />} label="Paytm Balance" value={formatINR(person.balance)} />
          <Fact
            icon={<Landmark size={14} />}
            label="Linked bank"
            value={`${person.bankName} \u2022\u2022${person.bankLast4}`}
          />
          <Fact
            icon={<Languages size={14} />}
            label="Nudge language"
            value={LANGUAGE_NAMES[person.preferredLanguage]}
          />
        </div>

        <Section title="About this profile">
          <p className="text-[11px] leading-relaxed text-body">{person.tagline}.</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            <span className="text-brand">Demonstrates:</span> {person.demonstrates}.
          </p>
        </Section>

        <Section title="Credit products">
          {profile ? (
            <div className="space-y-2">
              {profile.products.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center gap-2 rounded-xl border border-line bg-elevated p-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-body">
                      {product.partner}
                    </span>
                    <span className="block text-[10px] text-muted">
                      {product.eligible
                        ? `${formatINR(product.available)} available of ${formatINR(product.limit)}`
                        : 'Not pre-approved by the partner bank'}
                    </span>
                  </span>
                  {product.active ? (
                    <Pill tone="good">active</Pill>
                  ) : product.eligible ? (
                    <Pill tone="brand">approved</Pill>
                  ) : (
                    <Pill>unavailable</Pill>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Skeleton rows={2} />
          )}
        </Section>

        <Section
          title="Eligibility signal"
          hint="Derived from this user's own transaction history — not a hardcoded score. In production this is Paytm's underwriting."
        >
          {profile ? (
            <>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[11px] text-muted">
                  {profile.features.txnCount} transactions &middot; {profile.features.accountAgeDays} days
                </span>
                <span className="text-[18px] font-semibold text-body">
                  {profile.eligibilitySignal}
                  <span className="text-[11px] font-normal text-faint">/100</span>
                </span>
              </div>
              <div className="space-y-2">
                {profile.eligibilityBreakdown.map((part) => (
                  <div key={part.id}>
                    <div className="flex items-baseline justify-between gap-2 text-[10px]">
                      <span className="text-body">{part.label}</span>
                      <span className="shrink-0 font-mono text-muted">
                        {part.points}/{part.max}
                      </span>
                    </div>
                    <Bar value={part.points} max={part.max} />
                    <p className="mt-0.5 text-[10px] leading-snug text-faint">{part.detail}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Skeleton rows={4} />
          )}
        </Section>

        <button
          type="button"
          onClick={() => go('persona')}
          className="w-full rounded-2xl border border-line bg-elevated py-3 text-[13px] font-medium text-body transition active:scale-[0.98]"
        >
          Switch profile
        </button>
      </div>
    </Sheet>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <span className="rounded-xl border border-line bg-elevated p-2.5">
      <span className="flex items-center gap-1 text-faint">{icon}</span>
      <span className="mt-1 block text-[9px] uppercase tracking-wide text-faint">{label}</span>
      <span className="block text-[11px] font-medium leading-snug text-body">{value}</span>
    </span>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
        {title}
      </h3>
      {children}
      {hint ? <p className="mt-2 text-[10px] leading-relaxed text-faint">{hint}</p> : null}
    </section>
  );
}
