'use client';

import { motion } from 'framer-motion';
import { useApp } from '@/lib/client/state';
import { formatINR, formatShortDate } from '@/lib/format';
import { buildSchedule } from './ApprovedScreen';

export function SuccessScreen() {
  const { payment, go } = useApp();
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
            {formatINR(payment.amount)} paid
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            className="mt-1 text-[13px] text-muted"
          >
            to {payment.merchantName}
            {paidOnCredit && payment.partner ? (
              <>
                {' '}
                via <span className="font-medium text-brand">{payment.partner}</span>
              </>
            ) : (
              ` via ${payment.method === 'wallet' ? 'Paytm Wallet' : 'UPI'}`
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
                Your plan
              </p>
              <p className="mt-1 text-[15px] font-semibold text-body">
                {payment.tenure.months} instalments of {formatINR(payment.tenure.emi)}
                {payment.tenure.noCost ? ' · no cost' : ''}
              </p>
              <p className="mt-0.5 text-[11px] text-muted">
                First instalment on {formatShortDate(payment.tenure.firstDueDate)}
              </p>
            </div>

            <div className="mt-3 rounded-2xl border border-line bg-surface p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Schedule
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
              The credit line, KYC and repayment are handled by the partner bank.
              <br />
              Mocked here — this prototype is the decision layer.
            </p>
          </motion.div>
        ) : (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55 }}
            className="mt-8 text-center text-[12px] leading-relaxed text-faint"
          >
            Paid in full{payment.method === 'wallet' ? ' from your Paytm Balance' : ' from your linked bank account'}.
            <br />
            No credit offer was taken.
          </motion.p>
        )}
      </div>

      <div className="shrink-0 px-5 pb-6">
        <button
          type="button"
          onClick={() => go('home')}
          className="w-full rounded-2xl border border-line bg-elevated py-3.5 text-[15px] font-semibold text-body transition active:scale-[0.98]"
        >
          Done
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
