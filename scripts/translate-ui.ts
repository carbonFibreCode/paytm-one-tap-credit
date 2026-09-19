/**
 * Translate the UI catalogue with Sarvam Translate.
 *
 *   npm run i18n:generate
 *
 * Run this when a string in `lib/i18n/messages.ts` changes. It writes
 * `lib/i18n/catalogs.generated.ts`, which is committed — the app never
 * translates at runtime, so a cold start, a rate limit or an outage can never
 * leave a screen half-English.
 *
 * Existing translations are kept unless --force is passed, so a hand-corrected
 * line survives the next run. Machine output is a starting point on terse UI
 * fragments: "Short by {0}" came back as "{0} द्वारा छोटा" ("small by"), which
 * is why the file it writes is meant to be read.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { en, type MessageKey } from '../lib/i18n/messages';

const KEY = process.env.SARVAM_API_KEY;
if (!KEY) throw new Error('SARVAM_API_KEY is not set — run with node --env-file=.env.local');

const FORCE = process.argv.includes('--force');
// fileURLToPath, not .pathname — the repo path contains a space, which
// .pathname hands back percent-encoded and fs cannot open.
const OUT = fileURLToPath(new URL('../lib/i18n/catalogs.generated.ts', import.meta.url));

const TARGETS = { hi: 'hi-IN', ta: 'ta-IN', bn: 'bn-IN' } as const;
type Target = keyof typeof TARGETS;

/** Acronyms and marks that are written the same way in every Indian language. */
const VERBATIM = new Set<MessageKey>([
  'checkout.upi',
  'success.upi',
  'home.billDth',
  'home.billFastag',
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Paced and retried: a burst of ~300 short requests trips the rate limit. */
async function translate(input: string, target: Target, attempt = 0): Promise<string> {
  const response = await fetch('https://api.sarvam.ai/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-subscription-key': KEY! },
    body: JSON.stringify({
      input,
      source_language_code: 'en-IN',
      target_language_code: TARGETS[target],
      model: 'sarvam-translate:v1',
    }),
  });
  const payload = await response.json();

  if (response.status === 429 || /rate limit/i.test(payload?.error?.message ?? '')) {
    if (attempt >= 5) throw new Error('rate limited after 5 retries');
    await sleep(2_000 * 2 ** attempt);
    return translate(input, target, attempt + 1);
  }

  if (!response.ok) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  const text: unknown = payload?.translated_text;
  if (typeof text !== 'string' || text.trim() === '') throw new Error('empty translation');
  await sleep(350);
  // A UI string is always one line; the model sometimes returns two.
  return text.replace(/\s+/g, ' ').trim();
}

/** Every {0}, {1} in the source must survive, or interpolation breaks silently. */
function placeholdersSurvive(source: string, translated: string): boolean {
  const wanted = source.match(/\{\d\}/g) ?? [];
  return wanted.every((token) => translated.includes(token));
}

function readExisting(): Partial<Record<Target, Record<string, string>>> {
  if (FORCE || !existsSync(OUT)) return {};
  const source = readFileSync(OUT, 'utf8');
  const out: Partial<Record<Target, Record<string, string>>> = {};
  for (const target of Object.keys(TARGETS) as Target[]) {
    const block = source.match(
      new RegExp(`export const ${target}: Catalog = \\{([\\s\\S]*?)\\n\\};`),
    );
    if (!block) continue;
    const entries: Record<string, string> = {};
    for (const line of block[1].matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)',$/gm)) {
      entries[line[1]] = line[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    }
    out[target] = entries;
  }
  return out;
}

const quote = (value: string) =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

async function main(): Promise<void> {
  const existing = readExisting();
  const keys = Object.keys(en) as MessageKey[];
  const catalogs: Record<Target, Record<string, string>> = { hi: {}, ta: {}, bn: {} };
  let called = 0;
  let kept = 0;
  const warnings: string[] = [];

  for (const target of Object.keys(TARGETS) as Target[]) {
    for (const key of keys) {
      const source = en[key];

      if (VERBATIM.has(key)) {
        catalogs[target][key] = source;
        continue;
      }

      const previous = existing[target]?.[key];
      if (previous && previous !== source) {
        catalogs[target][key] = previous;
        kept++;
        continue;
      }

      try {
        const translated = await translate(source, target);
        called++;
        if (!placeholdersSurvive(source, translated)) {
          warnings.push(`${target} ${key}: placeholder lost, kept English`);
          catalogs[target][key] = source;
        } else {
          catalogs[target][key] = translated;
        }
      } catch (error) {
        warnings.push(`${target} ${key}: ${error instanceof Error ? error.message : error}`);
        catalogs[target][key] = source;
      }
    }
    console.log(`  ${target} done`);
  }

  const block = (target: Target) =>
    [
      `export const ${target}: Catalog = {`,
      ...keys.map((key) => `  ${quote(key)}: ${quote(catalogs[target][key])},`),
      '};',
    ].join('\n');

  writeFileSync(
    OUT,
    [
      '/**',
      ' * Generated by `npm run i18n:generate` — Sarvam Translate, then reviewed by hand.',
      ' *',
      ' * Committed on purpose: the app never translates at runtime, so no screen can',
      ' * arrive half-English because of a cold start or a rate limit. Edit a line here',
      ' * freely; a re-run keeps whatever is already written unless you pass --force.',
      ' */',
      '',
      "import type { Catalog } from './messages';",
      '',
      (['hi', 'ta', 'bn'] as const).map(block).join('\n\n'),
      '',
    ].join('\n'),
    'utf8',
  );

  console.log(`\n  ${called} translated, ${kept} kept, ${keys.length * 3} total`);
  if (warnings.length) {
    console.log('\n  warnings:');
    for (const warning of warnings) console.log(`    ${warning}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
