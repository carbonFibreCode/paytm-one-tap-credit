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

export function formatRupees(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
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
      `Why pay ${formatRupees(c.amount)} at once? Split it into ${c.months} no-cost EMIs of ${formatRupees(c.emi)} with ${c.partner}.`,
    (c) =>
      `${formatRupees(c.amount)} at ${c.merchantName} — pay ${formatRupees(c.emi)} a month for ${c.months} months, at no extra cost.`,
    (c) =>
      `Keep your balance intact. ${c.partner} spreads this ${formatRupees(c.amount)} into ${c.months} instalments of ${formatRupees(c.emi)}, interest-free.`,
  ],
  hi: [
    (c) =>
      `${formatRupees(c.amount)} एक साथ क्यों देना? ${c.partner} से ${c.months} आसान EMI में — हर महीने सिर्फ़ ${formatRupees(c.emi)}।`,
    (c) =>
      `${c.merchantName} पर ${formatRupees(c.amount)} — बिना ब्याज ${c.months} किस्तों में बाँट लीजिए, महीने के ${formatRupees(c.emi)}।`,
    (c) =>
      `अभी पूरा पैसा देने की ज़रूरत नहीं। ${c.partner} से ${c.months} महीने, हर महीने ${formatRupees(c.emi)} — कोई अतिरिक्त शुल्क नहीं।`,
  ],
  ta: [
    (c) =>
      `${formatRupees(c.amount)} ஒரே தடவையில் ஏன்? ${c.partner} மூலம் ${c.months} தவணைகளில் — மாதம் ${formatRupees(c.emi)} மட்டும்.`,
    (c) =>
      `${c.merchantName}-இல் ${formatRupees(c.amount)} — வட்டி இல்லாமல் ${c.months} தவணைகளாக, மாதம் ${formatRupees(c.emi)}.`,
    (c) =>
      `முழுத் தொகையையும் இப்போதே தர வேண்டாம். ${c.partner} மூலம் ${c.months} மாதம், மாதம் ${formatRupees(c.emi)} — கூடுதல் கட்டணம் இல்லை.`,
  ],
  bn: [
    (c) =>
      `${formatRupees(c.amount)} একসাথে কেন? ${c.partner} দিয়ে ${c.months}টি সহজ কিস্তিতে — মাসে মাত্র ${formatRupees(c.emi)}।`,
    (c) =>
      `${c.merchantName}-এ ${formatRupees(c.amount)} — কোনও সুদ ছাড়াই ${c.months}টি কিস্তিতে ভাগ করে নিন, মাসে ${formatRupees(c.emi)}।`,
    (c) =>
      `এখনই পুরো টাকা দেওয়ার দরকার নেই। ${c.partner} দিয়ে ${c.months} মাস, মাসে ${formatRupees(c.emi)} — বাড়তি খরচ নেই।`,
  ],
};

const WITH_INTEREST: Record<Language, Renderer[]> = {
  en: [
    (c) =>
      `${formatRupees(c.amount)} at ${c.merchantName}? Pay it over ${c.months} months at ${formatRupees(c.emi)} with ${c.partner}.`,
    (c) =>
      `Spread this ${formatRupees(c.amount)} across ${c.months} instalments of ${formatRupees(c.emi)} — your ${c.partner} is already approved.`,
    (c) =>
      `No need to pay ${formatRupees(c.amount)} upfront. ${c.months} monthly instalments of ${formatRupees(c.emi)} on your ${c.partner}.`,
  ],
  hi: [
    (c) =>
      `${c.merchantName} पर ${formatRupees(c.amount)}? ${c.partner} से ${c.months} महीने में — हर महीने ${formatRupees(c.emi)}।`,
    (c) =>
      `${formatRupees(c.amount)} को ${c.months} किस्तों में बाँट लीजिए — महीने के ${formatRupees(c.emi)}। आपका ${c.partner} पहले से मंज़ूर है।`,
    (c) =>
      `पूरा ${formatRupees(c.amount)} अभी देने की ज़रूरत नहीं — ${c.months} महीने, हर महीने ${formatRupees(c.emi)}।`,
  ],
  ta: [
    (c) =>
      `${c.merchantName}-இல் ${formatRupees(c.amount)}? ${c.partner} மூலம் ${c.months} மாதங்களில் — மாதம் ${formatRupees(c.emi)}.`,
    (c) =>
      `${formatRupees(c.amount)}-ஐ ${c.months} தவணைகளாகப் பிரியுங்கள் — மாதம் ${formatRupees(c.emi)}. உங்கள் ${c.partner} ஏற்கெனவே அங்கீகரிக்கப்பட்டுள்ளது.`,
    (c) =>
      `முழு ${formatRupees(c.amount)}-ஐயும் இப்போதே தர வேண்டாம் — ${c.months} மாதம், மாதம் ${formatRupees(c.emi)}.`,
  ],
  bn: [
    (c) =>
      `${c.merchantName}-এ ${formatRupees(c.amount)}? ${c.partner} দিয়ে ${c.months} মাসে — মাসে ${formatRupees(c.emi)}।`,
    (c) =>
      `${formatRupees(c.amount)} ${c.months}টি কিস্তিতে ভাগ করে নিন — মাসে ${formatRupees(c.emi)}। আপনার ${c.partner} ইতিমধ্যেই অনুমোদিত।`,
    (c) =>
      `পুরো ${formatRupees(c.amount)} এখনই দেওয়ার দরকার নেই — ${c.months} মাস, মাসে ${formatRupees(c.emi)}।`,
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

/** Language label for the UI toggle. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  hi: 'हिन्दी',
  ta: 'தமிழ்',
  bn: 'বাংলা',
};
