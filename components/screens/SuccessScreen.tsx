'use client';

import { motion } from 'framer-motion';
import { useApp } from '@/lib/client/state';
import { formatINR, formatShortDate } from '@/lib/format';
import { buildSchedule } from './ApprovedScreen';

export function SuccessScreen() {
  const { payment, go, t } = useApp();
  if (!payment) return null;

  const paidOnCredit = payment.method === 'postpaid' || payment.method === 'card';

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-slim pt-safe flex-1 overflow-y-auto px-5 pb-4">
        <div className="flex flex-col items-center text-center">
          <AnimatedCheck />
          <motion.h2
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mt-4 text-[22px] font-semibold text-white"
          >
            {t('success.paid', formatINR(payment.amount))}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            className="mt-1 text-[13px] text-muted"
          >
            {t('success.to', payment.merchantName)}
            {paidOnCredit && payment.partner ? (
              <>
                {' '}
                <span className="font-medium text-brand">{t('success.via', payment.partner)}</span>
              </>
            ) : (
              ` ${t('success.via', payment.method === 'wallet' ? t('success.wallet') : t('success.upi'))}`
            )}
          </motion.p>
        </div>

        {paidOnCredit && payment.tenure ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
            className="mt-6"
          >
            <div className="rounded-2xl border border-brand/25 bg-brand/5 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
                {t('success.yourPlan')}
              </p>
              <p className="mt-1 text-[15px] font-semibold text-body">
                {t('success.instalments', payment.tenure.months, formatINR(payment.tenure.emi))}
                {payment.tenure.noCost ? ` · ${t('nudge.noCostSuffix')}` : ''}
              </p>
              <p className="mt-0.5 text-[11px] text-muted">
                {t('success.firstDue', formatShortDate(payment.tenure.firstDueDate))}
              </p>
            </div>

            <div className="mt-3 rounded-2xl border border-line bg-surface p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {t('success.schedule')}
              </p>
              <ul className="space-y-1.5">
                {buildSchedule(payment.tenure).map((row) => (
                  <li key={row.index} className="flex items-baseline justify-between text-[12px]">
                    <span className="text-muted">
                      {row.index}. {formatShortDate(row.date)}
                    </span>
                    <span className="font-medium tabular-nums text-body">
                      {formatINR(row.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-3 text-center text-[10px] leading-relaxed text-faint">
              {t('success.partnerNoteOne')}
              <br />
              {t('success.partnerNoteTwo')}
            </p>
          </motion.div>
        ) : (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55 }}
            className="mt-8 text-center text-[12px] leading-relaxed text-faint"
          >
            {t('success.paidInFull')}{' '}
            {payment.method === 'wallet' ? t('success.fromWallet') : t('success.fromBank')}.
            <br />
            {t('success.noOffer')}
          </motion.p>
        )}
      </div>

      <div className="shrink-0 px-5 pb-6">
        <button
          type="button"
          onClick={() => go('home')}
          className="w-full rounded-2xl border border-line bg-elevated py-3.5 text-[15px] font-semibold text-body transition active:scale-[0.98]"
        >
          {t('success.done')}
        </button>
      </div>
    </div>
  );
}

function AnimatedCheck() {
  return (
    <motion.svg
      width="88"
      height="88"
      viewBox="0 0 88 88"
      fill="none"
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 16 }}
      aria-label="Payment successful"
    >
      <motion.circle
        cx="44"
        cy="44"
        r="40"
        stroke="#00C853"
        strokeWidth="3"
        fill="rgba(0,200,83,0.08)"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />
      <motion.path
        d="M27 45.5L38.5 57L61 33"
        stroke="#00C853"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.25, duration: 0.35, ease: 'easeOut' }}
      />
    </motion.svg>
  );
}
