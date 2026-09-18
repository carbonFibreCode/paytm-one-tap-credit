/**
 * The demo's state transitions.
 *
 * This reducer drives every screen change on stage and had no tests. The cases
 * below are the ones where a wrong transition would be visible in front of a
 * judge: a stale decision surviving an amount change, a reset that only half
 * clears, or a scanned intent that does not reach the engine.
 */

import { describe, expect, test } from 'vitest';
import {
  initialState,
  reducer,
  type Action,
  type PaymentRecord,
  type State,
} from '../lib/client/state-machine';
import type { Decision, NudgeHistoryEntry } from '../lib/types';

/** Enough of a decision to tell "present" from "cleared". */
const decision = { transactionId: 'txn_1', showNudge: true, product: 'postpaid' } as Decision;

function apply(state: State, ...actions: Action[]): State {
  return actions.reduce(reducer, state);
}

/** A state that already has a decision on screen, as checkout would. */
const decided = apply(initialState, {
  type: 'decisionOk',
  decision,
  meta: { servedBy: 'direct', latencyMs: 120 },
});

const payment: PaymentRecord = {
  amount: 50_000,
  merchantName: 'Kroma Electronics',
  merchantId: 'm_kroma',
  method: 'postpaid',
  at: '2026-09-19T10:00:00.000Z',
};

describe('a decision never outlives the transaction it described', () => {
  test.each([
    ['the amount changes', { type: 'setAmount', amount: 60_000 } as Action],
    ['the instrument changes', { type: 'setInstrument', instrument: 'wallet' } as Action],
    [
      'the merchant changes',
      { type: 'selectMerchant', merchantId: 'm_jewels', amount: 80_000 } as Action,
    ],
    ['the user changes', { type: 'setUser', userId: 'u_priya' } as Action],
    ['the orchestration mode changes', { type: 'setMode', mode: 'direct' } as Action],
  ])('it is cleared when %s', (_label, action) => {
    const next = apply(decided, action);
    expect(decided.decision).not.toBeNull();
    expect(next.decision).toBeNull();
    expect(next.decisionMeta).toBeNull();
    expect(next.nudgeCopy).toBeNull();
    expect(next.traceOpen).toBe(false);
  });

  test('a dismissed nudge does not stay dismissed for the next amount', () => {
    const dismissed = apply(decided, { type: 'dismissNudge' });
    expect(dismissed.nudgeDismissed).toBe(true);
    expect(apply(dismissed, { type: 'setAmount', amount: 60_000 }).nudgeDismissed).toBe(false);
  });
});

describe('scanning a QR', () => {
  test('carries the intent reference into checkout', () => {
    const next = apply(initialState, {
      type: 'selectMerchant',
      merchantId: 'm_kroma',
      amount: 50_000,
      intentRef: 'OTCDKROMA0123456789',
    });
    expect(next.intentRef).toBe('OTCDKROMA0123456789');
    expect(next.screen).toBe('checkout');
    expect(next.amount).toBe(50_000);
  });

  test('picking a merchant from a list instead leaves no stale reference', () => {
    const scanned = apply(initialState, {
      type: 'selectMerchant',
      merchantId: 'm_kroma',
      amount: 50_000,
      intentRef: 'OTCDKROMA0123456789',
    });
    const picked = apply(scanned, {
      type: 'selectMerchant',
      merchantId: 'm_jewels',
      amount: 80_000,
    });
    expect(picked.intentRef).toBeNull();
  });
});

describe('payments', () => {
  test("a payment lands in this user's history and shows the success screen", () => {
    const next = apply(initialState, { type: 'pay', payment });
    expect(next.screen).toBe('success');
    expect(next.payment).toEqual(payment);
    expect(next.paymentsByUser[initialState.userId]).toEqual([payment]);
  });

  test('history is per user, not shared', () => {
    const afterRohit = apply(initialState, { type: 'pay', payment });
    const asPriya = apply(afterRohit, { type: 'setUser', userId: 'u_priya' });
    const afterPriya = apply(asPriya, { type: 'pay', payment: { ...payment, amount: 12_000 } });

    expect(afterPriya.paymentsByUser['u_rohit']).toHaveLength(1);
    expect(afterPriya.paymentsByUser['u_priya']).toHaveLength(1);
    expect(afterPriya.paymentsByUser['u_priya'][0].amount).toBe(12_000);
  });
});

describe('nudge history and the demo reset', () => {
  const entry: NudgeHistoryEntry = {
    product: 'postpaid',
    decidedAt: '2026-09-17T10:00:00.000Z',
    outcome: 'declined',
  };

  test('an outcome is recorded against the user who saw it', () => {
    const next = apply(initialState, { type: 'recordOutcome', userId: 'u_rohit', entry });
    expect(next.historyByUser['u_rohit']).toEqual([entry]);
  });

  test('a reset clears both the nudge history and the payments for that user only', () => {
    const busy = apply(
      initialState,
      { type: 'recordOutcome', userId: 'u_rohit', entry },
      { type: 'pay', payment },
      { type: 'setUser', userId: 'u_priya' },
      { type: 'recordOutcome', userId: 'u_priya', entry },
      { type: 'pay', payment },
    );
    const reset = apply(busy, { type: 'clearHistory', userId: 'u_priya' });

    expect(reset.historyByUser['u_priya']).toBeUndefined();
    expect(reset.paymentsByUser['u_priya']).toBeUndefined();
    // The other persona is untouched — resetting one must not wipe the demo.
    expect(reset.historyByUser['u_rohit']).toHaveLength(1);
    expect(reset.paymentsByUser['u_rohit']).toHaveLength(1);
  });
});

describe('navigation', () => {
  test('switching persona from the launch screen goes home, not back to checkout', () => {
    expect(apply(initialState, { type: 'setUser', userId: 'u_priya' }).screen).toBe('home');
  });

  test('switching persona mid-checkout keeps the screen but drops the decision', () => {
    const atCheckout = apply(decided, { type: 'go', screen: 'checkout' });
    const switched = apply(atCheckout, { type: 'setUser', userId: 'u_priya' });
    expect(switched.screen).toBe('checkout');
    expect(switched.decision).toBeNull();
  });

  test('navigating closes every sheet, so none is left open behind a screen', () => {
    const open = apply(
      initialState,
      { type: 'toggleDrawer', open: true },
      { type: 'toggleInfo', open: true },
      { type: 'toggleTrace', open: true },
    );
    const moved = apply(open, { type: 'go', screen: 'home' });
    expect([moved.drawerOpen, moved.infoOpen, moved.traceOpen]).toEqual([false, false, false]);
  });
});

describe('production vs explain view', () => {
  test('opens in production view, so the app looks shipped rather than instrumented', () => {
    expect(initialState.explainMode).toBe(false);
  });

  test('toggles explicitly and flips without an argument', () => {
    expect(apply(initialState, { type: 'toggleExplain', on: true }).explainMode).toBe(true);
    expect(apply(initialState, { type: 'toggleExplain' }).explainMode).toBe(true);
    expect(
      apply(initialState, { type: 'toggleExplain', on: true }, { type: 'toggleExplain' })
        .explainMode,
    ).toBe(false);
  });

  test('survives navigation and a persona switch \u2014 unlike the sheets, it is a mode, not a panel', () => {
    const explaining = apply(initialState, { type: 'toggleExplain', on: true });
    const moved = apply(
      explaining,
      { type: 'go', screen: 'checkout' },
      { type: 'setUser', userId: 'u_aman' },
    );
    expect(moved.explainMode).toBe(true);
  });
});

describe('copy loading', () => {
  test('a nudge decision with no copy yet is marked as loading', () => {
    expect(decided.nudgeCopyLoading).toBe(true);
  });

  test('a decision that arrives with its copy is not', () => {
    const withCopy = apply(initialState, {
      type: 'decisionOk',
      decision,
      meta: { servedBy: 'n8n', latencyMs: 300 },
      copy: { text: 'hi', source: 'sarvam', reason: null, latencyMs: 200 },
    });
    expect(withCopy.nudgeCopyLoading).toBe(false);
    expect(withCopy.nudgeCopy?.source).toBe('sarvam');
  });

  test('a refused decision never waits on copy', () => {
    const refused = apply(initialState, {
      type: 'decisionOk',
      decision: { ...decision, showNudge: false } as Decision,
      meta: { servedBy: 'direct', latencyMs: 90 },
    });
    expect(refused.nudgeCopyLoading).toBe(false);
  });
});
