/**
 * Translation lookup.
 *
 * No i18n library here on purpose. The whole surface is one catalogue of flat
 * keys and positional placeholders, the language already lives in app state
 * rather than in the URL, and next-intl is built around routed locales and
 * server components — wiring it to a client-side state switch would be more
 * moving parts than the thing it replaces, on the night before a demo.
 *
 * A missing key falls back to English rather than rendering the key itself, so
 * the worst failure a viewer can see is an untranslated line, never `nav.home`.
 */

import type { Language } from '../types';
import { en, type Catalog, type MessageKey } from './messages';
import { hi, ta, bn } from './catalogs.generated';

const CATALOGS: Record<Language, Catalog> = { en, hi, ta, bn };

export type Translate = (key: MessageKey, ...values: Array<string | number>) => string;

export function translator(language: Language): Translate {
  const catalog = CATALOGS[language] ?? en;
  return (key, ...values) => {
    const template = catalog[key] || en[key];
    return values.length === 0
      ? template
      : template.replace(/\{(\d)\}/g, (match, index: string) => {
          const value = values[Number(index)];
          return value === undefined ? match : String(value);
        });
  };
}

export type { MessageKey };
