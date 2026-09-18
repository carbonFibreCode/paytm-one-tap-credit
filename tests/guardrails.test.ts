/**
 * The three pure functions that stand between a third party and a credit
 * decision, none of which had tests.
 *
 *   validateNudgeText     refuses copy that states a figure the engine did not
 *   extractOutcomes       parses our own records back out of a graph response
 *   detectSalary / detectRecurringObligations
 *                         turn raw rows into the signals the gates run on
 */

import { describe, expect, test } from 'vitest';
import { extractNumbers, normaliseDigits, validateNudgeText } from '../lib/integrations/sarvam';
import { extractOutcomes } from '../lib/integrations/cognee';
import { detectRecurringObligations, detectSalary } from '../lib/profile/features';
import type { NudgeContext } from '../lib/nudge/templates';
import type { LedgerEntry } from '../lib/types';

// ---------------------------------------------------------------------------
// Sarvam output validation — a model must not be able to invent terms
// ---------------------------------------------------------------------------

const context: NudgeContext = {
  product: 'postpaid',
  partner: 'Paytm Postpaid',
  amount: 50_000,
  merchantName: 'Kroma Electronics',
  merchantCategory: 'electronics',
  months: 3,
  emi: 16_667,
  noCost: true,
  language: 'en',
};

describe('nudge copy validation', () => {
  test('accepts copy that states only the figures it was given', () => {
    expect(validateNudgeText('Pay ₹50,000 as 3 instalments of ₹16,667.', context).ok).toBe(true);
  });

  test.each([
    ['', 'empty response'],
    ['   ', 'empty response'],
    ['Line one\nLine two with ₹50,000', 'more than one line'],
    ['Spread the cost over a few months.', 'does not state the transaction amount'],
  ])('rejects %j', (text, reason) => {
    const result = validateNudgeText(text, context);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(reason);
  });

  test('rejects copy longer than a one-liner', () => {
    const result = validateNudgeText(`₹50,000. ${'very long '.repeat(30)}`, context);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('too long');
  });

  test('rejects an interest rate the engine never supplied', () => {
    const result = validateNudgeText('₹50,000 over 3 months at just 12% interest!', context);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('invented figures');
    expect(result.reason).toContain('12');
  });

  test('rejects an invented credit limit even when every real figure is present', () => {
    const result = validateNudgeText(
      '₹50,000 in 3 EMIs of ₹16,667 — your ₹200000 limit is ready.',
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('200000');
  });

  test('a no-cost plan may say zero interest; an interest-bearing one may not', () => {
    expect(validateNudgeText('₹50,000 in 3 EMIs of ₹16,667, 0 interest.', context).ok).toBe(true);
    expect(
      validateNudgeText('₹50,000 in 3 EMIs of ₹16,667, 0 interest.', { ...context, noCost: false })
        .ok,
    ).toBe(false);
  });

  test('validates copy written in Devanagari numerals', () => {
    // ५०,००० = 50,000 and १६,६६७ = 16,667 — the same figures, another script.
    const hindi = '₹५०,००० को ३ किस्तों में — हर महीने ₹१६,६६७।';
    expect(validateNudgeText(hindi, { ...context, language: 'hi' }).ok).toBe(true);
  });

  test('an invented figure is caught in Devanagari too', () => {
    const hindi = '₹५०,००० को ३ किस्तों में ₹१६,६६७ — केवल १२% ब्याज।';
    expect(validateNudgeText(hindi, { ...context, language: 'hi' }).ok).toBe(false);
  });

  test('digit normalisation covers Devanagari, Bengali and Tamil', () => {
    expect(normaliseDigits('५०')).toBe('50');
    expect(normaliseDigits('৫০')).toBe('50');
    expect(normaliseDigits('௫௦')).toBe('50');
  });

  test('numbers are read without their grouping commas', () => {
    expect(extractNumbers('₹50,000 over 3 months at ₹16,667')).toEqual([50_000, 3, 16_667]);
  });
});

// ---------------------------------------------------------------------------
// Cognee — parsing our own records back out of a search response
// ---------------------------------------------------------------------------

const outcome = (transactionId: string, outcomeValue: string) =>
  `User u_rohit ${outcomeValue} a postpaid offer on 2026-09-19. ${JSON.stringify({
    kind: 'nudge-outcome',
    userId: 'u_rohit',
    transactionId,
    product: 'postpaid',
    merchantCategory: 'electronics',
    outcome: outcomeValue,
    at: '2026-09-19T10:00:00.000Z',
  })}`;

describe('recalling outcomes from a graph response', () => {
  test('finds records however deeply the response nests them', () => {
    const found = extractOutcomes({
      results: [{ chunks: [{ text: outcome('txn_1', 'declined') }] }],
    });
    expect(found).toHaveLength(1);
    expect(found[0].outcome).toBe('declined');
    expect(found[0].userId).toBe('u_rohit');
  });

  test('the same statement returned as overlapping chunks counts once', () => {
    const text = outcome('txn_1', 'accepted');
    const found = extractOutcomes([{ text }, { text }, { nested: { deeper: [{ text }] } }]);
    expect(found).toHaveLength(1);
  });

  test('distinct transactions are kept apart', () => {
    const found = extractOutcomes([
      { text: outcome('txn_1', 'accepted') },
      { text: outcome('txn_2', 'declined') },
    ]);
    expect(found).toHaveLength(2);
  });

  test('ignores prose, unrelated JSON and truncated chunks', () => {
    const found = extractOutcomes({
      results: [
        { text: 'The user seems to like instalments.' },
        { text: JSON.stringify({ kind: 'something-else', userId: 'u_rohit' }) },
        { text: '{"kind":"nudge-outcome","userId":"u_ro' },
      ],
    });
    expect(found).toHaveLength(0);
  });

  test('a malformed response yields nothing rather than throwing', () => {
    for (const payload of [null, undefined, 42, 'plain text', [], {}]) {
      expect(() => extractOutcomes(payload)).not.toThrow();
      expect(extractOutcomes(payload)).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Feature detection — the "warm information" claim
// ---------------------------------------------------------------------------

let rowId = 0;
function row(
  date: string,
  amount: number,
  merchant: string,
  direction: 'credit' | 'debit' = 'debit',
): LedgerEntry {
  return {
    id: `e_${rowId++}`,
    date,
    direction,
    amount,
    category: direction === 'credit' ? 'salary' : 'emi',
    merchant,
    instrument: 'netbanking',
  };
}

describe('detecting income', () => {
  test('three months of similar credits read as a salary', () => {
    const { avgMonthlyInflow, inflowRegularity } = detectSalary([
      row('2026-07-01', 90_000, 'Salary Credit', 'credit'),
      row('2026-08-01', 90_000, 'Salary Credit', 'credit'),
      row('2026-09-01', 90_000, 'Salary Credit', 'credit'),
    ]);
    expect(avgMonthlyInflow).toBe(90_000);
    // Same day every month is as predictable as it gets.
    expect(inflowRegularity).toBe(1);
  });

  test('two months is not enough repetition to call it income', () => {
    const { avgMonthlyInflow } = detectSalary([
      row('2026-08-01', 90_000, 'Salary Credit', 'credit'),
      row('2026-09-01', 90_000, 'Salary Credit', 'credit'),
    ]);
    expect(avgMonthlyInflow).toBe(0);
  });

  test('a drifting payday lowers regularity without hiding the income', () => {
    const { avgMonthlyInflow, inflowRegularity } = detectSalary([
      row('2026-07-03', 60_000, 'Client Payout', 'credit'),
      row('2026-08-19', 60_000, 'Client Payout', 'credit'),
      row('2026-09-27', 60_000, 'Client Payout', 'credit'),
    ]);
    expect(avgMonthlyInflow).toBe(60_000);
    expect(inflowRegularity).toBeLessThan(0.3);
  });

  test('no credits at all is not an error', () => {
    expect(detectSalary([]).avgMonthlyInflow).toBe(0);
    expect(detectSalary([row('2026-09-01', 500, 'Chai')]).avgMonthlyInflow).toBe(0);
  });
});

describe('detecting recurring obligations', () => {
  test('the same merchant and amount across three months is recurring', () => {
    const found = detectRecurringObligations([
      row('2026-07-07', 4_500, 'Bajaj Finserv EMI'),
      row('2026-08-07', 4_500, 'Bajaj Finserv EMI'),
      row('2026-09-07', 4_500, 'Bajaj Finserv EMI'),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      merchant: 'Bajaj Finserv EMI',
      amount: 4_500,
      occurrences: 3,
    });
  });

  test('two months is not yet a commitment', () => {
    expect(
      detectRecurringObligations([
        row('2026-08-07', 4_500, 'Bajaj Finserv EMI'),
        row('2026-09-07', 4_500, 'Bajaj Finserv EMI'),
      ]),
    ).toHaveLength(0);
  });

  test('a varying amount at the same merchant is not a fixed obligation', () => {
    expect(
      detectRecurringObligations([
        row('2026-07-07', 4_500, 'BigBasket'),
        row('2026-08-07', 3_200, 'BigBasket'),
        row('2026-09-07', 5_100, 'BigBasket'),
      ]),
    ).toHaveLength(0);
  });

  test('three charges inside one month are not three months of history', () => {
    expect(
      detectRecurringObligations([
        row('2026-09-01', 4_500, 'Bajaj Finserv EMI'),
        row('2026-09-11', 4_500, 'Bajaj Finserv EMI'),
        row('2026-09-21', 4_500, 'Bajaj Finserv EMI'),
      ]),
    ).toHaveLength(0);
  });

  test('credits are never obligations, however regular', () => {
    expect(
      detectRecurringObligations([
        row('2026-07-01', 90_000, 'Salary Credit', 'credit'),
        row('2026-08-01', 90_000, 'Salary Credit', 'credit'),
        row('2026-09-01', 90_000, 'Salary Credit', 'credit'),
      ]),
    ).toHaveLength(0);
  });

  test('obligations come back largest first, which is the order they are shown', () => {
    const months = ['2026-07', '2026-08', '2026-09'];
    const found = detectRecurringObligations([
      ...months.map((m) => row(`${m}-07`, 4_500, 'Bajaj Finserv EMI')),
      ...months.map((m) => row(`${m}-05`, 22_000, 'House Rent')),
      ...months.map((m) => row(`${m}-09`, 18_500, 'HDFC Auto Loan')),
    ]);
    expect(found.map((o) => o.amount)).toEqual([22_000, 18_500, 4_500]);
  });
});
