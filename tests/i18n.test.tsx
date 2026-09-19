// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { translator } from '../lib/i18n';
import { en } from '../lib/i18n/messages';
import { hi, ta, bn } from '../lib/i18n/catalogs.generated';

afterEach(cleanup);

describe('translation catalogues', () => {
  const keys = Object.keys(en) as Array<keyof typeof en>;

  test('every language covers every key', () => {
    for (const [name, catalog] of [
      ['hi', hi],
      ['ta', ta],
      ['bn', bn],
    ] as const) {
      const missing = keys.filter((key) => !catalog[key]?.trim());
      expect(`${name}: ${missing.join(', ')}`).toBe(`${name}: `);
    }
  });

  test('placeholders survive translation in every language', () => {
    for (const [name, catalog] of [
      ['hi', hi],
      ['ta', ta],
      ['bn', bn],
    ] as const) {
      for (const key of keys) {
        const wanted = (en[key].match(/\{\d\}/g) ?? []).sort();
        const got = (catalog[key].match(/\{\d\}/g) ?? []).sort();
        expect(`${name} ${key}: ${got.join()}`).toBe(`${name} ${key}: ${wanted.join()}`);
      }
    }
  });

  test('no catalogue entry spans more than one line', () => {
    for (const catalog of [en, hi, ta, bn]) {
      for (const key of keys) expect(catalog[key]).not.toContain('\n');
    }
  });

  test('interpolates positionally, and leaves an unsupplied token alone', () => {
    expect(translator('hi')('home.greeting', 'Rohit')).toContain('Rohit');
    expect(translator('en')('approved.planRow', 3, '₹16,667')).toBe('3 months · ₹16,667/mo');
    expect(translator('en')('home.greeting')).toBe('Hi, {0}');
  });

  test('an unknown language falls back to English rather than throwing', () => {
    expect(translator('fr' as never)('nav.home')).toBe('Home');
  });
});

describe('PIN sheet', () => {
  test('six dots fill one per digit, and backspace clears one', async () => {
    const { PinSheet } = await import('../components/PinSheet');
    const { AppStateProvider } = await import('../lib/client/state');
    const { render, screen, fireEvent } = await import('@testing-library/react');
    const authorised = vi.fn();

    render(
      <AppStateProvider>
        <PinSheet
          open
          amount={50_000}
          payee="HDFC Bank"
          onClose={() => {}}
          onAuthorised={authorised}
        />
      </AppStateProvider>,
    );

    // Five digits must not authorise; the sixth must.
    for (const digit of ['1', '2', '3', '4', '5']) {
      fireEvent.click(screen.getByRole('button', { name: digit }));
    }
    expect(authorised).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete last digit' }));
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: '6' }));

    await vi.waitFor(() => expect(authorised).toHaveBeenCalledTimes(1), { timeout: 1_500 });
  });
});
