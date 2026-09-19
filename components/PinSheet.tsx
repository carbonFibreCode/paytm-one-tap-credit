'use client';

/**
 * UPI PIN entry.
 *
 * Every payment in the app goes through here, because a payment that completes
 * without a second factor is not a payment anyone is allowed to make: NPCI
 * requires the UPI PIN, and RBI requires an additional factor on a credit
 * debit. Leaving it out would have made the fastest part of the demo the part
 * a regulator would stop.
 *
 * It sits over the screen rather than replacing it, so `payNormally` and
 * `confirmCredit` keep working exactly as they did — this component only
 * decides when to call them. Any six digits are accepted; the point is that
 * the step exists and cannot be skipped, not that we have built a real HSM.
 */

import { useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useApp } from '@/lib/client/state';
import { formatINR } from '@/lib/format';
import { Sheet } from './Sheet';
import { Keypad } from './Keypad';

const PIN_LENGTH = 6;
/** Long enough for the last dot to paint before the sheet hands off. */
const AUTHORISE_DELAY_MS = 260;

export function PinSheet({
  open,
  amount,
  payee,
  onClose,
  onAuthorised,
}: {
  open: boolean;
  amount: number;
  /** Bank or credit line the money actually leaves from. */
  payee: string;
  onClose: () => void;
  onAuthorised: () => void;
}) {
  const { t } = useApp();
  const [pin, setPin] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Dismissing mid-authorisation must not let the payment through anyway. */
  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPin('');
    onClose();
  };

  const press = (key: string) => {
    if (key === 'back') {
      setPin((current) => current.slice(0, -1));
      return;
    }
    if (pin.length >= PIN_LENGTH || timer.current) return;

    const next = pin + key;
    setPin(next);
    if (next.length === PIN_LENGTH) {
      timer.current = setTimeout(() => {
        timer.current = null;
        setPin('');
        onAuthorised();
      }, AUTHORISE_DELAY_MS);
    }
  };

  return (
    <Sheet open={open} onClose={close} label={t('pin.title')} maxHeightClass="max-h-[78%]">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-5 pb-4 text-center">
          <p className="text-[13px] font-semibold text-body">{t('pin.title')}</p>
          <p className="mt-0.5 text-[11px] text-muted">{t('pin.payee', payee)}</p>
          <p className="mt-3 text-[24px] font-semibold leading-none text-white">
            {formatINR(amount)}
          </p>

          <div className="mt-5 flex items-center justify-center gap-3" aria-hidden="true">
            {Array.from({ length: PIN_LENGTH }, (_, index) => (
              <span
                key={index}
                className={`h-2.5 w-2.5 rounded-full transition ${
                  index < pin.length ? 'bg-brand' : 'bg-line'
                }`}
              />
            ))}
          </div>
          <span className="sr-only" aria-live="polite">
            {t('pin.entered', pin.length, PIN_LENGTH)}
          </span>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-faint">
            <ShieldCheck size={12} className="text-good" />
            {t('pin.secured')}
          </p>
        </div>

        <div className="mt-auto">
          <Keypad onPress={press} deleteLabel={t('checkout.deleteDigit')} />
        </div>
      </div>
    </Sheet>
  );
}
