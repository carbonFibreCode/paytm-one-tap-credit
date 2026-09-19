'use client';

/**
 * Paytm home.
 *
 * Modelled closely on the real app: navy header with search, the money-transfer
 * row, a scan CTA, the recharge-and-bills grid, an offer strip and a bottom bar
 * with the scanner raised in the middle.
 *
 * Only the merchant list is wired — everything else is chrome, and deliberately
 * so. The point is that the credit nudge appears inside something that already
 * looks and behaves like Paytm, rather than inside a prototype.
 */

import { motion } from 'framer-motion';
import { useState } from 'react';
import {
  Bell,
  Car,
  ChevronRight,
  CreditCard,
  Droplets,
  Flame,
  Info,
  Wallet,
  Landmark,
  Lightbulb,
  QrCode,
  Search,
  ShieldCheck,
  Smartphone,
  Tv,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { MERCHANTS } from '@/lib/fixtures/merchants';
import { personOrDefault } from '@/lib/fixtures/people';
import { useApp } from '@/lib/client/state';
import { formatINR } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { Monogram } from '../Chrome';
import { BottomNav } from '../BottomNav';
import { Sheet } from '../Sheet';
import { PaytmWordmark } from '../ui';

const MONEY_TRANSFER: Array<{
  icon: LucideIcon;
  label: MessageKey;
  action?: 'balance';
}> = [
  { icon: Smartphone, label: 'home.toMobile' },
  { icon: Landmark, label: 'home.toBank' },
  { icon: UserRound, label: 'home.toSelf' },
  { icon: Wallet, label: 'home.balance', action: 'balance' },
];

const BILLS: Array<{ icon: LucideIcon; label: MessageKey; tint: string }> = [
  { icon: Smartphone, label: 'home.billMobile', tint: '#00BAF2' },
  { icon: Tv, label: 'home.billDth', tint: '#7C5CFF' },
  { icon: Lightbulb, label: 'home.billElectricity', tint: '#FFB020' },
  { icon: CreditCard, label: 'home.billCard', tint: '#00C853' },
  { icon: Droplets, label: 'home.billWater', tint: '#38BDF8' },
  { icon: Flame, label: 'home.billGas', tint: '#FF7043' },
  { icon: Car, label: 'home.billFastag', tint: '#A3E635' },
  { icon: ShieldCheck, label: 'home.billInsurance', tint: '#F472B6' },
];

export function HomeScreen() {
  const { selectMerchant, userId, go, toggleDrawer, toggleInfo, t } = useApp();
  const person = personOrDefault(userId);
  const [balanceOpen, setBalanceOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      {/* --- header --- */}
      <div className="shrink-0 bg-gradient-to-b from-brand-deep to-[#071736]">
        <div className="pt-safe flex items-center gap-3 px-4 pb-3">
          <button
            type="button"
            onClick={() => go('persona')}
            aria-label={t('home.switchProfile')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-[13px] font-semibold text-white transition active:scale-95"
          >
            {person.initials}
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white">
              {t('home.greeting', person.displayName.split(' ')[0])}
            </p>
            <p className="truncate text-[10px] text-white/55">{person.upiId}</p>
          </div>
          <PaytmWordmark size={17} />
          <button
            type="button"
            onClick={() => toggleDrawer(true)}
            aria-label={t('home.demoControls')}
            className="rounded-full p-1.5 text-white/80 transition hover:text-white active:scale-95"
          >
            <Bell size={17} />
          </button>

          <button
            type="button"
            onClick={() => toggleInfo(true)}
            aria-label={t('home.profileDetails')}
            className="rounded-full p-1.5 text-white/80 transition hover:text-brand active:scale-95"
          >
            <Info size={17} />
          </button>
        </div>

        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 rounded-xl bg-white/12 px-3 py-2.5">
            <Search size={15} className="shrink-0 text-white/60" aria-hidden="true" />
            <span className="truncate text-[12px] text-white/60">{t('home.search')}</span>
          </div>
        </div>
      </div>

      {/* --- scrolling body --- */}
      <div className="scroll-slim flex-1 overflow-y-auto pb-24">
        {/* money transfer */}
        <Section title={t('home.moneyTransfer')}>
          <div className="grid grid-cols-4 gap-2">
            {MONEY_TRANSFER.map(({ icon: Icon, label, action }) => (
              <button
                key={label}
                type="button"
                onClick={action === 'balance' ? () => setBalanceOpen(true) : undefined}
                className="flex flex-col items-center gap-1.5 transition active:scale-95"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-brand">
                  <Icon size={19} />
                </span>
                <span className="text-center text-[10px] leading-tight text-muted">{t(label)}</span>
              </button>
            ))}
          </div>
        </Section>

        {/* scan CTA */}
        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={() => go('scanner')}
            className="flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-brand-deep to-[#0d3a7a] p-3.5 text-left transition active:scale-[0.99]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-[#03253a]">
              <QrCode size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-white">
                {t('home.scanAndPay')}
              </span>
              <span className="block text-[10px] text-white/60">{t('home.scanBlurb')}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-white/60" />
          </button>
        </div>

        {/* the wired path */}
        <Section title={t('home.merchants')} caption={t('home.merchantsCaption')}>
          <div className="space-y-2">
            {MERCHANTS.map((merchant, index) => (
              <motion.button
                key={merchant.id}
                type="button"
                onClick={() => selectMerchant(merchant.id)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03, duration: 0.22 }}
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition hover:border-brand/40 hover:bg-elevated active:scale-[0.99]"
              >
                <Monogram text={merchant.monogram} tint={merchant.tint} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-body">
                    {merchant.name}
                  </span>
                  <span className="block truncate text-[10px] text-muted">{merchant.blurb}</span>
                </span>
                <span className="shrink-0 text-[11px] text-faint">
                  {formatINR(merchant.suggestedAmount)}
                </span>
              </motion.button>
            ))}
          </div>
        </Section>

        {/* bills grid */}
        <Section title={t('home.bills')}>
          <div className="grid grid-cols-4 gap-y-4">
            {BILLS.map(({ icon: Icon, label, tint }) => (
              <div key={label} className="flex flex-col items-center gap-1.5">
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-2xl"
                  style={{ background: `${tint}1a`, color: tint }}
                >
                  <Icon size={18} />
                </span>
                <span className="text-center text-[10px] leading-tight text-muted">{t(label)}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* offer strip */}
        <div className="px-4 pt-5">
          <div className="rounded-2xl border border-gold/20 bg-gradient-to-r from-gold/10 to-transparent p-3.5">
            <p className="text-[11px] font-semibold text-gold">{t('home.postpaid')}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted">{t('home.postpaidBlurb')}</p>
          </div>
        </div>

        <p className="px-6 pt-5 text-center text-[10px] leading-relaxed text-faint">
          {t('home.footerOne')}
          <br />
          {t('home.footerTwo')}
        </p>
      </div>

      <Sheet
        open={balanceOpen}
        onClose={() => setBalanceOpen(false)}
        label={t('balance.paytmBalance')}
        maxHeightClass="max-h-[60%]"
        header={
          <div className="flex items-center gap-2 px-5 pb-2 pt-1">
            <h2 className="flex-1 text-[14px] font-semibold text-body">{t('balance.title')}</h2>
            <button
              type="button"
              onClick={() => setBalanceOpen(false)}
              className="rounded-lg px-2 py-1 text-[11px] text-muted hover:text-body"
            >
              {t('balance.close')}
            </button>
          </div>
        }
      >
        <div className="space-y-3 px-5 pb-6 pt-2">
          <div className="rounded-2xl border border-brand/25 bg-gradient-to-br from-[#0d2a4a] to-surface p-4">
            <p className="text-[10px] uppercase tracking-wide text-white/50">
              {t('balance.paytmBalance')}
            </p>
            <p className="mt-1 text-[28px] font-semibold leading-none text-white">
              {formatINR(person.balance)}
            </p>
            <p className="mt-2 text-[10px] text-white/50">{person.upiId}</p>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-3.5">
            <p className="text-[10px] uppercase tracking-wide text-faint">
              {t('balance.linkedBank')}
            </p>
            <p className="mt-1 text-[13px] font-medium text-body">
              {person.bankName} &bull;&bull;{person.bankLast4}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted">{t('balance.bankNote')}</p>
          </div>

          <button
            type="button"
            onClick={() => {
              setBalanceOpen(false);
              go('history');
            }}
            className="w-full rounded-2xl border border-line bg-elevated py-3 text-[13px] font-medium text-body transition active:scale-[0.98]"
          >
            {t('balance.viewHistory')}
          </button>
        </div>
      </Sheet>

      <BottomNav active="home" />
    </div>
  );
}

function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-4 pt-5">
      <h2 className="text-[12px] font-semibold text-body">{title}</h2>
      {caption ? (
        <p className="mb-2.5 mt-0.5 text-[10px] text-faint">{caption}</p>
      ) : (
        <div className="h-2.5" />
      )}
      {children}
    </section>
  );
}
