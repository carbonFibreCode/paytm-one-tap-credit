'use client';

/**
 * Demo controls.
 *
 * Deliberately hidden behind the avatar rather than sitting in the consumer UI:
 * the checkout should look like a real payment screen. But the moment a judge
 * wants to poke at the engine, everything is reachable — switch the persona,
 * change the amount, flip the language, force the frequency cap, and watch the
 * decision change live.
 *
 * The memory panel is the point of the whole thing: raw ledger rows on the left
 * of the chain, a derived eligibility signal on the right.
 */

import type { Language } from '@/lib/types';
import { useApp } from '@/lib/client/state';
import { useProfile, type ProfilePayload } from '@/lib/client/useProfile';
import { MERCHANTS } from '@/lib/merchants';
import { PEOPLE } from '@/lib/people';
import { LANGUAGE_NAMES } from '@/lib/domain';
import { formatINR, formatShortDate } from '@/lib/format';
import { Pill } from './Chrome';
import { Sheet } from './Sheet';

const QUICK_AMOUNTS = [450, 12_000, 50_000, 80_000, 1_20_000, 2_50_000];

export function DemoDrawer() {
  const {
    drawerOpen,
    toggleDrawer,
    userId,
    setUser,
    amount,
    setAmount,
    merchantId,
    selectMerchant,
    languageOverride,
    setLanguage,
    mode,
    setMode,
    n8nAvailable,
    decisionMeta,
    history,
    simulateHistory,
    clearHistory,
    decision,
  } = useApp();

  const profile = useProfile(userId, drawerOpen);

  return (
    <Sheet
      open={drawerOpen}
      onClose={() => toggleDrawer(false)}
      label="Demo controls"
      header={
        <div className="flex items-center gap-2 px-5 pb-2 pt-1">
          <h2 className="flex-1 text-[14px] font-semibold text-body">Demo controls</h2>
          <button
            type="button"
            onClick={() => toggleDrawer(false)}
            className="rounded-lg px-2 py-1 text-[11px] text-muted hover:text-body"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="scroll-slim flex-1 space-y-5 overflow-y-auto px-5 pb-6">
              <Section title="Who is paying">
                <div className="grid grid-cols-2 gap-2">
                  {PEOPLE.map((person) => (
                    <button
                      key={person.userId}
                      type="button"
                      onClick={() => setUser(person.userId)}
                      className={`rounded-xl border p-2 text-left text-[11px] transition ${
                        userId === person.userId
                          ? 'border-brand/50 bg-brand/10 text-body'
                          : 'border-line bg-elevated text-muted hover:text-body'
                      }`}
                    >
                      {person.displayName}
                    </button>
                  ))}
                </div>
                {profile ? (
                  <p className="mt-2 text-[10px] leading-relaxed text-faint">
                    <span className="text-muted">{profile.tagline}.</span> {profile.demonstrates}.
                  </p>
                ) : null}
              </Section>

              <Section title="Transaction">
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_AMOUNTS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setAmount(value)}
                      className={`rounded-lg border px-2 py-1 text-[11px] transition ${
                        amount === value
                          ? 'border-brand/50 bg-brand/10 text-brand'
                          : 'border-line bg-elevated text-muted hover:text-body'
                      }`}
                    >
                      {formatINR(value)}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {MERCHANTS.map((merchant) => (
                    <button
                      key={merchant.id}
                      type="button"
                      onClick={() => selectMerchant(merchant.id)}
                      className={`rounded-lg border px-2 py-1 text-[11px] transition ${
                        merchantId === merchant.id
                          ? 'border-brand/50 bg-brand/10 text-brand'
                          : 'border-line bg-elevated text-muted hover:text-body'
                      }`}
                    >
                      {merchant.name}
                    </button>
                  ))}
                </div>
              </Section>

              <Section title="Nudge language">
                <div className="flex flex-wrap gap-1.5">
                  <LanguageChip
                    active={languageOverride === null}
                    onClick={() => setLanguage(null)}
                    label="Auto"
                  />
                  {(Object.keys(LANGUAGE_NAMES) as Language[]).map((code) => (
                    <LanguageChip
                      key={code}
                      active={languageOverride === code}
                      onClick={() => setLanguage(code)}
                      label={LANGUAGE_NAMES[code]}
                    />
                  ))}
                </div>
              </Section>

              <Section title="Orchestration">
                <div className="flex gap-1.5">
                  {(['orchestrated', 'direct'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setMode(option)}
                      disabled={option === 'orchestrated' && !n8nAvailable}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] transition disabled:opacity-40 ${
                        mode === option
                          ? 'border-brand/50 bg-brand/10 text-brand'
                          : 'border-line bg-elevated text-muted hover:text-body'
                      }`}
                    >
                      {option === 'orchestrated' ? 'via n8n' : 'direct API'}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-faint">
                  {decisionMeta ? (
                    <>
                      <Pill tone={decisionMeta.servedBy === 'n8n' ? 'good' : 'neutral'}>
                        served by {decisionMeta.servedBy}
                      </Pill>
                      <span>{decisionMeta.latencyMs}ms</span>
                    </>
                  ) : null}
                  {!n8nAvailable ? <span>NEXT_PUBLIC_N8N_WEBHOOK_URL not set</span> : null}
                </div>
                {decisionMeta?.fallbackReason ? (
                  <p className="mt-1 text-[10px] text-warn">{decisionMeta.fallbackReason}</p>
                ) : null}
              </Section>

              <Section title="Nudge history">
                <p className="mb-2 text-[10px] text-faint">
                  Held in this browser and sent with every request — which is what keeps the engine
                  stateless and its decisions reproducible.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      simulateHistory({
                        product: decision?.product ?? 'postpaid',
                        decidedAt: daysAgo(2),
                        outcome: 'declined',
                      })
                    }
                    className="rounded-lg border border-line bg-elevated px-2 py-1 text-[11px] text-muted transition hover:text-body"
                  >
                    Simulate: declined 2 days ago
                  </button>
                  <button
                    type="button"
                    onClick={clearHistory}
                    className="rounded-lg border border-line bg-elevated px-2 py-1 text-[11px] text-muted transition hover:text-body"
                  >
                    Reset user ({history.length})
                  </button>
                </div>
              </Section>

              <Section title="What the system already knows">
                {profile ? (
                  <MemoryPanel profile={profile} />
                ) : (
                  <div className="space-y-2">
                    <div className="shimmer h-3 w-2/3 rounded" />
                    <div className="shimmer h-3 w-1/2 rounded" />
                  </div>
                )}
              </Section>
      </div>
    </Sheet>
  );
}

function MemoryPanel({ profile }: { profile: ProfilePayload }) {
  const { features } = profile;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-muted">Eligibility signal</span>
        <span className="text-[15px] font-semibold text-body">{profile.eligibilitySignal}/100</span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
        <Stat label="History" value={`${features.accountAgeDays}d · ${features.txnCount} txns`} />
        <Stat label="Ledger rows" value={String(profile.ledger.total)} />
        <Stat label="Detected income" value={`${formatINR(features.avgMonthlyInflow)}/mo`} />
        <Stat label="Committed" value={`${formatINR(features.fixedMonthlyOutflow)}/mo`} />
        <Stat label="EMI capacity" value={`${formatINR(features.affordabilityCapacity)}/mo`} />
        <Stat label="Obligations" value={String(features.detectedObligations.length)} />
      </dl>

      {features.detectedObligations.length > 0 ? (
        <div>
          <p className="mb-1 text-[10px] font-medium text-muted">
            Recurring charges — detected from the ledger, or opened here
          </p>
          <ul className="space-y-0.5 text-[10px] text-faint">
            {features.detectedObligations.map((obligation) => (
              <li key={obligation.merchant} className="flex justify-between gap-2">
                <span className="truncate">{obligation.merchant}</span>
                <span className="shrink-0 tabular-nums">
                  {formatINR(obligation.amount)}
                  {obligation.source === 'account'
                    ? ' · live account'
                    : ` × ${obligation.occurrences} months`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="mb-1 text-[10px] font-medium text-muted">Recent transactions</p>
        <ul className="scroll-slim max-h-32 space-y-0.5 overflow-y-auto text-[10px] text-faint">
          {profile.ledger.recent.slice(0, 14).map((entry) => (
            <li key={entry.id} className="flex justify-between gap-2">
              <span className="truncate">
                {formatShortDate(entry.date)} · {entry.merchant}
              </span>
              <span
                className={`shrink-0 tabular-nums ${
                  entry.direction === 'credit' ? 'text-good' : ''
                }`}
              >
                {entry.direction === 'credit' ? '+' : '−'}
                {formatINR(entry.amount)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-faint">{label}</dt>
      <dd className="truncate text-right text-muted">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
      {children}
    </section>
  );
}

function LanguageChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
        active
          ? 'border-brand/50 bg-brand/10 text-brand'
          : 'border-line bg-elevated text-muted hover:text-body'
      }`}
    >
      {label}
    </button>
  );
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

