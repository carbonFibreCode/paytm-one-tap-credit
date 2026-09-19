/**
 * The English source catalogue — every user-facing string on the demo path.
 *
 * Scope is deliberate: home, checkout, the approval flow and the receipt, which
 * is everything a person touches while paying. The decision trace and the demo
 * drawer stay English on purpose. They are the audit artefact and the
 * instrumentation, read by us and by anyone auditing a lending decision, and
 * machine-translating "Only 21 days and 6 transactions of history" into three
 * more languages would create three more things that can be subtly wrong.
 *
 * Placeholders are positional — {0}, {1} — never named. Sarvam Translate
 * rewrites a named token along with the sentence ({amount} comes back as
 * {राशि}), which breaks interpolation; a digit survives, and the model is free
 * to move it where the grammar wants it.
 */

export const en = {
  // --- bottom navigation ---------------------------------------------------
  'nav.home': 'Home',
  'nav.history': 'History',
  'nav.offers': 'Offers',
  'nav.profile': 'Profile',
  'nav.scan': 'Scan',
  'nav.scanAria': 'Scan any QR code',

  // --- home ----------------------------------------------------------------
  'home.greeting': 'Hi, {0}',
  'home.search': 'Search for a service or merchant',
  'home.switchProfile': 'Switch profile',
  'home.demoControls': 'Demo controls',
  'home.profileDetails': 'Profile details',
  'home.moneyTransfer': 'Money Transfer',
  'home.toMobile': 'To Mobile',
  'home.toBank': 'To Bank',
  'home.toSelf': 'To Self',
  'home.balance': 'Balance',
  'home.scanAndPay': 'Scan & Pay',
  'home.scanBlurb': 'Pay any merchant QR, UPI or Paytm',
  'home.merchants': 'Pay these merchants',
  'home.merchantsCaption': 'Tap any merchant to open its payment screen',
  'home.bills': 'Recharge & Bill Payments',
  'home.billMobile': 'Mobile',
  'home.billDth': 'DTH',
  'home.billElectricity': 'Electricity',
  'home.billCard': 'Card Bill',
  'home.billWater': 'Water',
  'home.billGas': 'Gas',
  'home.billFastag': 'FASTag',
  'home.billInsurance': 'Insurance',
  'home.postpaid': 'Paytm Postpaid',
  'home.postpaidBlurb':
    'Shop now, pay next month. Your limit is checked automatically at checkout.',
  'home.footerOne': 'Prototype for the Paytm Build for India AI Hackathon.',
  'home.footerTwo': 'Only the merchant list and scanner are wired; the rest is visual.',

  // --- balance sheet -------------------------------------------------------
  'balance.title': 'Balance & accounts',
  'balance.close': 'Close',
  'balance.paytmBalance': 'Paytm Balance',
  'balance.linkedBank': 'Linked bank',
  'balance.bankNote':
    'UPI payments draw on this account, not on your Paytm Balance — which is why a large UPI payment succeeds where the wallet would fall short.',
  'balance.viewHistory': 'View payment history',

  // --- checkout ------------------------------------------------------------
  'checkout.title': 'Payment',
  'checkout.verified': 'Verified name · A/c linked on Paytm',
  'checkout.upi': 'UPI',
  'checkout.wallet': 'Paytm Balance',
  'checkout.debitCard': 'Debit card',
  'checkout.proceed': 'Proceed securely',
  'checkout.insufficient': 'Not enough Paytm Balance',
  'checkout.shortBy': 'Short of {0}. Pay by UPI instead, or use the offer above.',
  'checkout.scoreFailed': 'Could not score this transaction — {0}',
  'checkout.deleteDigit': 'Delete last digit',

  // --- nudge ---------------------------------------------------------------
  'nudge.learnMore': 'Learn more',
  'nudge.noCostSuffix': 'no cost',
  'nudge.whySeeing': 'Why am I seeing this?',
  'nudge.dismiss': 'Dismiss this offer and pay normally',

  // --- approval ------------------------------------------------------------
  'approved.title': 'Convert to EMI',
  'approved.preApproved': 'Active limit',
  'approved.approvedFor': 'Available on your',
  'approved.limitUpTo': 'Credit limit up to',
  'approved.choosePlan': 'Choose a plan',
  'approved.planRow': '{0} months · {1}/mo',
  'approved.noCostPlan': 'No cost EMI — 0% APR, no interest or extra charges',
  'approved.interestPlan': 'Total {0} · {1} interest · {2} APR',
  'approved.noCost': 'No cost',
  'approved.lastEmi': 'last {0}',
  'approved.schedule': 'Repayment schedule',
  'approved.total': 'Total',
  'approved.fees': 'Processing fee ₹0 · no foreclosure charges · interest on reducing balance',
  'approved.partnerNote':
    'Activation, KYC and the credit line itself are issued by the partner bank. In this prototype that step is mocked — the decision layer is what we built.',
  'approved.youWillPay': 'You’ll pay',
  'approved.perMonth': '{0}/month · {1} months',
  'approved.confirm': 'Confirm & pay {0}',
  'approved.back': 'Back to {0}',
  'approved.backFallback': 'payment',

  // --- key fact statement --------------------------------------------------
  'kfs.heading': 'Key Fact Statement',
  'kfs.lender': 'Lender',
  'kfs.coolingOff': 'Cooling-off period',
  'kfs.coolingOffValue': '3 days — exit by repaying principal and proportionate APR, no penalty',
  'kfs.lateFee': 'Late payment fee',
  'kfs.lateFeeValue': '₹500 per missed instalment',
  'kfs.recovery': 'Recovery',
  'kfs.recoveryValue': 'By the partner bank, through your registered contact details only',
  'kfs.grievance': 'Grievance officer',
  'kfs.grievanceValue': 'grievance@paytmbank.example · 1800-000-0000',
  'kfs.consent': 'I have read the Key Fact Statement and agree to the terms',

  // --- pin -----------------------------------------------------------------
  'pin.title': 'Enter UPI PIN',
  'pin.payee': 'to {0}',
  'pin.secured': 'Secured by your bank · never shared with Paytm',
  'pin.entered': '{0} of {1} digits entered',

  // --- receipt -------------------------------------------------------------
  'success.paid': '{0} paid',
  'success.to': 'to {0}',
  'success.via': 'via {0}',
  'success.wallet': 'Paytm Wallet',
  'success.upi': 'UPI',
  'success.yourPlan': 'Your plan',
  'success.instalments': '{0} instalments of {1}',
  'success.firstDue': 'First instalment on {0}',
  'success.schedule': 'Schedule',
  'success.partnerNoteOne': 'The credit line, KYC and repayment are handled by the partner bank.',
  'success.partnerNoteTwo': 'Mocked here — this prototype is the decision layer.',
  'success.paidInFull': 'Paid in full',
  'success.fromWallet': 'from your Paytm Balance',
  'success.fromBank': 'from your linked bank account',
  'success.noOffer': 'No credit offer was taken.',
  'success.done': 'Done',
  'success.successAria': 'Payment successful',
} as const;

export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, string>;
