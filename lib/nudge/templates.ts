/**
 * Fallback nudge copy.
 *
 * These are the safety net for when Sarvam is unavailable, rate-limited or slow.
 * They are deliberately *contextual* rather than one translated string: the
 * phrasing changes with the product, whether the plan is no-cost, and the
 * language. In production every one of these would be Sarvam-generated; here
 * they guarantee the checkout never renders an empty nudge.
 */

import type { Language, MerchantCategory, ProductId } from '../types';
import { formatINR } from '../format';

export interface NudgeContext {
  product: ProductId;
  partner: string;
  amount: number;
  merchantName: string;
  merchantCategory: MerchantCategory;
  /** The headline plan — no-cost when one exists, else the smallest instalment. */
  months: number;
  emi: number;
  noCost: boolean;
  language: Language;
}

type Renderer = (context: NudgeContext) => string;

/**
 * Three variants per language per plan type. The variant is chosen by a stable
 * hash of the context, so the same transaction always reads the same way while
 * different transactions don't all sound identical.
 */
const NO_COST: Record<Language, Renderer[]> = {
  en: [
    (c) =>
      `Why pay ${formatINR(c.amount)} at once? Split it into ${c.months} no-cost EMIs of ${formatINR(c.emi)} with ${c.partner}.`,
    (c) =>
      `${formatINR(c.amount)} at ${c.merchantName} — pay ${formatINR(c.emi)} a month for ${c.months} months, at no extra cost.`,
    (c) =>
      `Keep your balance intact. ${c.partner} spreads this ${formatINR(c.amount)} into ${c.months} instalments of ${formatINR(c.emi)}, interest-free.`,
  ],
  hi: [
    (c) =>
      `${formatINR(c.amount)} एक साथ क्यों देना? ${c.partner} से ${c.months} आसान EMI में — हर महीने सिर्फ़ ${formatINR(c.emi)}।`,
    (c) =>
      `${c.merchantName} पर ${formatINR(c.amount)} — बिना ब्याज ${c.months} किस्तों में बाँट लीजिए, महीने के ${formatINR(c.emi)}।`,
    (c) =>
      `अभी पूरा पैसा देने की ज़रूरत नहीं। ${c.partner} से ${c.months} महीने, हर महीने ${formatINR(c.emi)} — कोई अतिरिक्त शुल्क नहीं।`,
  ],
  ta: [
    (c) =>
      `${formatINR(c.amount)} ஒரே தடவையில் ஏன்? ${c.partner} மூலம் ${c.months} தவணைகளில் — மாதம் ${formatINR(c.emi)} மட்டும்.`,
    (c) =>
      `${c.merchantName}-இல் ${formatINR(c.amount)} — வட்டி இல்லாமல் ${c.months} தவணைகளாக, மாதம் ${formatINR(c.emi)}.`,
    (c) =>
      `முழுத் தொகையையும் இப்போதே தர வேண்டாம். ${c.partner} மூலம் ${c.months} மாதம், மாதம் ${formatINR(c.emi)} — கூடுதல் கட்டணம் இல்லை.`,
  ],
  bn: [
    (c) =>
      `${formatINR(c.amount)} একসাথে কেন? ${c.partner} দিয়ে ${c.months}টি সহজ কিস্তিতে — মাসে মাত্র ${formatINR(c.emi)}।`,
    (c) =>
      `${c.merchantName}-এ ${formatINR(c.amount)} — কোনও সুদ ছাড়াই ${c.months}টি কিস্তিতে ভাগ করে নিন, মাসে ${formatINR(c.emi)}।`,
    (c) =>
      `এখনই পুরো টাকা দেওয়ার দরকার নেই। ${c.partner} দিয়ে ${c.months} মাস, মাসে ${formatINR(c.emi)} — বাড়তি খরচ নেই।`,
  ],
};

const WITH_INTEREST: Record<Language, Renderer[]> = {
  en: [
    (c) =>
      `${formatINR(c.amount)} at ${c.merchantName}? Pay it over ${c.months} months at ${formatINR(c.emi)} with ${c.partner}.`,
    (c) =>
      `Spread this ${formatINR(c.amount)} across ${c.months} instalments of ${formatINR(c.emi)} — your ${c.partner} is already approved.`,
    (c) =>
      `No need to pay ${formatINR(c.amount)} upfront. ${c.months} monthly instalments of ${formatINR(c.emi)} on your ${c.partner}.`,
  ],
  hi: [
    (c) =>
      `${c.merchantName} पर ${formatINR(c.amount)}? ${c.partner} से ${c.months} महीने में — हर महीने ${formatINR(c.emi)}।`,
    (c) =>
      `${formatINR(c.amount)} को ${c.months} किस्तों में बाँट लीजिए — महीने के ${formatINR(c.emi)}। आपका ${c.partner} पहले से मंज़ूर है।`,
    (c) =>
      `पूरा ${formatINR(c.amount)} अभी देने की ज़रूरत नहीं — ${c.months} महीने, हर महीने ${formatINR(c.emi)}।`,
  ],
  ta: [
    (c) =>
      `${c.merchantName}-இல் ${formatINR(c.amount)}? ${c.partner} மூலம் ${c.months} மாதங்களில் — மாதம் ${formatINR(c.emi)}.`,
    (c) =>
      `${formatINR(c.amount)}-ஐ ${c.months} தவணைகளாகப் பிரியுங்கள் — மாதம் ${formatINR(c.emi)}. உங்கள் ${c.partner} ஏற்கெனவே அங்கீகரிக்கப்பட்டுள்ளது.`,
    (c) =>
      `முழு ${formatINR(c.amount)}-ஐயும் இப்போதே தர வேண்டாம் — ${c.months} மாதம், மாதம் ${formatINR(c.emi)}.`,
  ],
  bn: [
    (c) =>
      `${c.merchantName}-এ ${formatINR(c.amount)}? ${c.partner} দিয়ে ${c.months} মাসে — মাসে ${formatINR(c.emi)}।`,
    (c) =>
      `${formatINR(c.amount)} ${c.months}টি কিস্তিতে ভাগ করে নিন — মাসে ${formatINR(c.emi)}। আপনার ${c.partner} ইতিমধ্যেই অনুমোদিত।`,
    (c) =>
      `পুরো ${formatINR(c.amount)} এখনই দেওয়ার দরকার নেই — ${c.months} মাস, মাসে ${formatINR(c.emi)}।`,
  ],
};

/** Stable variant choice — same context always reads the same way. */
function variantIndex(context: NudgeContext, count: number): number {
  const key = `${context.product}|${context.amount}|${context.merchantName}|${context.months}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % count;
}

export function renderTemplate(context: NudgeContext): string {
  const bank = context.noCost ? NO_COST : WITH_INTEREST;
  const variants = bank[context.language] ?? bank.en;
  return variants[variantIndex(context, variants.length)](context);
}
