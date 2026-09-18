'use client';

/**
 * Payment history.
 *
 * Real records of what happened in this session, kept in localStorage per user —
 * not a static mock. Credit-funded payments carry their instalment plan, which
 * is what makes the difference between the two payment routes visible after
 * the fact.
 */

import { motion } from 'framer-motion';
import { ArrowDownLeft, Receipt } from 'lucide-react';
import { useApp } from '@/lib/client/state';
import { formatINR, formatShortDate } from '@/lib/format';
import { getMerchant } from '@/lib/merchants';
import { personOrDefault } from '@/lib/people';
import { AppBar, Monogram, Pill } from '../Chrome';
import { BottomNav } from '../BottomNav';

const METHOD_LABEL: Record<string, string> = {
  upi: 'UPI',
  wallet: 'Paytm Balance',
  postpaid: 'Paytm Postpaid',
  card: 'Credit Card',
};

export function HistoryScreen() {
  const { payments, userId, go } = useApp();
  const person = personOrDefault(userId);

  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const onCredit = payments.filter(
    (payment) => payment.method === 'postpaid' || payment.method === 'card',
  ).length;

  return (
    <div className="flex h-full flex-col">
      <AppBar title="History" subtitle={person.displayName} onBack={() => go('home')} />

      <div className="scroll-slim flex-1 overflow-y-auto px-4 pb-24">
        {payments.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 pt-24 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-elevated text-faint">
              <Receipt size={24} />
            </span>
            <p className="mt-4 text-[14px] font-medium text-body">No payments yet</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Pay a merchant from the home screen and it will show up here.
            </p>
            <button
              type="button"
              onClick={() => go('home')}
              className="mt-5 rounded-xl border border-line bg-elevated px-4 py-2 text-[12px] font-medium text-body transition active:scale-95"
            >
              Find a merchant
            </button>
          </div>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Stat label="Payments" value={String(payments.length)} />
              <Stat label="Total paid" value={formatINR(total)} />
              <Stat label="On credit" value={`${onCredit} of ${payments.length}`} />
            </div>

            <h2 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-faint">
              Recent
            </h2>

            <div className="space-y-2">
              {payments.map((payment, index) => {
                const merchant = payment.merchantId ? getMerchant(payment.merchantId) : undefined;
                const onCreditLine = payment.method === 'postpaid' || payment.method === 'card';

                return (
                  <motion.div
                    key={`${payment.at ?? index}-${index}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index, 8) * 0.03, duration: 0.22 }}
                    className="rounded-2xl border border-line bg-surface p-3"
                  >
                    <div className="flex items-center gap-3">
                      {merchant ? (
                        <Monogram text={merchant.monogram} tint={merchant.tint} size={38} />
                      ) : (
                        <span className="flex h-[38px] w-[38px] items-center justify-center rounded-xl bg-elevated text-faint">
                          <ArrowDownLeft size={16} />
                        </span>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-body">
                          {payment.merchantName}
                        </p>
                        <p className="truncate text-[10px] text-muted">
                          {METHOD_LABEL[payment.method] ?? payment.method}
                          {payment.at ? ` · ${formatShortDate(payment.at)}` : ''}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-[14px] font-semibold tabular-nums text-body">
                          −{formatINR(payment.amount)}
                        </p>
                        {onCreditLine ? <Pill tone="brand">credit</Pill> : null}
                      </div>
                    </div>

                    {payment.tenure ? (
                      <p className="mt-2 border-t border-line pt-2 text-[10px] text-muted">
                        {payment.tenure.months} instalments of {formatINR(payment.tenure.emi)}
                        {payment.tenure.noCost ? ' · no cost' : ''} · first due{' '}
                        {formatShortDate(payment.tenure.firstDueDate)}
                      </p>
                    ) : null}
                  </motion.div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <BottomNav active="history" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-2.5">
      <p className="text-[9px] uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-semibold text-body">{value}</p>
    </div>
  );
}
