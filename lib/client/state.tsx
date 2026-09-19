'use client';

/**
 * The demo's state provider: persistence, the decision and nudge-copy effects,
 * and the action creators the screens call.
 *
 * The transitions themselves are in `state-machine.ts`, which is pure and
 * tested; this file is the part that talks to localStorage, the network and
 * React.
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
import type { EmiOption, Instrument, Language, NudgeHistoryEntry } from '../types';
import { translator, type Translate } from '../i18n';
import { getMerchant } from '../fixtures/merchants';
import { personOrDefault } from '../fixtures/people';
import {
  initialState,
  reducer,
  type PaymentRecord,
  type Screen,
  type State,
} from './state-machine';
export type { DecisionMeta, NudgeCopy, PaymentRecord, Screen } from './state-machine';
import {
  attachIntentDecision,
  n8nConfigured,
  requestDecision,
  reportOutcome,
  reportPayment,
  requestNudgeText,
  resetUserCredit,
  type OrchestrationMode,
} from './api';

// Bumping this version drops any history stored under the previous key, which
// is how we clear stale demo state left over from an earlier session.
const HISTORY_KEY = 'otc.nudge-history.v2';
const PAYMENTS_KEY = 'otc.payments.v1';

/** Settle time after the last keypress before the engine is asked. */
const DECISION_DEBOUNCE_MS = 320;

interface Store extends State {
  merchant: ReturnType<typeof getMerchant>;
  history: NudgeHistoryEntry[];
  payments: PaymentRecord[];
  n8nAvailable: boolean;
  /** The app's language — the drawer's override, else whose wallet this is. */
  language: Language;
  /** Translator bound to `language`; re-created only when the language moves. */
  t: Translate;
  go: (screen: Screen) => void;
  selectMerchant: (merchantId: string, amount?: number, intentRef?: string) => void;
  setAmount: (amount: number) => void;
  setInstrument: (instrument: Instrument) => void;
  setUser: (userId: string) => void;
  setMode: (mode: OrchestrationMode) => void;
  setLanguage: (language: Language | null) => void;
  toggleDrawer: (open?: boolean) => void;
  toggleInfo: (open?: boolean) => void;
  toggleTrace: (open?: boolean) => void;
  toggleExplain: (on?: boolean) => void;
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

  const { screen, userId, merchantId, amount, instrument, mode, historyLoaded, intentRef } = state;
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
      requestDecision(
        {
          userId,
          merchantId,
          amount,
          selectedInstrument: instrument,
          nudgeHistory: history,
          intentRef: intentRef ?? undefined,
        },
        mode,
      )
        .then((outcome) => {
          if (cancelled) return;
          // Close the loop on the QR: the intent now knows which decision it led to.
          if (intentRef) attachIntentDecision(intentRef, outcome.decision.transactionId);
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
  }, [needsDecision, userId, merchantId, amount, instrument, mode, intentRef]);

  // --- nudge copy ----------------------------------------------------------

  const decision = state.decision;
  const languageOverride = state.languageOverride;

  // One switch moves the whole app: the chrome and the Sarvam nudge read the
  // same value, so the UI can never sit in English around a Tamil offer.
  const language = languageOverride ?? personOrDefault(state.userId).preferredLanguage;
  const t = useMemo(() => translator(language), [language]);
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
      language,
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
  }, [needsCopy, decision, amount, merchantId, language]);

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
      selectMerchant: (id, amount, intentRef) => {
        const target = getMerchant(id);
        if (!target) return;
        // A scanned QR can carry its own amount; otherwise use the merchant's.
        dispatch({
          type: 'selectMerchant',
          merchantId: id,
          amount: amount && amount > 0 ? Math.round(amount) : target.suggestedAmount,
          intentRef,
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
      toggleExplain: (on) => dispatch({ type: 'toggleExplain', on }),
      language,
      t,

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
          intentRef: state.intentRef ?? undefined,
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
          intentRef: state.intentRef ?? undefined,
          at: payment.at!,
        });
      },

      simulateHistory: (entry) => dispatch({ type: 'recordOutcome', userId: state.userId, entry }),
      clearHistory: () => {
        dispatch({ type: 'clearHistory', userId: state.userId });
        resetUserCredit(state.userId);
      },
    };
  }, [state, history, recordOutcome, language, t]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useApp(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useApp must be used inside <AppStateProvider>');
  return store;
}
