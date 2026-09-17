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
import {
  n8nConfigured,
  requestDecision,
  requestNudgeText,
  type OrchestrationMode,
  type ServedBy,
} from './api';

const HISTORY_KEY = 'otc.nudge-history.v1';

export type Screen = 'home' | 'checkout' | 'approved' | 'success';

export interface PaymentRecord {
  amount: number;
  merchantName: string;
  method: 'upi' | 'postpaid' | 'card';
  partner?: string;
  tenure?: EmiOption;
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
  historyByUser: Record<string, NudgeHistoryEntry[]>;
  historyLoaded: boolean;
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
  | { type: 'historyLoaded'; history: Record<string, NudgeHistoryEntry[]> }
  | { type: 'recordOutcome'; userId: string; entry: NudgeHistoryEntry }
  | { type: 'clearHistory'; userId: string };

const DEFAULT_MERCHANT = MERCHANTS[0];

const initialState: State = {
  screen: 'home',
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
  historyByUser: {},
  historyLoaded: false,
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
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'go':
      return { ...state, screen: action.screen, drawerOpen: false };

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
      return { ...clearDecision(state), userId: action.userId };

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

    case 'pay':
      return { ...state, payment: action.payment, screen: 'success', drawerOpen: false };

    case 'setMode':
      return { ...clearDecision(state), mode: action.mode };

    case 'setLanguage':
      return { ...state, languageOverride: action.language, nudgeCopy: null };

    case 'toggleDrawer':
      return { ...state, drawerOpen: action.open ?? !state.drawerOpen };

    case 'historyLoaded':
      return { ...state, historyByUser: action.history, historyLoaded: true };

    case 'recordOutcome': {
      const existing = state.historyByUser[action.userId] ?? [];
      return {
        ...state,
        historyByUser: { ...state.historyByUser, [action.userId]: [...existing, action.entry] },
      };
    }

    case 'clearHistory': {
      const next = { ...state.historyByUser };
      delete next[action.userId];
      return { ...clearDecision(state), historyByUser: next };
    }

    default:
      return state;
  }
}

interface Store extends State {
  merchant: ReturnType<typeof getMerchant>;
  history: NudgeHistoryEntry[];
  n8nAvailable: boolean;
  go: (screen: Screen) => void;
  selectMerchant: (merchantId: string) => void;
  setAmount: (amount: number) => void;
  setInstrument: (instrument: Instrument) => void;
  setUser: (userId: string) => void;
  setMode: (mode: OrchestrationMode) => void;
  setLanguage: (language: Language | null) => void;
  toggleDrawer: (open?: boolean) => void;
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
      dispatch({ type: 'historyLoaded', history: raw ? JSON.parse(raw) : {} });
    } catch {
      // A corrupt or unavailable store must not stop the demo.
      dispatch({ type: 'historyLoaded', history: {} });
    }
  }, []);

  useEffect(() => {
    if (!state.historyLoaded) return;
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(state.historyByUser));
    } catch {
      // Private browsing, quota, etc. — losing history is survivable.
    }
  }, [state.historyByUser, state.historyLoaded]);

  const history = useMemo(
    () => state.historyByUser[state.userId] ?? [],
    [state.historyByUser, state.userId],
  );

  // --- decisioning ---------------------------------------------------------

  const { screen, userId, merchantId, amount, instrument, mode, historyLoaded } = state;
  const needsDecision = screen === 'checkout' && historyLoaded;

  useEffect(() => {
    if (!needsDecision) return;
    let cancelled = false;

    dispatch({ type: 'decisionStart' });
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

    return () => {
      cancelled = true;
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
      language: languageOverride ?? inferLanguage(userId),
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
    },
    [state.decision?.product, state.userId],
  );

  const value = useMemo<Store>(() => {
    const merchant = getMerchant(state.merchantId);

    return {
      ...state,
      merchant,
      history,
      n8nAvailable: n8nConfigured(),

      go: (next) => dispatch({ type: 'go', screen: next }),
      selectMerchant: (id) => {
        const target = getMerchant(id);
        if (!target) return;
        dispatch({ type: 'selectMerchant', merchantId: id, amount: target.suggestedAmount });
      },
      setAmount: (next) => dispatch({ type: 'setAmount', amount: Math.max(0, Math.round(next)) }),
      setInstrument: (next) => dispatch({ type: 'setInstrument', instrument: next }),
      setUser: (next) => dispatch({ type: 'setUser', userId: next }),
      setMode: (next) => dispatch({ type: 'setMode', mode: next }),
      setLanguage: (next) => dispatch({ type: 'setLanguage', language: next }),
      toggleDrawer: (open) => dispatch({ type: 'toggleDrawer', open }),

      acceptNudge: () => {
        recordOutcome('accepted');
        dispatch({ type: 'go', screen: 'approved' });
      },
      declineNudge: () => {
        recordOutcome('declined');
        dispatch({ type: 'dismissNudge' });
      },
      payNormally: () => {
        dispatch({
          type: 'pay',
          payment: {
            amount: state.amount,
            merchantName: merchant?.name ?? 'Merchant',
            method: 'upi',
          },
        });
      },
      confirmCredit: (tenure) => {
        const offer = state.decision?.offer;
        dispatch({
          type: 'pay',
          payment: {
            amount: state.amount,
            merchantName: merchant?.name ?? 'Merchant',
            method: offer?.product ?? 'postpaid',
            partner: offer?.partner,
            tenure,
          },
        });
      },

      simulateHistory: (entry) => dispatch({ type: 'recordOutcome', userId: state.userId, entry }),
      clearHistory: () => dispatch({ type: 'clearHistory', userId: state.userId }),
    };
  }, [state, history, recordOutcome]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useApp(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useApp must be used inside <AppStateProvider>');
  return store;
}

/** Each persona has a preferred language; the drawer can override it. */
function inferLanguage(userId: string): Language {
  const languages: Record<string, Language> = {
    u_rohit: 'hi',
    u_priya: 'en',
    u_aman: 'hi',
    u_deepak: 'en',
    u_meera: 'ta',
    u_vikram: 'bn',
  };
  return languages[userId] ?? 'en';
}
