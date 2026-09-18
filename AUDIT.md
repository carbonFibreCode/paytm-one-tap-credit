# Code audit — One-Tap Credit

**Date:** 18 Sep 2026 · **Commit:** `ee4effc` · **Scope:** every file under `app/`, `lib/`, `components/`, `tests/`, `n8n/`, `scripts/`, `drizzle/` and the config at the root. ~9,000 lines of TypeScript read in full, not sampled.

**Verdict in one line:** the architecture is sound and the engine is genuinely well built; the debt is almost entirely in the _seams_ — hand-rolled boilerplate where a library or one shared helper belongs, and a near-total absence of logging. One correctness regression (P0) must be fixed before the demo.

---

## 1. Scorecard

| Dimension               | Grade  | One line                                                                                                                                                                                                 |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture / LLD      | **A−** | Pure engine, explicit inputs, gates-as-data, fallbacks everywhere. The one crack: the n8n `offer` stage is a second implementation that has drifted from the engine (§3.1).                              |
| SOLID                   | **B+** | Open/closed is real (add a gate = add an object). SRP breaks in `state.tsx` (601 lines, five jobs) and in `decide.ts` (decision + 120 lines of English prose).                                           |
| DRY                     | **C+** | Seven copies of `rupees()`, three of `clamp()`, twelve copies of the JSON-body boilerplate, four hand-rolled `AbortController` timeouts, three Zod definitions of the same 12 categories.                |
| Library use             | **B−** | Right choices where libraries exist (Drizzle, Zod, date-fns, qrcode). Missing where they'd delete code: env validation, state persistence, data fetching, structured logging, timestamp mode in Drizzle. |
| Logging & observability | **D**  | Four `console.warn` calls in 9,000 lines. No request id. Cognee failures, n8n fallbacks and Sarvam rejections are invisible in production logs.                                                          |
| Error handling          | **B**  | Consistent _posture_ (never fail a payment) but inconsistent _shape_: three different error envelopes and three different codes for "database not configured".                                           |
| Folder structure        | **B**  | Sensible, with two naming collisions (`lib/audit/db.ts` next to `lib/db/`; "memory" holding both profile derivation and an external client) and fixtures living at the `lib/` root.                      |
| Tests                   | **B**  | 89 tests, all unit, all on the right things (invariants, gates, money). Zero HTTP/route tests, zero DB tests, no coverage tooling, pure validators (`validateNudgeText`, `extractOutcomes`) untested.    |
| Tooling / CI            | **D**  | No CI. Push to `main` deploys with no typecheck, lint or test gate. No Prettier. Two pre-existing lint errors ride along.                                                                                |
| Docs & comments         | **A**  | Every module has a header explaining _why_. HANDOFF/SETUP are excellent. One stale comment now describes a bug (§3.1).                                                                                   |

---

## 2. Priorities

### P0 — before the demo

| #   | Finding                                                                                                                                                                                                                                                                                                                                                    | Where                                            | Fix                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Staged offer path and direct path now disagree.** Phase 1 fixed the "offer a plan above assessed capacity" bug in `decide.ts` but the n8n `offer` stage still carries the old fallback. Via n8n, a user near capacity is offered a Postpaid instalment the gate just said they cannot afford. `lib/api/steps.ts` line 10 promises this can never happen. | `app/api/engine/offer/route.ts:50-63`            | Extract `buildOffer()` into `lib/engine/offer.ts`; call it from both `decide.ts` and the route. One implementation.                    |
| 2   | **No error boundary.** An uncaught render error white-screens the phone mid-presentation.                                                                                                                                                                                                                                                                  | `app/` (missing `error.tsx`, `global-error.tsx`) | Add both; the boundary shows a "reload" card in the phone frame.                                                                       |
| 3   | **Deploy is ungated.** `git push` → production with no typecheck/lint/test run.                                                                                                                                                                                                                                                                            | `.github/` (missing)                             | One GitHub Actions workflow: `npm ci && npm run typecheck && npm run lint && npm test`. Vercel already waits for checks if configured. |

### P1 — next working session

| #   | Finding                                                                                       | Fix                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | No structured logging; failures swallowed silently (§4.1)                                     | `pino` + a `lib/log.ts` that stamps `requestId` from Vercel's `x-vercel-id`. Log every fallback (n8n→direct, Sarvam→template, Cognee miss, DB→file). |
| 5   | Route boilerplate ×12 (§4.2)                                                                  | `lib/api/route.ts`: `jsonRoute(schema, handler)` — parses body, runs Zod, unifies the error envelope. Deletes ~150 lines.                            |
| 6   | Three sources of truth for every enum (§4.3)                                                  | `lib/domain.ts`: `as const` arrays → Zod enums → TS types via `z.infer`. Types cannot drift from validators.                                         |
| 7   | `state.tsx` is 601 lines with two `eslint-disable` (§4.6)                                     | `zustand` + `persist` middleware replaces the reducer, the localStorage effects and the version-key dance.                                           |
| 8   | `process.env` read raw in 5 modules, no validation, dev-secret fallback for QR signing (§4.7) | `@t3-oss/env-nextjs` (or one Zod schema in `lib/env.ts`). Fails at boot if `QR_SIGNING_SECRET` is missing in production.                             |
| 9   | Timestamps hand-normalised in one store, raw in the others (§4.8)                             | Drizzle `timestamp({ mode: 'date' })` on every column; delete `normaliseIntent()`.                                                                   |

### P2 — hygiene

10. Shared UI primitives (`Section`, `Stat`, `Skeleton`, `Bar`, `Chip`) — 9 duplicate definitions across 6 files (§4.5).
11. `rupees()` ×7, `clamp()` ×3, `round()` ×3, QR render options ×3, `AbortController` timeout ×4 (§4.4).
12. Persona fixtures repeat the credit record twice per persona (§5, `lib/personas.ts`).
13. Prose in `decide.ts` hardcodes thresholds that exist as constants (§5).
14. Unauthenticated `DELETE /api/payments` and `POST /api/intents` (§4.9).
15. Test gaps (§6). Prettier. Unused `@neon/env` dependency.

---

## 3. What is good (and should be protected)

This matters as much as the debt, because the refactors below must not erode it.

- **`lib/engine/decide.ts` is a pure function.** No clock, no DB, no env. Every Phase 0–2 change kept it that way by passing `LiveCredit` through `buildProfile()` as an input — the same pattern as `nudgeHistory`. Keep this rule absolute.
- **Gates are data** (`lib/engine/gates.ts`). Adding a rule is adding an object to an array; ordering is explicit; every gate returns the sentence that explains it. This is open/closed done properly.
- **Fallback posture is uniform.** n8n → direct (3s), Cognee → local trail, Sarvam → template, DB → file, scanner verify → local parse. Every external dependency degrades to the pre-dependency behaviour.
- **Money is integer rupees everywhere**, and the no-cost EMI rounding invariant is tested from both ends (`buildSchedule` sums to `total`; store refuses a schedule that does not).
- **Tests test invariants, not implementation** — "no offered instalment ever exceeds capacity across 18 combinations" is the right kind of test.
- **Module headers explain _why_.** `lib/audit/store.ts`, `lib/memory/cognee.ts`, `lib/nudge/sarvam.ts` read like design notes. Keep the standard.

---

## 4. Cross-cutting findings

### 4.1 Logging — the largest gap

**Evidence.** `grep console\.` across `lib app components` → 4 hits, all `console.warn`: `lib/audit/store.ts:80,102`, `lib/credit/store.ts:189`, `lib/intents/sign.ts:26`. Everything else is either returned to the caller as a field (`reason`, `fallbackReason`, `via`) or swallowed:

| Swallowed silently                                                    | File                                                   | Operationally meaningful?                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Cognee search failure                                                 | `lib/memory/cognee.ts:184` (`refreshFromCognee` catch) | **Yes** — memory stops refreshing and nobody knows                                               |
| n8n timeout / fallback to direct                                      | `lib/client/api.ts:120-127`                            | **Yes** — surfaced only in the demo drawer                                                       |
| Sarvam rejection reason                                               | `lib/nudge/sarvam.ts:239-260`                          | **Yes** — returned in `reason`, never logged                                                     |
| Route 4xx/5xx responses                                               | every `app/api/**/route.ts`                            | Yes — no server-side trace of a bad request                                                      |
| `reportOutcome`/`reportPayment`/`attachIntentDecision` fetch failures | `lib/client/api.ts`                                    | Client-side; acceptable, but a `navigator.sendBeacon` would be the library answer to `keepalive` |
| localStorage read/write                                               | `lib/client/state.tsx`                                 | Correctly silent                                                                                 |
| One failed camera frame                                               | `components/screens/ScannerScreen.tsx`                 | Correctly silent                                                                                 |

**No correlation id.** A decision served via n8n touches five routes; nothing ties their logs together. Vercel sets `x-vercel-id` on every request — read it once in a helper and stamp every log line.

**Recommendation.** `pino` (works in Vercel's Node runtime; `pino-pretty` in dev). One module:

```ts
// lib/log.ts
export const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
export const requestLog = (request: Request) =>
  log.child({ requestId: request.headers.get('x-vercel-id') ?? crypto.randomUUID() });
```

Then log at every fallback boundary with a stable event name: `decision.served`, `n8n.fallback`, `sarvam.rejected`, `cognee.refresh_failed`, `audit.db_write_failed`, `intent.refused`. Six events would cover 90% of what you would want to see after a bad demo run.

### 4.2 Route boilerplate — twelve copies

Every route in `app/api/` begins with the same nine lines:

```ts
let payload: unknown;
try {
  payload = await request.json();
} catch {
  return NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 });
}
const parsed = body.safeParse(payload);
if (!parsed.success) return NextResponse.json(badRequest(parsed.error), { status: 400 });
```

Files: `audit`, `decide`, `nudge-text`, `payments`, `intents`, `intents/[ref]` (×2 methods), `engine/{profile,gates,score,offer}`, `memory/{recall,remember}`. Twelve. Plus three different "first Zod issue → message" implementations: `firstIssue()` in `lib/api/validate.ts:90`, `badRequest()` in `lib/api/steps.ts:68`, inline in `app/api/audit/route.ts:47-52`.

**Recommendation.** One higher-order helper:

```ts
// lib/api/route.ts
export const jsonRoute =
  <T>(schema: z.ZodType<T>, handler: (input: T, ctx) => Promise<Response>) =>
  async (request: Request, ctx) => {
    /* parse, validate, envelope, log, catch */
  };
```

Routes become three lines each. The error envelope becomes one shape (see 4.10).

### 4.3 Three sources of truth for every enum

| Enum                          | TS type                              | Zod #1                                        | Zod #2                                 | Zod #3                                             |
| ----------------------------- | ------------------------------------ | --------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| Merchant category (12 values) | `lib/types.ts:9`                     | `lib/api/validate.ts:20` (`CATEGORIES`)       | `lib/api/steps.ts:16` (`categoryEnum`) | —                                                  |
| Product id                    | `lib/types.ts:29`                    | `validate.ts:45`                              | `steps.ts:47`                          | `engine/offer/route.ts:17`, `payments/route.ts`    |
| Outcome                       | `lib/types.ts:168`                   | `validate.ts:47`                              | `steps.ts:49`                          | `audit/route.ts:29`, `memory/remember/route.ts:17` |
| Instrument                    | `lib/types.ts:33`                    | `validate.ts:24`                              | `engine/gates/route.ts:24`             | —                                                  |
| Language                      | `lib/types.ts:31`                    | `validate.ts:23`                              | (`LANGUAGE_NAMES` keys in templates)   | —                                                  |
| `rupees` (amount)             | —                                    | `validate.ts:32`                              | `steps.ts:22`                          | —                                                  |
| `MemoryContext`               | `lib/engine/score.ts:52` (interface) | `steps.ts:64` (`z.infer`, same exported name) | —                                      | —                                                  |

Add a value to `MerchantCategory` and two validators silently reject it.

**Recommendation.** `lib/domain.ts` owns the `as const` arrays; Zod enums and TS types derive from them:

```ts
export const MERCHANT_CATEGORIES = ['electronics', …] as const;
export type MerchantCategory = (typeof MERCHANT_CATEGORIES)[number];
export const merchantCategory = z.enum(MERCHANT_CATEGORIES);
```

`lib/api/validate.ts` and `lib/api/steps.ts` then merge into one `lib/api/schemas.ts`; the `Validated<T>` union and the `badRequest()` style become one style.

### 4.4 Small helpers copied instead of imported

| Helper                                                                   | Copies | Files                                                                                                                           | Should be                                                                                              |
| ------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `rupees(n)` → `₹50,000`                                                  | **7**  | `engine/{gates,score,product,decide}.ts`, `memory/signal.ts`, `nudge/templates.ts` (`formatRupees`), `api/validate.ts`          | `formatINR` in `lib/format.ts` — already exists, produces the identical string via `Intl.NumberFormat` |
| `clamp(v, lo, hi)`                                                       | 3      | `memory/features.ts`, `memory/signal.ts`, `engine/score.ts`                                                                     | `lib/math.ts`                                                                                          |
| `round(v)` (1 dp)                                                        | 3      | `memory/signal.ts`, `engine/score.ts`, `audit/store.ts`                                                                         | `lib/math.ts`                                                                                          |
| "weakest by ratio" reduce                                                | 4      | `engine/decide.ts` (`weakestComponent`, `weakestFactorHint`), `components/DecisionSheet.tsx` (`weakestSignal`, `weakestFactor`) | `lib/engine/explain.ts` `weakestBy(items, num, den)`                                                   |
| `AbortController` + `setTimeout` timeout                                 | 4      | `client/api.ts` ×2, `memory/cognee.ts`, `nudge/sarvam.ts`                                                                       | `AbortSignal.timeout(ms)` — built into Node 18+ and every browser; deletes all four blocks             |
| QR SVG options `{type:'svg', margin:1, errorCorrectionLevel:'M', color}` | 3      | `app/qr/page.tsx`, `app/api/intents/[ref]/qr/route.ts`, `components/DynamicQr.tsx`                                              | `lib/qr.ts` `renderQrSvg(payload)`                                                                     |
| Category → label / MCC / relevance tables                                | 3      | `engine/gates.ts` (`label`, `CATEGORY_RELEVANCE`), `upi.ts` (`CATEGORY_CODES`)                                                  | one `CATEGORY_META: Record<MerchantCategory, { label, mcc, relevance }>` in `lib/domain.ts`            |
| `MAX_SAFE_AMOUNT` (₹1 crore)                                             | 2      | `api/validate.ts:30`, `components/screens/CheckoutScreen.tsx` (`1_00_00_000` literal in `press()`)                              | `lib/domain.ts`                                                                                        |

### 4.5 UI primitives redefined per file

| Component                                                                             | Defined in                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Section`                                                                             | `DemoDrawer.tsx:298`, `ProfileSheet.tsx:167`, `HomeScreen.tsx:276` — three different prop signatures                                       |
| `Stat`                                                                                | `DemoDrawer.tsx:289`, `DecisionSheet.tsx:111`, `HistoryScreen.tsx:131`                                                                     |
| `Skeleton` / shimmer rows                                                             | `ProfileSheet.tsx:187`; inline in `DemoDrawer.tsx`, `NudgeCard.tsx`                                                                        |
| `Bar` (progress)                                                                      | `DecisionTrace.tsx:137`; inline in `ProfileSheet.tsx`, `DecisionSheet.tsx` (`Shortfall`)                                                   |
| Toggle chip className (`border-brand/50 bg-brand/10 …` / `border-line bg-elevated …`) | 7 occurrences: `DemoDrawer` ×4, `CheckoutScreen`, `DecisionTrace`, `PersonaScreen` — only the language one is a component (`LanguageChip`) |
| `PaytmWordmark`                                                                       | exported from `screens/PersonaScreen.tsx`, imported by `HomeScreen.tsx` — a screen exporting a brand primitive                             |

**Recommendation.** `components/ui/{Section,Stat,Skeleton,Bar,Chip,Wordmark}.tsx`; `Chrome.tsx` splits into `PhoneFrame`, `AppBar`, `Monogram`, `Pill`. Use `clsx` (or `tailwind-variants`) for the active/inactive variant instead of ternaries in template strings.

### 4.6 `lib/client/state.tsx` — five responsibilities, 601 lines

Reducer (140 lines), localStorage persistence with a hand-versioned key (`otc.nudge-history.v2`), the debounced decision effect, the nudge-copy effect, twenty action creators, and the context. Two `// eslint-disable-next-line react-hooks/exhaustive-deps` are the tell: effects that depend on state they deliberately exclude.

**Recommendation.** `zustand` with the `persist` middleware. It provides: the store, selectors (no more `useMemo` over the whole state), `persist({ name, version, migrate })` replacing both localStorage effects and the key-versioning comment, and actions as plain functions — the decision/copy effects become a `subscribe` on `[merchantId, amount, instrument]`. Expected: ~600 → ~300 lines, zero lint suppressions. Split into `lib/client/store.ts`, `lib/client/decision-effects.ts`, `lib/client/actions.ts`.

`lib/client/useProfile.ts` (hand-rolled fetch + cancelled flag + `setState` in effect — one of the two lint errors) is what `swr` or `@tanstack/react-query` exist for: `useSWR(['profile', userId], fetcher)` gives dedup, caching across the drawer and the profile sheet (currently two separate fetches of the same profile), and removes the lint error.

### 4.7 Environment handling

`process.env.*` is read raw in five modules (`client/api.ts` ×3, `db/client.ts`, `intents/sign.ts` ×2, `memory/cognee.ts` ×3, `nudge/sarvam.ts` ×4). Each applies its own default. `lib/intents/sign.ts` falls back to a **public constant** as the HMAC key when `QR_SIGNING_SECRET` is unset — correct for dev, dangerous if a production deploy ever loses the variable: every QR would verify against a key in the repo.

**Recommendation.** `@t3-oss/env-nextjs` (built on Zod, distinguishes server/`NEXT_PUBLIC_`, fails the build on a missing required var) or a single `lib/env.ts` Zod schema. Make `QR_SIGNING_SECRET` required when `NODE_ENV === 'production'`. Also: `@neon/env` is in `dependencies` and imported nowhere — remove; `neon.ts` is `defineConfig({})` — a no-op file, keep only if `neon deploy` is part of the workflow.

### 4.8 Timestamps

Drizzle `timestamp({ mode: 'string' })` returns Postgres's `2026-09-18 11:27:44.831+00`, which Safari's `Date.parse` rejects. Phase 2 patched this with `normaliseIntent()` in `lib/intents/store.ts` — but `listPayments()` in `lib/credit/store.ts` still returns raw strings to `GET /api/payments`, and the audit rows do too. Hand-rolled fix for a problem the library solves: `mode: 'date'` returns `Date` objects, which `JSON.stringify` emits as ISO. Change every timestamp column, delete `normaliseIntent()`, delete the `iso()` helper.

### 4.9 Security posture (demo-appropriate, but list it)

- `DELETE /api/payments?userId=` wipes any persona's ledger; `POST /api/intents` mints intents; both unauthenticated and unrate-limited. Fine on a demo URL, must be gated behind a demo token before anything else.
- `dangerouslySetInnerHTML` ×2 (`app/qr/page.tsx`, `components/DynamicQr.tsx`) on our own QR SVG. Safe as used; `qrcode.react` (`<QRCodeSVG value=… />`) removes the pattern entirely.
- No PII columns anywhere in the schema — a genuine strength, keep it.
- HMAC dev-key fallback — see 4.7.

### 4.10 API contract inconsistencies

| Case               | Route                     | Response                               |
| ------------------ | ------------------------- | -------------------------------------- |
| DB not configured  | `POST /api/payments`      | `200 { stored: false, reason }`        |
| DB not configured  | `POST /api/intents`       | `503 { error }`                        |
| DB not configured  | `GET /api/intents`        | `200 { database: false, intents: [] }` |
| Validation failure | most routes               | `400 { error: "\`field\` message" }`   |
| Scan refusal       | `POST /api/intents/[ref]` | `4xx { ok: false, reason, message }`   |
| Store failure      | `POST /api/payments`      | `502 { stored: false, error }`         |

Three envelopes. Pick `{ ok: boolean, error?: { code, message }, data? }` and apply it in the `jsonRoute` helper from 4.2. Non-blocking, but a judge who curls two endpoints will notice.

---

## 5. File-by-file

Legend — **Keep**: no action. **Tidy**: small, safe cleanup. **Refactor**: structural change. **Fix**: correctness.

### `lib/engine/` — the core

| File         | Lines | Verdict         | Scope of improvement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ----- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decide.ts`  | 335   | **Refactor**    | (a) Move `summarise`, `counterfactualForNudge`, `counterfactualForBlock`, `weakestComponent`, `weakestFactorHint` (lines 220–330) to `lib/engine/explain.ts` — decision and prose are two responsibilities. (b) Prose hardcodes thresholds that exist as constants: line 280 `rupees(2_00_000)` → `AMOUNT_CEILING`; line 286 "90 days and 25 transactions" → `COLD_START_MIN_*`; lines 290/292 "30-day", "7-day" → `BANK_COOLOFF_DAYS`, `FREQUENCY_WINDOW_DAYS`. If a threshold changes, the explanation lies. (c) Magic numbers `ELIGIBILITY_THRESHOLD + 15`, `headroom < 10` — name them. (d) Extract offer construction (lines 150–170) into `lib/engine/offer.ts` shared with the stage route — **this is P0 #1**. (e) Local `rupees()` → `formatINR`. |
| `gates.ts`   | 353   | **Keep / Tidy** | Exemplary structure. Tidy: `label()` table and `CATEGORY_RELEVANCE` belong in a single `CATEGORY_META` (with `upi.ts`'s MCC table). Local `rupees()` → `formatINR`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `score.ts`   | 205   | **Tidy**        | `clamp`, `round`, `rupees` local copies. Unnamed constants `affinity / 0.4`, `bigTicketCount6m / 3`, `0.6 / 0.4` context weights — name and comment. `MemoryContext` interface duplicated as a Zod-inferred type in `steps.ts`; keep one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `product.ts` | 69    | **Keep**        | Local `rupees()` only. The non-null assertions on lines 51–52 are safe because `fundingProducts.length > 1` guarantees both — add a one-line comment saying so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `emi.ts`     | 133   | **Keep**        | Correct, tested, well-commented. `buildSchedule` landed here in Phase 1 — right home.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### `lib/memory/` — profile derivation + external memory

| File          | Lines | Verdict                | Scope of improvement                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features.ts` | 233   | **Tidy**               | Local `clamp`, `sum`, `mean`, `stdDev` — `sum/mean/stdDev` are reasonable to keep local; `clamp` should be shared. `detectSalary` and `detectRecurringObligations` are pure, exported and **untested** directly — add tests (they are the "warm information" claim). Folder: this is profile derivation, not "memory" — see §7.                                              |
| `ledger.ts`   | 267   | **Keep**               | Deterministic PRNG, clear. `monthCount` calculation has a stray line break (`Math.ceil(...)\n+ 1`) — Prettier would catch. `MERCHANTS` name collides conceptually with `lib/merchants.ts`'s `MERCHANTS` — rename `MERCHANT_POOL`.                                                                                                                                            |
| `signal.ts`   | 122   | **Tidy**               | Local `clamp`, `round`, `rupees`. Unnamed `/ 0.6`, `/ 365`, `/ 120` divisors — name them (`MAX_COMMITMENT_RATIO`, `FULL_TENURE_DAYS`, `FULL_ACTIVITY_TXNS`).                                                                                                                                                                                                                 |
| `cognee.ts`   | 271   | **Refactor (logging)** | `refreshFromCognee` catch at line 184 swallows every failure — the single most important thing to log in the system. `callCognee` hand-rolls the timeout → `AbortSignal.timeout`. `extractOutcomes` is pure, clever, and **untested** — it is the parser between a third-party response and a credit decision; give it a fixture test. Move to `lib/integrations/cognee.ts`. |

### `lib/nudge/`

| File           | Lines | Verdict  | Scope of improvement                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sarvam.ts`    | 263   | **Tidy** | Excellent validation design. `validateNudgeText`, `normaliseDigits`, `extractNumbers` are pure and **untested** — the "model cannot invent a number" claim deserves a test per rule. Fallback `reason` is returned but never logged. Hand-rolled `AbortController`. Cache is an unbounded `Map` — fine for a demo, note it. Move to `lib/integrations/`. |
| `templates.ts` | 129   | **Keep** | `formatRupees` duplicates `formatINR`. `LANGUAGE_NAMES` is imported by two client components, which pulls every template string into the client bundle — move `LANGUAGE_NAMES` to `lib/domain.ts`.                                                                                                                                                       |

### `lib/api/`

| File          | Lines | Verdict      | Scope of improvement                                                                                                                                                |
| ------------- | ----- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate.ts` | 181   | **Refactor** | Overlaps `steps.ts` almost entirely (§4.3). `rupees`, `CATEGORIES`, `firstIssue` duplicated there. Merge into `lib/api/schemas.ts` + `lib/api/route.ts`.            |
| `steps.ts`    | 74    | **Refactor** | Same. Header comment (line 10: "these are thin wrappers, not a second implementation … can never disagree") is contradicted by `engine/offer/route.ts` — see P0 #1. |

### `lib/db/`, `lib/audit/`, `lib/credit/`, `lib/intents/` — persistence (Phases 0–2)

| File               | Lines | Verdict          | Scope of improvement                                                                                                                                                                                                                                              |
| ------------------ | ----- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db/schema.ts`     | 289   | **Tidy**         | `mode: 'string'` on every timestamp → `mode: 'date'` (§4.8). Otherwise clean; `drizzle-zod` refinements use the callback form correctly.                                                                                                                          |
| `db/client.ts`     | 47    | **Keep**         | `withTimeout` via `Promise.race` is the right tool here (Neon HTTP has no signal hook).                                                                                                                                                                           |
| `audit/store.ts`   | 200   | **Tidy**         | `round()` copy. `summarise()` is a reporting concern living in a store — move to `lib/audit/summary.ts`. Naming: `lib/audit/db.ts` beside `lib/db/` confuses; rename to `lib/audit/repository.ts`.                                                                |
| `audit/db.ts`      | 136   | **Tidy**         | Two 20-line row↔record mappers; acceptable. Rename per above.                                                                                                                                                                                                     |
| `credit/store.ts`  | 226   | **Tidy**         | The only `console.warn` in a hot path is here and it is correct. `listPayments` returns raw pg timestamps (§4.8). `BatchItem<'pg'>` tuple casts ×2 — a `batch(statements)` wrapper in `db/client.ts` hides that once.                                             |
| `intents/store.ts` | 191   | **Tidy**         | `normaliseIntent`/`iso()` disappear with `mode: 'date'`. `db()!` non-null assertion at line 170 — the client was checked at the top of the function via `findIntent`, but the assertion hides that; capture `client` once. `REFUSALS` table is the right pattern. |
| `intents/sign.ts`  | 47    | **Fix (config)** | Dev-key fallback must be impossible in production (§4.7). Otherwise correct: `timingSafeEqual`, base64url, lazy env read.                                                                                                                                         |

### `lib/` root

| File           | Lines | Verdict      | Scope of improvement                                                                                                                                                                                                       |
| -------------- | ----- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`     | 278   | **Refactor** | Enum unions should derive from `as const` arrays in `lib/domain.ts` (§4.3). `DecisionRequest.intentRef` and `LiveCredit` additions are fine.                                                                               |
| `upi.ts`       | 143   | **Keep**     | Clean, isomorphic, well-commented after Phase 2. `CATEGORY_CODES` → `CATEGORY_META`.                                                                                                                                       |
| `personas.ts`  | 336   | **Tidy**     | Every persona states `priorCreditRepayments`/`latePayments` in `spec` **and** `credit: { priorRepayments, latePayments }` — 12 duplicated numbers; derive `credit` from `spec`. Fixture data → `lib/fixtures/personas.ts`. |
| `people.ts`    | 110   | **Keep**     | Fixture → `lib/fixtures/`.                                                                                                                                                                                                 |
| `merchants.ts` | 109   | **Keep**     | Fixture → `lib/fixtures/`.                                                                                                                                                                                                 |
| `dates.ts`     | 64    | **Keep**     | Model wrapper over date-fns; exactly right.                                                                                                                                                                                |
| `format.ts`    | 69    | **Keep**     | This is where the other seven `rupees()` should import from.                                                                                                                                                               |

### `lib/client/`

| File            | Lines | Verdict      | Scope of improvement                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ----- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.tsx`     | 601   | **Refactor** | §4.6. Also `attachIntentDecision` is called inside the decision `.then` — correct place, but the effect's dependency array now lists `intentRef` under a disable comment; zustand removes the problem.                                                                                                                                                                                                                                                                                 |
| `api.ts`        | 277   | **Tidy**     | n8n response handling uses `as unknown as` ×2 and a single `typeof showNudge === 'boolean'` check — parse with a `decisionSchema` (Zod) so a malformed n8n response is caught structurally. Two hand-rolled `AbortController`s → `AbortSignal.timeout`. Four fire-and-forget `fetch(…, { keepalive })` → one `beacon(url, body)` helper (`navigator.sendBeacon` where available). `reportOutcome` docblock was displaced during Phase 2 and restored — Prettier would have flagged it. |
| `useProfile.ts` | 62    | **Refactor** | Replace with `swr`/react-query (§4.6). Fixes lint error `useProfile.ts:45`.                                                                                                                                                                                                                                                                                                                                                                                                            |

### `app/api/` — routes

| File                                                                      | Verdict      | Scope of improvement                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decide/route.ts`                                                         | **Tidy**     | Boilerplate (§4.2). `ENGINE_VERSION` is exported from a route and imported by `health/route.ts` — constants should not live in route files; move to `lib/engine/version.ts`.                                                                                                              |
| `engine/profile/route.ts`                                                 | **Tidy**     | Boilerplate. Fine otherwise.                                                                                                                                                                                                                                                              |
| `engine/gates/route.ts`                                                   | **Tidy**     | Boilerplate; inline instrument enum (§4.3); builds a synthetic `DecisionRequest` with `transactionId: 'stage'` — acceptable, comment it.                                                                                                                                                  |
| `engine/score/route.ts`                                                   | **Keep**     | Thin. Boilerplate only.                                                                                                                                                                                                                                                                   |
| `engine/offer/route.ts`                                                   | **Fix — P0** | Lines 50–63 reimplement offer construction and still carry the fallback that offers an unaffordable plan. `suppressDays: 7` literal duplicates `DECLINE_SUPPRESS_DAYS`. `as ProductState[]` casts ×2 because `productShape` is not the shared type. Replace the body with `buildOffer()`. |
| `audit/route.ts`                                                          | **Tidy**     | Third copy of "first Zod issue" (lines 47–52). Boilerplate.                                                                                                                                                                                                                               |
| `memory/recall`, `memory/remember`                                        | **Keep**     | Thin. Boilerplate only.                                                                                                                                                                                                                                                                   |
| `nudge-text/route.ts`                                                     | **Keep**     | Thin.                                                                                                                                                                                                                                                                                     |
| `payments/route.ts`                                                       | **Tidy**     | Envelope inconsistency (§4.10). Inline method enum.                                                                                                                                                                                                                                       |
| `intents/route.ts`, `intents/[ref]/route.ts`, `intents/[ref]/qr/route.ts` | **Tidy**     | Envelope; QR options copy; `json()` helper is local to one file — it is the same helper every route needs.                                                                                                                                                                                |
| `profile/route.ts`                                                        | **Keep**     | Thin.                                                                                                                                                                                                                                                                                     |
| `health/route.ts`                                                         | **Keep**     | Good — reports DB reachability with counts. Add `signing`, `cognee`, `n8n` flags so one call shows the whole configuration.                                                                                                                                                               |

### `app/`

| File                                                         | Verdict         | Scope of improvement                                                                     |
| ------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------- |
| `layout.tsx`, `page.tsx`                                     | **Keep**        | —                                                                                        |
| `qr/page.tsx`                                                | **Tidy**        | QR options copy; `dangerouslySetInnerHTML` → `qrcode.react`. `force-dynamic` is correct. |
| _(missing)_ `error.tsx`, `global-error.tsx`, `not-found.tsx` | **Fix — P0 #2** | —                                                                                        |

### `components/`

| File                         | Lines | Verdict  | Scope of improvement                                                                                                                                                                                                      |
| ---------------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppShell.tsx`               | 55    | **Keep** | Screen switch is a `key`ed `AnimatePresence` — clean.                                                                                                                                                                     |
| `Chrome.tsx`                 | 112   | **Tidy** | Four unrelated primitives in one file → `components/ui/`.                                                                                                                                                                 |
| `Sheet.tsx`                  | 95    | **Keep** | Drag-from-header decision is documented and correct.                                                                                                                                                                      |
| `BottomNav.tsx`              | 97    | **Keep** | —                                                                                                                                                                                                                         |
| `NudgeCard.tsx`              | 118   | **Tidy** | Add `aria-live="polite"` — the nudge appears asynchronously. Shimmer rows → `Skeleton`.                                                                                                                                   |
| `DecisionSheet.tsx`          | 150   | **Tidy** | `weakestSignal`/`weakestFactor` duplicate engine helpers (§4.4); `Stat` copy; inline `Bar`.                                                                                                                               |
| `DecisionTrace.tsx`          | 147   | **Keep** | Owns `Bar` — promote it to `ui/`.                                                                                                                                                                                         |
| `DemoDrawer.tsx`             | 334   | **Tidy** | `Section`, `Stat`, `LanguageChip` copies; four chip ternaries; `daysAgo()` belongs in `lib/dates.ts`. Otherwise fine.                                                                                                     |
| `ProfileSheet.tsx`           | 195   | **Tidy** | `Section`, `Skeleton` copies; inline bar. Fetches the same profile the drawer fetches — SWR dedups it.                                                                                                                    |
| `DynamicQr.tsx`              | 148   | **Tidy** | QR options copy; `dangerouslySetInnerHTML` → `qrcode.react`; countdown `setInterval` is fine.                                                                                                                             |
| `screens/HomeScreen.tsx`     | 292   | **Tidy** | Third `Section`; imports `PaytmWordmark` from `PersonaScreen`.                                                                                                                                                            |
| `screens/CheckoutScreen.tsx` | 217   | **Tidy** | `1_00_00_000` literal (§4.4); one-line destructuring of 15 fields (Prettier). `EngineStrip` and `Keypad` are fine as local components.                                                                                    |
| `screens/ScannerScreen.tsx`  | 311   | **Tidy** | Pre-existing lint error at line 147 (`setCanDecode` inside effect — derive `canDecode` from `'BarcodeDetector' in window` at render instead). Add `aria-live` to the refusal overlay. Four silent catches, all justified. |
| `screens/ApprovedScreen.tsx` | 171   | **Keep** | Re-exports `buildSchedule` for `SuccessScreen` — `SuccessScreen` should import from `lib/engine/emi` directly.                                                                                                            |
| `screens/SuccessScreen.tsx`  | 152   | **Tidy** | Import `buildSchedule` from `lib/engine/emi`, not from another screen.                                                                                                                                                    |
| `screens/HistoryScreen.tsx`  | 138   | **Tidy** | `Stat` copy. Shows localStorage payments only; could show the DB ledger (`GET /api/payments`) with instalment status — the Phase 1 data is not surfaced anywhere in the UI except the drawer's obligations list.          |
| `screens/PersonaScreen.tsx`  | 100   | **Tidy** | Move `PaytmWordmark` out.                                                                                                                                                                                                 |

### `tests/`

| File                                                                                    | Verdict  | Scope of improvement                                                                                                               |
| --------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `engine.test.ts` (285)                                                                  | **Keep** | Model test file.                                                                                                                   |
| `credit.test.ts`, `intents.test.ts`, `audit.test.ts`, `upi.test.ts`, `validate.test.ts` | **Keep** | —                                                                                                                                  |
| `inspect.test.ts`                                                                       | **Tidy** | A script masquerading as a test (`console.log` dump). Move to `scripts/scenarios.ts` and run with `tsx`; keep `npm run scenarios`. |
| _(missing)_                                                                             | **Add**  | See §6.                                                                                                                            |

### `n8n/`, `scripts/`, root

| File                                                   | Verdict  | Scope of improvement                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `n8n/01-nudge-pipeline.json`                           | **Tidy** | Two `code` nodes (`Assemble decision`, `Assemble withheld`) contain ~60 lines of JS inside JSON strings: untyped, unlinted, untested, and they duplicate the SCORE_THRESHOLD sentence and the response shape from `decide.ts`. Move that logic behind one `/api/engine/assemble` route so n8n nodes stay declarative. `localhost:3111` ×10 is handled by `retarget.mjs` — acceptable, documented. |
| `n8n/02-04-*.json`                                     | **Keep** | —                                                                                                                                                                                                                                                                                                                                                                                                 |
| `n8n/cloud/*.json`                                     | **Tidy** | Generated artefacts committed to git. Either gitignore them or add a header note that they are outputs of `retarget.mjs`.                                                                                                                                                                                                                                                                         |
| `n8n/sync.sh`                                          | **Keep** | Mutates n8n's sqlite directly — fragile by nature, but every reason is documented.                                                                                                                                                                                                                                                                                                                |
| `n8n/retarget.mjs`                                     | **Keep** | —                                                                                                                                                                                                                                                                                                                                                                                                 |
| `scripts/deploy.sh`                                    | **Tidy** | Pushes only four env vars; now missing `DATABASE_URL` and `QR_SIGNING_SECRET`. Either extend the list or delete the script in favour of `vercel env pull/push` + git-push deploys (which is what is actually used).                                                                                                                                                                               |
| `package.json`                                         | **Tidy** | Remove unused `@neon/env`. Add `"engines": { "node": ">=20" }`. Add `format` (Prettier) and `test:coverage` scripts.                                                                                                                                                                                                                                                                              |
| `neon.ts`                                              | **Tidy** | `defineConfig({})` — no-op. Keep only if `neon deploy` stays in the workflow.                                                                                                                                                                                                                                                                                                                     |
| `eslint.config.mjs`                                    | **Keep** | Next defaults. Two pre-existing errors should be fixed rather than suppressed.                                                                                                                                                                                                                                                                                                                    |
| `tsconfig.json`                                        | **Keep** | `strict: true`.                                                                                                                                                                                                                                                                                                                                                                                   |
| _(missing)_ `.prettierrc`, `.github/workflows/ci.yml`  | **Add**  | P0 #3 and P2.                                                                                                                                                                                                                                                                                                                                                                                     |
| `README.md`, `SETUP.md`, `HANDOFF.md`, `n8n/README.md` | **Keep** | Unusually good. Update `SETUP.md`'s "Do you need a real DB?" — already done.                                                                                                                                                                                                                                                                                                                      |

---

## 6. Test gaps (ordered by value)

1. **`app/api/engine/offer` vs `decide()` parity** — a test that runs both on the same inputs and asserts identical offers. Would have caught P0 #1. Cheap; use `NextRequest` directly against the route module.
2. **`validateNudgeText`** — one test per rule: empty, too long, multiline, missing amount, invented number, Indic numerals, no-cost zero allowed.
3. **`extractOutcomes`** (Cognee parser) — a fixture of a real `/search` response; duplicate-chunk dedup; truncated JSON skipped.
4. **`detectSalary` / `detectRecurringObligations`** — directly, on hand-built ledgers: 2 months of a charge is not recurring, 3 is; salary detected with jitter; gig income with 40% variance not detected.
5. **Store tests against a real Postgres.** `@electric-sql/pglite` + `drizzle-orm/pglite` run the real migrations in-process in ~100ms — no Neon needed in CI. Test: the payment batch is atomic (a bad installment row rolls back the payment); the append-only trigger; `clearUser` leaves the trail intact.
6. **Route-level tests** for the error envelope and status codes (§4.10).
7. **Coverage tooling**: `@vitest/coverage-v8`, threshold on `lib/engine/**` at 90%.

---

## 7. Folder structure — proposed

```
lib/
  domain.ts            enums as `as const` + Zod + types (single source of truth)
  env.ts               validated environment
  log.ts               pino
  math.ts              clamp, round
  format.ts            formatINR, amountInWords  (unchanged)
  dates.ts             (unchanged)
  qr.ts                renderQrSvg
  upi.ts               (unchanged)
  engine/
    decide.ts gates.ts score.ts product.ts emi.ts
    offer.ts           ← shared by decide() and the n8n stage   (P0)
    explain.ts         ← prose moved out of decide.ts
    version.ts         ← ENGINE_VERSION
  profile/             ← was lib/memory/ minus cognee
    ledger.ts features.ts signal.ts build.ts (buildProfile)
  fixtures/
    personas.ts people.ts merchants.ts
  integrations/
    cognee.ts sarvam.ts
  nudge/
    templates.ts
  db/
    client.ts schema.ts
  repositories/        ← was lib/audit/db.ts, lib/credit/store.ts, lib/intents/store.ts
    audit.ts credit.ts intents.ts
  audit/
    summary.ts         ← summarise() out of the store
  api/
    route.ts           jsonRoute() — body parse, Zod, envelope, logging
    schemas.ts         ← validate.ts + steps.ts merged
  client/
    store.ts           zustand + persist
    actions.ts effects.ts
    api.ts
    useProfile.ts      → swr
components/
  ui/                  Section Stat Skeleton Bar Chip Pill Monogram AppBar PhoneFrame Wordmark
  DecisionSheet DecisionTrace DemoDrawer ProfileSheet NudgeCard Sheet DynamicQr
  screens/             (unchanged)
app/
  error.tsx global-error.tsx not-found.tsx    ← new
  api/ …               each route ≤ 20 lines after jsonRoute()
scripts/
  scenarios.ts         ← was tests/inspect.test.ts
.github/workflows/ci.yml
.prettierrc
```

---

## 8. Libraries — what each one deletes

| Library                           | Replaces                                                                                | Lines removed (est.) |
| --------------------------------- | --------------------------------------------------------------------------------------- | -------------------- |
| `pino`                            | nothing — there is nothing to replace, which is the finding                             | +40                  |
| `zustand` (+ `persist`)           | reducer, two localStorage effects, key versioning, two lint suppressions in `state.tsx` | −250                 |
| `swr`                             | `useProfile.ts` fetch/cancel/setState; duplicate profile fetch                          | −45                  |
| `@t3-oss/env-nextjs`              | 13 raw `process.env` reads with ad-hoc defaults; dev-key fallback                       | −30                  |
| `AbortSignal.timeout` (built-in)  | four `AbortController` + `setTimeout` + `clearTimeout` blocks                           | −40                  |
| Drizzle `mode: 'date'` (built-in) | `normaliseIntent`, `iso()`; latent Safari bug in `listPayments`                         | −25                  |
| `qrcode.react`                    | two `dangerouslySetInnerHTML` sites, one QR options copy                                | −20                  |
| `clsx` / `tailwind-variants`      | seven chip ternaries                                                                    | −30                  |
| `@electric-sql/pglite`            | nothing yet — enables real DB tests in CI                                               | +tests               |
| `prettier`                        | manual formatting drift                                                                 | —                    |

---

## 9. Outcome — what was done

Carried out 18 Sep 2026 across seven commits, each verified (typecheck, lint,
tests, build; live checks against Neon where persistence changed) and
committed separately so any one can be reverted alone.

| Commit    | Step    | Result                                                                                                                                                                                                                                                                                                           |
| --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e97e61e` | 1 — P0  | `lib/engine/offer.ts` is the only offer implementation; `tests/offer-parity.test.ts` drives 480 combinations through both paths. Error boundaries added. CI added. Both pre-existing lint errors fixed structurally, not suppressed.                                                                             |
| `da868d3` | 2a      | `lib/domain.ts` + `lib/schemas.ts` + `lib/math.ts` + `lib/qr.ts` + `lib/engine/explain.ts`. Seven `rupees()` → one `formatINR`, three `clamp()`, three `round()`, three QR option blocks, three category tables → one `CATEGORY_META`.                                                                           |
| `6cb9887` | 2c      | `lib/log.ts` (pino), ten named events at every fallback boundary, `x-vercel-id` request correlation.                                                                                                                                                                                                             |
| `df1862a` | 2b + 2d | `jsonRoute`/`getRoute` — twelve routes lost their boilerplate and three error envelopes became one. `lib/env.ts` validates the environment; production refuses to start without `QR_SIGNING_SECRET`. Timestamps → `mode: 'date'`, deleting `normaliseIntent()` and fixing the same latent bug in `listPayments`. |
| `6e52feb` | 3a      | `lib/profile/`, `lib/integrations/`, `lib/fixtures/`, `lib/audit/repository.ts`, `lib/audit/summary.ts`, `lib/profile/build.ts`. Persona credit record derived rather than restated.                                                                                                                             |
| `8c0761b` | 3b      | `components/ui.tsx` (Bar, Skeleton, Chip, PaytmWordmark), SWR for `useProfile`, first eleven render tests.                                                                                                                                                                                                       |
| `c61ca72` | 3c      | `lib/client/state-machine.ts` — the reducer, pure and now covered by eighteen tests.                                                                                                                                                                                                                             |
| `ceae15b` | 4       | Twenty-eight tests for `validateNudgeText`, `extractOutcomes`, `detectSalary`, `detectRecurringObligations`. Prettier, gated in CI.                                                                                                                                                                              |
| `28cc37c` | —       | CI's first real run failed on a stale lock file and Node 20 vs vitest 5. Both fixed.                                                                                                                                                                                                                             |

**Tests: 89 → 627.** Lint: 2 errors → clean. Logging: 4 `console.warn` → 10 structured events.

### Deviations from this document, and why

- **§4.10 error envelope.** The audit proposed `{ ok, error: { code, message } }`. On implementation that is a breaking change to the n8n code nodes and `lib/client/api.ts` for cosmetic gain, so the existing `{ error: string }` was kept and made universal through one helper instead.
- **§4.5 `Section` and `Stat`.** Counted as six duplicates. Reading them, they are the same _name_ wrapping three different designs each — different heading levels and spacing, on purpose. Merging would have changed the screens, so they were left alone. Only the genuine duplicates (Bar, Skeleton, Chip, PaytmWordmark) were extracted.
- **§4.6 zustand.** Not done. The case rested partly on two `eslint-disable` directives, both since removed, and on the 600-line file, since split. What remains is a library swap in the layer that drives every screen, with no browser available to click through — not a trade worth making the night before the demo. The reducer is now pure and tested, which was the real risk.

### Still open

- pglite store tests (§6.5) and route-level status tests (§6.6).
- Coverage tooling and a threshold on `lib/engine/**`.
- The n8n `code` nodes still hold ~60 lines of JS in JSON (§5, n8n).
- `DELETE /api/payments` and `POST /api/intents` remain unauthenticated (§4.9) — fine for a demo URL, not for anything else.
- `qrcode.react` to remove the two `dangerouslySetInnerHTML` sites.

---

## 9. Suggested order of work

1. **P0 today (≈1 h):** `lib/engine/offer.ts` + parity test; `app/error.tsx`; CI workflow. Commit, push, verify.
2. **Session 2 (≈3 h):** `lib/domain.ts` + merged schemas + `jsonRoute()`; `pino` at the six fallback boundaries; `mode: 'date'`; env validation.
3. **Session 3 (≈3 h):** zustand store; SWR; `components/ui/`; `explain.ts`; fixtures folder; Prettier + fix the two lint errors.
4. **Session 4:** pglite store tests; validator tests; n8n assemble route.

None of steps 2–4 change behaviour; each should ship with the existing 89 tests green and the parity test added in step 1.
