// @vitest-environment jsdom

/**
 * Render tests for the shared UI primitives and the decision trail.
 *
 * The engine has 570 tests and the screens had none, so a refactor of the
 * components could only be checked by eye. These cover the pieces that carry
 * meaning rather than styling: a bar that must reflect points out of max, a
 * chip that must announce its state, and the audit trail that has to render
 * both an offer and a refusal.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Bar, Chip, PaytmWordmark, Skeleton } from '../components/ui';
import { DecisionTrace } from '../components/DecisionTrace';
import { decide } from '../lib/engine/decide';
import { buildProfile } from '../lib/profile/build';
import { getPersona } from '../lib/fixtures/personas';
import { getMerchant } from '../lib/fixtures/merchants';
import type { Decision } from '../lib/types';

afterEach(cleanup);

const NOW = '2026-09-19T14:30:00+05:30';

function decisionFor(userId: string, merchantId: string, amount: number): Decision {
  const merchant = getMerchant(merchantId)!;
  return decide({
    request: {
      transactionId: 't',
      userId,
      amount,
      merchantId,
      merchantName: merchant.name,
      merchantCategory: merchant.category,
      timestamp: NOW,
      nudgeHistory: [],
    },
    profile: buildProfile(getPersona(userId)!, NOW),
    merchantCreditEnabled: merchant.creditEnabled,
  });
}

/** The filled portion is the only element carrying an inline width. */
function fillWidth(container: HTMLElement): string {
  return (container.querySelector('[style*="width"]') as HTMLElement).style.width;
}

describe('Bar', () => {
  test('width is the value as a percentage of max', () => {
    expect(fillWidth(render(<Bar value={15} max={20} />).container)).toBe('75%');
  });

  test('clamps out-of-range values instead of overflowing the track', () => {
    expect(fillWidth(render(<Bar value={40} max={20} />).container)).toBe('100%');
    cleanup();
    expect(fillWidth(render(<Bar value={-5} max={20} />).container)).toBe('0%');
  });

  test('a zero max does not produce NaN', () => {
    expect(fillWidth(render(<Bar value={3} max={0} />).container)).toBe('0%');
  });

  test('the warn tone is what the shortfall block uses', () => {
    const { container } = render(<Bar value={1} max={2} tone="warn" />);
    expect(container.querySelector('.bg-warn')).not.toBeNull();
  });
});

describe('Chip', () => {
  test('announces its selected state to assistive tech', () => {
    render(
      <>
        <Chip active onClick={() => {}}>
          On
        </Chip>
        <Chip active={false} onClick={() => {}}>
          Off
        </Chip>
      </>,
    );
    expect(screen.getByRole('button', { name: 'On' })).toHaveProperty('ariaPressed', 'true');
    expect(screen.getByRole('button', { name: 'Off' })).toHaveProperty('ariaPressed', 'false');
  });

  test('a disabled chip cannot be pressed', () => {
    render(
      <Chip active={false} disabled onClick={() => {}}>
        n8n
      </Chip>,
    );
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Skeleton', () => {
  test('renders the requested number of shimmer rows and marks itself busy', () => {
    const { container } = render(<Skeleton rows={4} />);
    expect(container.querySelectorAll('.shimmer')).toHaveLength(4);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe('PaytmWordmark', () => {
  test('is labelled, since it is drawn rather than written', () => {
    render(<PaytmWordmark />);
    expect(screen.getByLabelText('Paytm')).not.toBeNull();
  });
});

describe('DecisionTrace', () => {
  test('an offer renders every gate it checked, all passed', () => {
    const decision = decisionFor('u_rohit', 'm_kroma', 50_000);
    expect(decision.showNudge).toBe(true);
    render(<DecisionTrace decision={decision} />);

    expect(screen.getByText(`All ${decision.trace.gates.length} checks passed`)).not.toBeNull();
    expect(screen.getByRole('button', { name: `Checks (${decision.trace.gates.length})` })).not.toBeNull();
    // The product rationale is the sentence a judge reads aloud.
    expect(screen.getByText(/Why this product:/)).not.toBeNull();
  });

  test('a refusal names the gate that blocked it', () => {
    const decision = decisionFor('u_priya', 'm_kroma', 50_000);
    expect(decision.blockedBy).toBe('AFFORDABILITY');
    render(<DecisionTrace decision={decision} />);
    expect(screen.getByText('Blocked by Affordability')).not.toBeNull();
  });

  test('every gate the engine ran is listed with its explanation', () => {
    const decision = decisionFor('u_rohit', 'm_kroma', 50_000);
    const { container } = render(<DecisionTrace decision={decision} />);

    // The checks tab is the default, and each gate contributes its sentence.
    for (const gate of decision.trace.gates) {
      expect(within(container).getByText(gate.detail)).toBeTruthy();
    }
    // All three tabs are reachable.
    expect(screen.getByRole('button', { name: `Relevance ${decision.score}` })).not.toBeNull();
    expect(screen.getByRole('button', { name: `Signal ${decision.eligibilitySignal}` })).not.toBeNull();
  });
});
