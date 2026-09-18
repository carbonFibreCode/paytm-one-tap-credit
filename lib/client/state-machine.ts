/**
 * The demo's state machine.
 *
 * A pure reducer with no React and no I/O, split out from the provider so it
 * can be tested directly — it drives every screen transition in the demo, and
 * a wrong transition is the kind of bug that only shows up on stage.
 *
 * Nudge history lives in localStorage rather than on the server. That is not a
 * shortcut — it is what keeps the engine pure. The caller owns its own history
 * and sends it with each request, so frequency caps survive a serverless cold
 * start and a decision can always be reproduced from its request alone.
 */

import type { Decision, EmiOption, Instrument, Language, NudgeHistoryEntry } from '../types';
import { MERCHANTS } from '../fixtures/merchants';
import type { OrchestrationMode, ServedBy } from './api';

export type Screen =
  'persona' | 'home' | 'scanner' | 'history' | 'checkout' | 'approved' | 'success';

export interface PaymentRecord {
  amount: number;
  merchantName: string;
  merchantId?: string;
  method: 'upi' | 'wallet' | 'postpaid' | 'card';
  partner?: string;
  tenure?: EmiOption;
  /** ISO timestamp. Set when the payment is made, so history can be ordered. */
  at?: string;
}

export interface DecisionMeta {
  servedBy: ServedBy;
  latencyMs: number;
  fallbackReason?: string;
}

export interface NudgeCopy {
  text: string;
  source: string;
  reason: string | null;
  latencyMs: number | null;
}

export interface State {
  screen: Screen;
  userId: string;
  merchantId: string;
  amount: number;
  instrument: Instrument;
  /** Set when checkout began from a verified QR scan; null when picked from a list. */
  intentRef: string | null;

  decision: Decision | null;
  decisionMeta: DecisionMeta | null;
  decisionError: string | null;
  decisionLoading: boolean;

  nudgeCopy: NudgeCopy | null;
  nudgeCopyLoading: boolean;
  /** Set when the user declines, so the card stays down for this checkout. */
  nudgeDismissed: boolean;

  payment: PaymentRecord | null;

  mode: OrchestrationMode;
  languageOverride: Language | null;
  drawerOpen: boolean;
  infoOpen: boolean;
  traceOpen: boolean;
  /**
   * Whether to show the instrumentation a real Paytm build would never carry:
   * the engine strip on a withheld decision, the Sarvam latency badge, the demo
   * entry point on checkout. Off by default so the app opens looking shipped \u2014
   * a judge should meet the product first and the engine second.
   */
  explainMode: boolean;
  historyByUser: Record<string, NudgeHistoryEntry[]>;
  historyLoaded: boolean;
  /** Completed payments, newest last, per user. */
  paymentsByUser: Record<string, PaymentRecord[]>;
}

export type Action =
  | { type: 'go'; screen: Screen }
  | { type: 'selectMerchant'; merchantId: string; amount: number; intentRef?: string }
  | { type: 'setAmount'; amount: number }
  | { type: 'setInstrument'; instrument: Instrument }
  | { type: 'setUser'; userId: string }
  | { type: 'decisionStart' }
  | { type: 'decisionOk'; decision: Decision; meta: DecisionMeta; copy?: NudgeCopy }
  | { type: 'decisionFail'; error: string }
  | { type: 'copyStart' }
  | { type: 'copyOk'; copy: NudgeCopy }
  | { type: 'dismissNudge' }
  | { type: 'pay'; payment: PaymentRecord }
  | { type: 'setMode'; mode: OrchestrationMode }
  | { type: 'setLanguage'; language: Language | null }
  | { type: 'toggleDrawer'; open?: boolean }
  | { type: 'toggleInfo'; open?: boolean }
  | { type: 'toggleTrace'; open?: boolean }
  | { type: 'toggleExplain'; on?: boolean }
  | {
      type: 'historyLoaded';
      history: Record<string, NudgeHistoryEntry[]>;
      payments: Record<string, PaymentRecord[]>;
    }
  | { type: 'recordOutcome'; userId: string; entry: NudgeHistoryEntry }
  | { type: 'clearHistory'; userId: string };

const DEFAULT_MERCHANT = MERCHANTS[0];

export const initialState: State = {
  screen: 'persona',
  userId: 'u_rohit',
  merchantId: DEFAULT_MERCHANT.id,
  amount: DEFAULT_MERCHANT.suggestedAmount,
  instrument: 'upi',
  intentRef: null,
  decision: null,
  decisionMeta: null,
  decisionError: null,
  decisionLoading: false,
  nudgeCopy: null,
  nudgeCopyLoading: false,
  nudgeDismissed: false,
  payment: null,
  mode: 'orchestrated',
  languageOverride: null,
  drawerOpen: false,
  infoOpen: false,
  traceOpen: false,
  explainMode: false,
  historyByUser: {},
  historyLoaded: false,
  paymentsByUser: {},
};

/** Any change to the transaction invalidates the decision that described it. */
function clearDecision(state: State): State {
  return {
    ...state,
    decision: null,
    decisionMeta: null,
    decisionError: null,
    nudgeCopy: null,
    nudgeDismissed: false,
    traceOpen: false,
  };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'go':
      return {
        ...state,
        screen: action.screen,
        drawerOpen: false,
        infoOpen: false,
        traceOpen: false,
      };

    case 'selectMerchant':
      return {
        ...clearDecision(state),
        merchantId: action.merchantId,
        amount: action.amount,
        instrument: 'upi',
        intentRef: action.intentRef ?? null,
        screen: 'checkout',
      };

    case 'setAmount':
      return { ...clearDecision(state), amount: action.amount };

    case 'setInstrument':
      return { ...clearDecision(state), instrument: action.instrument };

    case 'setUser':
      // Landing back on home avoids showing one person's checkout to another.
      return {
        ...clearDecision(state),
        userId: action.userId,
        screen: state.screen === 'persona' ? 'home' : state.screen,
        drawerOpen: false,
      };

    case 'decisionStart':
      return { ...state, decisionLoading: true, decisionError: null };

    case 'decisionOk':
      return {
        ...state,
        decisionLoading: false,
        decision: action.decision,
        decisionMeta: action.meta,
        nudgeCopy: action.copy ?? null,
        nudgeCopyLoading: action.decision.showNudge && !action.copy,
      };

    case 'decisionFail':
      return { ...state, decisionLoading: false, decisionError: action.error };

    case 'copyStart':
      return { ...state, nudgeCopyLoading: true };

    case 'copyOk':
      return { ...state, nudgeCopyLoading: false, nudgeCopy: action.copy };

    case 'dismissNudge':
      return { ...state, nudgeDismissed: true };

    case 'pay': {
      // Every completed payment lands in history — that is what makes the
      // History tab a record of this session rather than a static mock.
      const mine = state.paymentsByUser[state.userId] ?? [];
      return {
        ...state,
        payment: action.payment,
        paymentsByUser: { ...state.paymentsByUser, [state.userId]: [...mine, action.payment] },
        screen: 'success',
        drawerOpen: false,
      };
    }

    case 'setMode':
      return { ...clearDecision(state), mode: action.mode };

    case 'setLanguage':
      return { ...state, languageOverride: action.language, nudgeCopy: null };

    case 'toggleDrawer':
      return { ...state, drawerOpen: action.open ?? !state.drawerOpen };

    case 'toggleInfo':
      return { ...state, infoOpen: action.open ?? !state.infoOpen };

    case 'toggleTrace':
      return { ...state, traceOpen: action.open ?? !state.traceOpen };

    case 'toggleExplain':
      return { ...state, explainMode: action.on ?? !state.explainMode };

    case 'historyLoaded':
      return {
        ...state,
        historyByUser: action.history,
        paymentsByUser: action.payments,
        historyLoaded: true,
      };

    case 'recordOutcome': {
      const existing = state.historyByUser[action.userId] ?? [];
      return {
        ...state,
        historyByUser: { ...state.historyByUser, [action.userId]: [...existing, action.entry] },
      };
    }

    case 'clearHistory': {
      // A reset is a reset: nudge history and payments both go, locally and on
      // the server, so the next decision sees the persona as first shipped.
      const next = { ...state.historyByUser };
      delete next[action.userId];
      const payments = { ...state.paymentsByUser };
      delete payments[action.userId];
      return { ...clearDecision(state), historyByUser: next, paymentsByUser: payments };
    }

    default:
      return state;
  }
}
