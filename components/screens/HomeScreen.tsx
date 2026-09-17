'use client';

import { motion } from 'framer-motion';
import { MERCHANTS } from '@/lib/merchants';
import { useApp } from '@/lib/client/state';
import { formatINR } from '@/lib/format';
import { Monogram, StatusBar } from '../Chrome';

export function HomeScreen() {
  const { selectMerchant, userId, toggleDrawer } = useApp();
  const person = PEOPLE[userId] ?? PEOPLE.u_rohit;

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-brand-deep to-ink">
        <StatusBar />
        <div className="flex items-center gap-3 px-5 pb-5 pt-2">
          <button
            type="button"
            onClick={() => toggleDrawer(true)}
            aria-label="Open demo controls"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-[15px] font-semibold text-white transition active:scale-95"
          >
            {person.initials}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-white/60">Welcome back</p>
            <p className="truncate text-[15px] font-semibold text-white">{person.name}</p>
          </div>
          <div className="shrink-0 rounded-xl bg-white/10 px-3 py-1.5 text-right">
            <p className="text-[9px] uppercase tracking-wide text-white/60">Balance</p>
            <p className="text-[13px] font-semibold text-white">{formatINR(person.balance)}</p>
          </div>
        </div>
      </div>

      <div className="scroll-slim flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-muted">
          Pay a merchant
        </h2>

        <div className="space-y-2">
          {MERCHANTS.map((merchant, index) => (
            <motion.button
              key={merchant.id}
              type="button"
              onClick={() => selectMerchant(merchant.id)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.035, duration: 0.25 }}
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition hover:border-brand/40 hover:bg-elevated active:scale-[0.99]"
            >
              <Monogram text={merchant.monogram} tint={merchant.tint} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-body">
                  {merchant.name}
                </span>
                <span className="block truncate text-[11px] text-muted">{merchant.blurb}</span>
              </span>
              <span className="shrink-0 text-[12px] text-faint">
                {formatINR(merchant.suggestedAmount)}
              </span>
            </motion.button>
          ))}
        </div>

        <p className="mt-5 text-center text-[10px] leading-relaxed text-faint">
          Prototype for the Paytm Build for India AI Hackathon.
          <br />
          Merchants, users and transaction history are synthetic.
        </p>
      </div>
    </div>
  );
}

const PEOPLE: Record<string, { name: string; initials: string; balance: number }> = {
  u_rohit: { name: 'Rohit Sharma', initials: 'RS', balance: 12_480 },
  u_priya: { name: 'Priya Nair', initials: 'PN', balance: 8_260 },
  u_aman: { name: 'Aman Verma', initials: 'AV', balance: 4_110 },
  u_deepak: { name: 'Deepak Rao', initials: 'DR', balance: 6_940 },
  u_meera: { name: 'Meera Iyer', initials: 'MI', balance: 15_320 },
  u_vikram: { name: 'Vikram Singh', initials: 'VS', balance: 9_870 },
};
