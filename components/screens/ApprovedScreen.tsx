'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import type { EmiOption } from '@/lib/types';
import { useApp } from '@/lib/client/state';
import { formatApr, formatINR, formatShortDate } from '@/lib/format';
import { buildSchedule } from '@/lib/engine/emi';
import type { Translate } from '@/lib/i18n';
import { AppBar, Pill } from '../Chrome';

export function ApprovedScreen() {
  const { decision, amount, merchant, confirmCredit, go, t } = useApp();
  const offer = decision?.offer;

  const [selected, setSelected] = useState<number>(() => {
    const preferred = offer?.tenures.find((tenure) => tenure.noCost) ?? offer?.tenures[0];
    return preferred?.months ?? 3;
  });

  if (!offer || !decision) return null;

  const tenure = offer.tenures.find((option) => option.months === selected) ?? offer.tenures[0];

  return (
    <div className="flex h-full flex-col">
      <AppBar title={t('approved.title')} onBack={() => go('checkout')} />

      <div className="scroll-slim flex-1 overflow-y-auto px-5 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl border border-brand/25 bg-gradient-to-b from-[#0d2a4a] to-surface p-5 text-center"
        >
          <Pill tone="brand">{t('approved.preApproved')}</Pill>
          <h2 className="mt-3 text-[20px] font-semibold leading-tight text-white">
            {t('approved.approvedFor')}
            <br />
            {offer.partner}
          </h2>
          <p className="mt-2 text-[12px] text-muted">
            {t('approved.limitUpTo')}{' '}
            <span className="font-semibold text-body">{formatINR(offer.limit)}</span>
          </p>
        </motion.div>

        <h3 className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-wide text-muted">
          {t('approved.choosePlan')}
        </h3>

        <div className="space-y-2">
          {offer.tenures.map((option) => (
            <PlanRow
              key={option.months}
              option={option}
              amount={amount}
              selected={option.months === selected}
              onSelect={() => setSelected(option.months)}
              t={t}
            />
          ))}
        </div>

        <Schedule tenure={tenure} t={t} />

        <p className="mt-4 rounded-xl border border-line bg-surface/60 p-3 text-[10px] leading-relaxed text-faint">
          {t('approved.partnerNote')}
        </p>
      </div>

      <div className="shrink-0 space-y-2 border-t border-line px-5 py-4">
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="text-muted">{t('approved.youWillPay')}</span>
          <span className="font-semibold text-body">
            {t('approved.perMonth', formatINR(tenure.emi), tenure.months)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => confirmCredit(tenure)}
          className="w-full rounded-2xl bg-brand py-3.5 text-[15px] font-semibold text-[#03253a] transition active:scale-[0.98]"
        >
          {t('approved.confirm', formatINR(amount))}
        </button>
        <button
          type="button"
          onClick={() => go('checkout')}
          className="w-full rounded-2xl py-2 text-[12px] font-medium text-muted transition hover:text-body"
        >
          {t('approved.back', merchant?.name ?? t('approved.backFallback'))}
        </button>
      </div>
    </div>
  );
}

function PlanRow({
  option,
  amount,
  selected,
  onSelect,
  t,
}: {
  option: EmiOption;
  amount: number;
  selected: boolean;
  onSelect: () => void;
  t: Translate;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
        selected ? 'border-brand/60 bg-brand/10' : 'border-line bg-surface hover:bg-elevated'
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? 'border-brand' : 'border-line'
        }`}
      >
        {selected ? <span className="h-2 w-2 rounded-full bg-brand" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-body">
          {t('approved.planRow', option.months, formatINR(option.emi))}
        </span>
        <span className="block text-[11px] text-muted">
          {option.noCost
            ? t('approved.noCostPlan')
            : t(
                'approved.interestPlan',
                formatINR(option.total),
                formatINR(option.interest),
                formatApr(option.apr),
              )}
        </span>
      </span>
      {option.noCost ? <Pill tone="good">{t('approved.noCost')}</Pill> : null}
      {option.lastEmi !== option.emi ? (
        <span className="shrink-0 text-[10px] text-faint">
          {t('approved.lastEmi', formatINR(option.lastEmi))}
        </span>
      ) : null}
      <span className="sr-only">{formatINR(amount)} total</span>
    </button>
  );
}

/** Real dates, real rounding — the last instalment is the one that differs. */
export function Schedule({ tenure, t }: { tenure: EmiOption; t: Translate }) {
  const rows = buildSchedule(tenure);
  return (
    <div className="mt-4 rounded-2xl border border-line bg-surface p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {t('approved.schedule')}
      </p>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.index} className="flex items-baseline justify-between text-[12px]">
            <span className="text-muted">
              {row.index}. {formatShortDate(row.date)}
            </span>
            <span className="font-medium tabular-nums text-body">{formatINR(row.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2 text-[12px]">
        <span className="text-muted">{t('approved.total')}</span>
        <span className="font-semibold tabular-nums text-body">{formatINR(tenure.total)}</span>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-faint">{t('approved.fees')}</p>
    </div>
  );
}

// Shared with the success screen; the schedule itself lives with the EMI maths.
export { buildSchedule };
