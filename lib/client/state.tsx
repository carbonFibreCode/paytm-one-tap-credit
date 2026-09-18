'use client';

/**
 * Demo application state.
 *
 * One reducer drives the whole flow, which keeps the screens dumb and makes the
 * demo drawer able to reach in and change anything live.
 *
 * Nudge history lives in localStorage rather than on the server. That is not a
 * shortcut — it is what keeps the engine pure. The caller owns its own history
 * and sends it with each request, so frequency caps survive a serverless cold
 * start and a decision can always be reproduced from its request alone.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type { Decision, EmiOption, Instrument, Language, NudgeHistoryEntry } from '../types';
import { getMerchant, MERCHANTS } from '../merchants';
import { personOrDefault } from '../people';
import {
  n8nConfigured,
  requestDecision,
  reportOutcome,
  reportPayment,
  requestNudgeText,
  resetUserCredit,
  type OrchestrationMode,
  type ServedBy,
} from './api';

// Bumping this version drops any history stored under the previous key, which
// is how we clear stale demo state left over from an earlier session.
const HISTORY_KEY = 'otc.nudge-history.v2';
const PAYMENTS_KEY = 'otc.payments.v1';

/** Settle time after the last keypress before the engine is asked. */
const DECISION_DEBOUNCE_MS = 320;

export type Screen =
  | 'persona'
  | 'home'
  | 'scanner'
  | 'history'
  | 'checkout'
  | 'approved'
  | 'success';

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

interface State {
  screen: Screen;
  userId: string;
  merchantId: string;
  amount: number;
  instrument: Instrument;

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
  historyByUser: Record<string, NudgeHistoryEntry[]>;
  historyLoaded: boolean;
  /** Completed payments, newest last, per user. */
  paymentsByUser: Record<string, PaymentRecord[]>;
}

type Action =
  | { type: 'go'; screen: Screen }
  | { type: 'selectMerchant'; merchantId: string; amount: number }
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
  | {
      type: 'historyLoaded';
      history: Record<string, NudgeHistoryEntry[]>;
      payments: Record<string, PaymentRecord[]>;
    }
  | { type: 'recordOutcome'; userId: string; entry: NudgeHistoryEntry }
  | { type: 'clearHistory'; userId: string };

const DEFAULT_MERCHANT = MERCHANTS[0];

const initialState: State = {
  screen: 'persona',
  userId: 'u_rohit',
  merchantId: DEFAULT_MERCHANT.id,
  amount: DEFAULT_MERCHANT.suggestedAmount,
  instrument: 'upi',
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

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'go':
      return { ...state, screen: action.screen, drawerOpen: false, infoOpen: false, traceOpen: false };

    case 'selectMerchant':
      return {
        ...clearDecision(state),
        merchantId: action.merchantId,
        amount: action.amount,
        instrument: 'upi',
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

interface Store extends State {
  merchant: ReturnType<typeof getMerchant>;
  history: NudgeHistoryEntry[];
  payments: PaymentRecord[];
  n8nAvailable: boolean;
  go: (screen: Screen) => void;
  selectMerchant: (merchantId: string, amount?: number) => void;
  setAmount: (amount: number) => void;
  setInstrument: (instrument: Instrument) => void;
  setUser: (userId: string) => void;
  setMode: (mode: OrchestrationMode) => void;
  setLanguage: (language: Language | null) => void;
  toggleDrawer: (open?: boolean) => void;
  toggleInfo: (open?: boolean) => void;
  toggleTrace: (open?: boolean) => void;
  acceptNudge: () => void;
  declineNudge: () => void;
  payNormally: () => void;
  confirmCredit: (tenure: EmiOption) => void;
  simulateHistory: (entry: NudgeHistoryEntry) => void;
  clearHistory: () => void;
}

const StoreContext = createContext<Store | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // --- persistence ---------------------------------------------------------

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      const paid = window.localStorage.getItem(PAYMENTS_KEY);
      dispatch({
        type: 'historyLoaded',
        history: raw ? JSON.parse(raw) : {},
        payments: paid ? JSON.parse(paid) : {},
      });
    } catch {
      // A corrupt or unavailable store must not stop the demo.
      dispatch({ type: 'historyLoaded', history: {}, payments: {} });
    }
  }, []);

  useEffect(() => {
    if (!state.historyLoaded) return;
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(state.historyByUser));
      window.localStorage.setItem(PAYMENTS_KEY, JSON.stringify(state.paymentsByUser));
    } catch {
      // Private browsing, quota, etc. — losing history is survivable.
    }
  }, [state.historyByUser, state.paymentsByUser, state.historyLoaded]);

  const history = useMemo(
    () => state.historyByUser[state.userId] ?? [],
    [state.historyByUser, state.userId],
  );

  // --- decisioning ---------------------------------------------------------

  const { screen, userId, merchantId, amount, instrument, mode, historyLoaded } = state;
  // A zero amount is not a transaction — the keypad passes through it on the
  // way down, and asking the engine to judge it would only produce a 400.
  const needsDecision = screen === 'checkout' && historyLoaded && amount > 0;

  useEffect(() => {
    if (!needsDecision) return;
    let cancelled = false;

    dispatch({ type: 'decisionStart' });

    // Typing an amount fires a keypress per digit. Without this, "50000" would
    // launch five decisions and the UI would flicker through four wrong answers
    // on the way to the right one.
    const debounce = setTimeout(() => {
      if (cancelled) return;
      runDecision();
    }, DECISION_DEBOUNCE_MS);

    function runDecision() {
    requestDecision({ userId, merchantId, amount, selectedInstrument: instrument, nudgeHistory: history }, mode)
      .then((outcome) => {
        if (cancelled) return;
        dispatch({
          type: 'decisionOk',
          decision: outcome.decision,
          meta: {
            servedBy: outcome.servedBy,
            latencyMs: outcome.latencyMs,
            fallbackReason: outcome.fallbackReason,
          },
          copy: outcome.nudgeText
            ? {
                text: outcome.nudgeText.text,
                source: outcome.nudgeText.source,
                reason: outcome.nudgeText.reason,
                latencyMs: outcome.nudgeText.latencyMs,
              }
            : undefined,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        dispatch({
          type: 'decisionFail',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return () => {
      cancelled = true;
      clearTimeout(debounce);
    };
    // `history` is intentionally excluded: recording an outcome should not
    // re-run the decision that produced it mid-animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsDecision, userId, merchantId, amount, instrument, mode]);

  // --- nudge copy ----------------------------------------------------------

  const decision = state.decision;
  const languageOverride = state.languageOverride;
  const needsCopy = Boolean(decision?.showNudge && decision.offer) && !state.nudgeCopy;

  useEffect(() => {
    if (!needsCopy || !decision?.offer) return;
    const merchant = getMerchant(merchantId);
    if (!merchant) return;

    // Lead with a no-cost plan when one exists; it is what the copy should sell.
    const headline =
      decision.offer.tenures.find((tenure) => tenure.noCost) ?? decision.offer.tenures[0];
    if (!headline) return;

    let cancelled = false;
    dispatch({ type: 'copyStart' });

    requestNudgeText({
      product: decision.offer.product,
      partner: decision.offer.partner,
      amount,
      merchantName: merchant.name,
      merchantCategory: merchant.category,
      months: headline.months,
      emi: headline.emi,
      noCost: headline.noCost,
      language: languageOverride ?? personOrDefault(userId).preferredLanguage,
    })
      .then((result) => {
        if (cancelled) return;
        dispatch({
          type: 'copyOk',
          copy: {
            text: result.nudgeText,
            source: result.source,
            reason: result.reason,
            latencyMs: result.latencyMs,
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        // The engine's own summary is a guaranteed last resort.
        dispatch({
          type: 'copyOk',
          copy: {
            text: decision.trace.summary,
            source: 'engine-summary',
            reason: 'nudge-text endpoint unreachable',
            latencyMs: null,
          },
        });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCopy, decision, amount, merchantId, languageOverride, userId]);

  // --- actions -------------------------------------------------------------

  const recordOutcome = useCallback(
    (outcome: NudgeHistoryEntry['outcome']) => {
      const product = state.decision?.product;
      if (!product) return;
      dispatch({
        type: 'recordOutcome',
        userId: state.userId,
        entry: { product, decidedAt: new Date().toISOString(), outcome },
      });
      reportOutcome({
        transactionId: state.decision?.transactionId ?? 'unknown',
        userId: state.userId,
        product,
        outcome,
      });
    },
    [state.decision?.product, state.decision?.transactionId, state.userId],
  );

  const value = useMemo<Store>(() => {
    const merchant = getMerchant(state.merchantId);

    return {
      ...state,
      merchant,
      history,
      payments: [...(state.paymentsByUser[state.userId] ?? [])].reverse(),
      n8nAvailable: n8nConfigured(),

      go: (next) => dispatch({ type: 'go', screen: next }),
      selectMerchant: (id, amount) => {
        const target = getMerchant(id);
        if (!target) return;
        // A scanned QR can carry its own amount; otherwise use the merchant's.
        dispatch({
          type: 'selectMerchant',
          merchantId: id,
          amount: amount && amount > 0 ? Math.round(amount) : target.suggestedAmount,
        });
      },
      setAmount: (next) => dispatch({ type: 'setAmount', amount: Math.max(0, Math.round(next)) }),
      setInstrument: (next) => dispatch({ type: 'setInstrument', instrument: next }),
      setUser: (next) => dispatch({ type: 'setUser', userId: next }),
      setMode: (next) => dispatch({ type: 'setMode', mode: next }),
      setLanguage: (next) => dispatch({ type: 'setLanguage', language: next }),
      toggleDrawer: (open) => dispatch({ type: 'toggleDrawer', open }),
      toggleInfo: (open) => dispatch({ type: 'toggleInfo', open }),
      toggleTrace: (open) => dispatch({ type: 'toggleTrace', open }),

      acceptNudge: () => {
        recordOutcome('accepted');
        dispatch({ type: 'go', screen: 'approved' });
      },
      declineNudge: () => {
        recordOutcome('declined');
        dispatch({ type: 'dismissNudge' });
      },
      payNormally: () => {
        const payment: PaymentRecord = {
          amount: state.amount,
          merchantName: merchant?.name ?? 'Merchant',
          merchantId: state.merchantId,
          method: state.instrument === 'wallet' ? 'wallet' : 'upi',
          at: new Date().toISOString(),
        };
        dispatch({ type: 'pay', payment });
        reportPayment({
          userId: state.userId,
          merchantId: state.merchantId,
          amount: payment.amount,
          method: payment.method,
          decisionKey: state.decision?.transactionId,
          at: payment.at!,
        });
      },
      confirmCredit: (tenure) => {
        const offer = state.decision?.offer;
        const payment: PaymentRecord = {
          amount: state.amount,
          merchantName: merchant?.name ?? 'Merchant',
          merchantId: state.merchantId,
          method: offer?.product ?? 'postpaid',
          partner: offer?.partner,
          tenure,
          at: new Date().toISOString(),
        };
        dispatch({ type: 'pay', payment });
        // This is the write that makes the next decision different: the
        // account and its schedule now exist, and affordability will see them.
        reportPayment({
          userId: state.userId,
          merchantId: state.merchantId,
          amount: payment.amount,
          method: payment.method,
          partner: payment.partner,
          tenure,
          decisionKey: state.decision?.transactionId,
          at: payment.at!,
        });
      },

      simulateHistory: (entry) => dispatch({ type: 'recordOutcome', userId: state.userId, entry }),
      clearHistory: () => {
        dispatch({ type: 'clearHistory', userId: state.userId });
        resetUserCredit(state.userId);
      },
    };
  }, [state, history, recordOutcome]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useApp(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useApp must be used inside <AppStateProvider>');
  return store;
}
