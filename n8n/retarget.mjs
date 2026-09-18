#!/usr/bin/env node
/**
 * Point the workflows at a deployed app instead of localhost.
 *
 *   node n8n/retarget.mjs https://one-tap-credit.vercel.app
 *
 * Writes a cloud-ready copy of every workflow into `n8n/cloud/`, which you
 * import into n8n Cloud. The originals keep pointing at localhost so the
 * offline demo still works.
 *
 * Done as a build step rather than with n8n Variables on purpose: `$vars` is a
 * paid n8n Cloud feature, and a demo should not depend on a billing tier.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];

if (!target || !/^https?:\/\//.test(target)) {
  console.error('Usage: node n8n/retarget.mjs https://your-app.vercel.app');
  process.exit(1);
}

const base = target.replace(/\/+$/, '');
// fileURLToPath, not URL.pathname — the project path contains a space, which
// pathname would hand back percent-encoded.
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'cloud');

await mkdir(outDir, { recursive: true });

const files = (await readdir(here)).filter((name) => /^\d\d-.*\.json$/.test(name));
let rewritten = 0;

for (const name of files) {
  const source = await readFile(path.join(here, name), 'utf8');
  const updated = source.replaceAll('http://localhost:3111', base);
  const changes = source.split('http://localhost:3111').length - 1;

  await writeFile(path.join(outDir, name), updated, 'utf8');
  console.log(`  ${name.padEnd(28)} ${changes} URL${changes === 1 ? '' : 's'} → ${base}`);
  rewritten += changes;
}

console.log(`\nWrote ${files.length} workflows to n8n/cloud/ (${rewritten} URLs retargeted).`);
console.log('Import those into n8n Cloud, then set NEXT_PUBLIC_N8N_WEBHOOK_URL');
console.log('and NEXT_PUBLIC_N8N_OUTCOME_WEBHOOK_URL in Vercel to the production webhook URLs.');
