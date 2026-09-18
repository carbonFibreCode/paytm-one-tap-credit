# Handoff — One-Tap Credit

Context for picking this up in a fresh session. Read `SETUP.md` for how to run
things; this file is *what exists and why*.

---

## What this is

**Paytm Build for India AI Hackathon — Delhi Edition, Track 2.** Event is
**19 Sep 2026**, 8 hours on-site at Paytm Noida, but the venue day is
*showcase + presentation + final touch-ups*, so the build happens beforehand.
Team: Arun Kumar (builds) + Vivek Goswami (presents).

**The idea:** at the moment of payment, decide in real time whether to surface a
pre-approved credit offer — and which product (Paytm Postpaid vs co-branded
card) — so the customer gets one-tap credit instead of separately discovering,
applying for and waiting on a loan.

**Prize being chased:** best use of **n8n** (a named sponsor). Cognee and Sarvam
are the other sponsors; credits provided for n8n and Cognee.

---

## Live

| | |
|---|---|
| App | https://paytm-one-tap-credit.vercel.app |
| QR codes | https://paytm-one-tap-credit.vercel.app/qr |
| Repo | `carbonFibreCode/paytm-one-tap-credit` (private) |
| Vercel | `Arun Kumar's projects` scope, GitHub connected, auto-deploys on push to `main` |
| Tests | 61 passing, ~1s |
| Source | ~7,900 lines |

---

## The architecture, and why it is shaped this way

### The engine is a pure function

`lib/engine/decide.ts` reads no clock, no database, no environment. The caller
supplies the timestamp and the nudge history. Three consequences, all
deliberate:

- the same request always produces the same decision, so it is reproducible in
  front of a judge
- frequency caps survive a serverless cold start, because history lives with the
  client
- it is trivially testable, which is why there are 61 tests and not 3

### Two-stage decision

1. **14 hard gates**, ordered, short-circuiting. Any failure ends it and no score
   can override. `CATEGORY_PROHIBITED` (P2P, wallet loads, gambling, crypto) and
   `AFFORDABILITY` (FOIR-style 40% cap) are the two worth pointing at.
2. **Relevance score** 0–100, four weighted factors plus a memory adjustment.
   Only asks "is this a good moment to interrupt", never "may this person
   borrow".

### The memory layer is derived, not declared

Each persona has a seeded 200–250 row transaction ledger. Salary is *detected*
by finding repeated similar-sized credits; existing EMIs by finding the same
merchant charging the same amount across ≥3 months. Those derive
`affordabilityCapacity`, which the affordability gate checks. So three gates are
grounded in behaviour rather than a hardcoded flag.

### n8n orchestrates every stage

The engine is also exposed as four HTTP stages (`/api/engine/profile`, `gates`,
`score`, `offer`) so the n8n canvas *is* the architecture diagram — 16 nodes,
every branch and refusal visible. `/api/decide` remains the monolithic fallback,
and the app falls back to it automatically if n8n does not answer in 3s.

**This was the key change.** Before it, n8n called one endpoint and a judge could
fairly say the orchestrator was unnecessary.

---

## Integrations, and the traps in each

### Cognee — working in production

**Not a REST API in its SDK form.** `@cognee/cognee-ts` is a 257 MB
platform-specific native addon that cannot run in a Vercel function. **Cognee
Cloud's REST API is what we use**, called directly from the app.

Traps already hit and fixed:
- `/api/v1/remember` is **multipart/form-data**; `data` expects file uploads and
  `raw_data` is the text field. A JSON body is silently ignored and surfaces as
  *"Either datasetId or datasetName must be provided"*.
- Search is **`searchType`** (camelCase), not the `search_type` the docs show.
- Base URL is **per-tenant** (`https://<tenant>.aws.cognee.ai`), not
  `api.cognee.ai`.
- **Search takes 5–6 seconds.** Far too slow for a checkout, so recall is served
  from a warm in-process cache with a background refresh — 7ms in the decision
  path. A miss falls through to the local trail rather than waiting.

Memory only ever adjusts **relevance** (−20 declined in this category, −8
declined elsewhere, +5 accepted). It can never unlock a hard gate.

`cognee-service/` is an optional sidecar for running the graph fully locally.
Ignore it unless that is wanted.

### Sarvam — not configured, runs on templates

`SARVAM_API_KEY` is empty, so nudge copy comes from contextual templates in
hi/en/ta/bn and `source` says `template`. Wrapped in three protections that stay
in force either way: 2.5s timeout, **output validation** (any number the model
introduces that we did not supply invalidates the response — Indic numerals
normalised first), and a cache.

### n8n — working locally, not yet on Cloud

Four workflows in `n8n/`, all tested end to end locally:

1. **Decision pipeline** (16 nodes, webhook) — the staged orchestration
2. **Outcome recorder** (webhook) — audit trail + Cognee write
3. **Sarvam copy pre-warm** (3am + manual) — fan-out, batching
4. **Daily funnel digest** (9am + manual) — aggregation, writes markdown

`bash n8n/sync.sh` reproduces the whole local n8n state in one command.
`node n8n/retarget.mjs <url>` writes cloud-ready copies to `n8n/cloud/`.

**n8n 2.x sharp edges, all handled by `sync.sh`:** `import:workflow` clones
unless the JSON has a top-level `id`; it always deactivates on import and ignores
the `active` field; activation silently fails unless `activeVersionId` matches
`versionId`. These cost 16 duplicate workflows before being spotted.

---

## Where data lives

| Data | Volume | Where now | Durable on Vercel? |
|---|---|---|---|
| 6 personas, 8 merchants | tiny | code (`lib/people.ts`, `lib/personas.ts`) | n/a — static |
| Transaction ledgers | ~250 rows each | **generated at runtime from a seed** | n/a — never stored |
| Nudge history (frequency cap) | tiny | browser `localStorage` | client-owned by design |
| Payment history | small | browser `localStorage` | client-owned |
| Decision audit trail | grows | **Neon Postgres `decisions`**, mirrored to `.data/decisions.jsonl` | **yes** with `DATABASE_URL` |
| Offer outcomes | tiny | **Neon Postgres `nudge_events`** + Cognee Cloud for recall | yes |

### Database — Phase 0 done (18 Sep)

Neon project `autumn-poetry-48959969` (ap-southeast-1, Postgres 18), linked to
this directory with `neon link` — that command is also how a fresh clone gets
`DATABASE_URL` into `.env.local`. Neon Postgres over HTTP, Drizzle schema + migrations in `lib/db/` and `drizzle/`,
`drizzle-zod` validating rows at the boundary. Wired behind `appendRecord()` /
`readRecords()` in `lib/audit/store.ts`, so no caller changed and n8n's audit
nodes are untouched. `DATABASE_URL` unset → identical behaviour to before.

Rules that shaped it, and should shape the next phases:

- **The engine never reads the database.** Anything the engine needs from it
  arrives as an explicit input, the way `nudgeHistory` and `timestamp` already
  do. `lib/engine/` changed by zero lines.
- **A database failure can never fail a payment.** Writes are best-effort
  alongside the file; reads have an 800ms budget and fall back to the local trail.
- **`decisions` is append-only** — a trigger rejects UPDATE/DELETE. Slide-worthy.
- **Money is `integer` rupees.** Never `numeric(_,2)`; the no-cost EMI rounding
  depends on integer arithmetic.
- **`transactionId` is deterministic** (`txn_<user>_<merchant>_<amount>`), so it
  is stored as `decision_key`, indexed, *not* the primary key. Two scans of the
  same amount are two rows.

### Database — Phase 1 done (18 Sep): the credit ledger

`payments`, `credit_accounts`, `emi_installments` in `lib/db/schema.ts`;
`lib/credit/store.ts` writes all three in one Neon HTTP batch when a payment
goes on credit, and refuses any schedule that does not sum to principal +
interest exactly. `liveCredit(userId)` reads active accounts back as
`LiveCredit` — the next instalment per account, and the unpaid balance per
product.

**This is the new demo beat.** `/api/decide`, `/api/profile` and
`/api/engine/profile` read live credit and pass it to `buildProfile(persona,
asOf, live)`; the profile builder adds the live instalments to
`detectedObligations` (tagged `source: 'account'`) and subtracts the unpaid
balance from `products[].available`. Rohit at Kroma ₹50,000: capacity
₹27,348 → one plan → ₹20,681 → two → ₹14,014 (only the 6-month tenure left)
→ four → `AFFORDABILITY`. Same user, same merchant, same amount — the engine
declined because of what it just lent.

The engine still reads no database, but live credit exposed one latent bug in
`lib/engine/decide.ts`, now fixed: the affordability gate checks the cheapest
plan across *all* funding products, while the offer was built for the
preferred product only — so a user near capacity could be shown a Postpaid
plan above the capacity the gate had just quoted. The offer now moves to the
product that actually has a plan that fits, with the rationale saying why.
`tests/credit.test.ts` asserts no offered instalment ever exceeds capacity.

The client posts to `/api/payments` fire-and-forget from `confirmCredit()` and
`payNormally()`; the demo drawer's **Reset user** clears nudge history *and*
the user's payments and accounts, locally and on the server. The decision
trail is never touched by a reset — it is append-only.

`GET /api/payments?userId=u_rohit` shows the ledger with schedules.

### Database — Phase 2 done (18 Sep): QR codes are payment intents

**What fintechs actually do, and what this now does:** a QR is a rendering of
a `upi://pay?…` string; the thing stored is the *intent* the string points to.
`payment_intents` holds one row per code — `ref` (the UPI `tr` parameter),
merchant, VPA, MCC, amount (dynamic only), expiry (dynamic only), the exact
signed `payload`, and a `created → scanned → paid / expired` status. The image
is never stored: `/api/intents/[ref]/qr` renders SVG from `payload` on demand.

**Signed intents.** Every payload ends in `&sign=<HMAC-SHA256 over everything
before it>` — the UPI 2.0 signed-intent idea, with an HMAC because this app
is both issuer and verifier. `QR_SIGNING_SECRET` must be the same everywhere
(it is set locally and on Vercel prod + preview); change it and every printed
code stops verifying, which is the correct failure.

**The scan flow.** Scanner reads a code → if it carries `tr`, `POST
/api/intents/[ref]` with the raw payload → the server verifies the signature,
checks the ref is one we issued and the payload is byte-for-byte what we
issued, checks expiry and paid state, marks it `scanned` → the app locks on
with `intentRef`. A refusal is shown in the viewfinder with its reason
(*altered*, *expired*, *already paid*, *not ours*). If the server is
unreachable the local parse is trusted, as before — wifi cannot blank the
scanner. `decisionOk` PATCHes the decision key onto the intent; the payment
batch marks it `paid`. Chain: `payment_intents.decision_key` →
`decisions.decision_key`; `payments.intent_ref` → `payment_intents.ref`;
`credit_accounts.payment_id` → `payments.id`.

**`/qr` page.** Sticker codes (static, one per merchant, no amount — the app
pre-fills the demo amount) come from `ensureStaticIntents()`, so the same ref
prints every time (`OTCSKROMA`…). A **bill QR** generator issues a dynamic
code for one amount with a 15-minute countdown; pay it and a re-scan is
refused. Demo beats: scan a paid bill again; edit one character of a payload.

**Not done:** n8n's audit node does not yet pass `intentRef` through (the link
is made client-side via PATCH, which covers both paths).

---

## Decisions already made — do not relitigate

- **No analytics dashboard with invented metrics.** The deck's slide 10 commits
  to assumption-labelled projections; fake traction would contradict it.
- **No ML model trained on the synthetic data.** It would relearn our own rules;
  a sharp judge would spot the circularity. The honest AI story is Sarvam
  generating contextual regional copy plus an explainable decision layer.
- **Card switch point is ₹75,000**, not ₹50,000, so the deck's headline
  ₹50,000 Kroma scenario stays on Postpaid.
- **No-cost EMI rounds early instalments up** so the final payment is never the
  largest: 16,667 + 16,667 + 16,666 = 50,000 exactly.
- **Dark theme** — matches the deck mockups and Paytm's real pay screen.

---

## Demo script

Six persona/amount combinations, three offers and five refusals, each with a
distinct machine code and human sentence:

```
u_rohit    ₹50,000  Kroma       NUDGE postpaid  (3 × ₹16,667 no cost)
u_rohit    ₹80,000  Jewels      NUDGE card      (crosses ₹75,000 switch)
u_rohit       ₹450  BigBazaar   AMOUNT_FLOOR
u_rohit    ₹35,000  P2P         CATEGORY_PROHIBITED
u_priya    ₹50,000  Kroma       AFFORDABILITY      (eligible, declined responsibly)
u_aman     ₹50,000  Kroma       COLD_START
u_deepak   ₹20,000  Kroma       NOT_ELIGIBLE
u_meera    ₹50,000  Kroma       INSUFFICIENT_LIMIT
u_vikram   ₹30,000  Kroma       BANK_COOLOFF
```

Showing restraint is the credibility beat. Full 9-step script in `README.md`.

---

## Not done

1. **n8n Cloud** — workflows retargeted and waiting in `n8n/cloud/`; needs
   importing and activating in the browser
2. **Sarvam key** — one env var; would make the live AI moment real
3. **Deck screenshots** — slide 7 still has AI-generated mockups with mangled
   text; the real app is strictly better
4. **₹ glyph missing in the deck** — slides 9 and 10 read "814 crore",
   "7,10,000 cr" with no currency symbol (LaTeX font issue)
5. **Backup video** — 60–90s local screen recording, insurance against dead wifi
6. **Rehearsal** — Vivek presents; he needs to have said it out loud
7. **Error boundary** — no `app/error.tsx`; an uncaught render error would
   white-screen the demo
8. Measured production decision latency is ~325ms warm — worth surfacing on the
   nudge card as a demonstrated claim
9. **`DATABASE_URL` on Vercel** — the Neon project exists
   (`autumn-poetry-48959969`, ap-southeast-1, branch `production`), migrations are
   applied and the local app writes to it. The deployed app only does once the
   pooled URL is in Vercel's env — check `/api/health` → `database.reachable`

---

## Gotchas that will bite again

- **Git identity**: `user.email` was unset, so git invented
  `arunkumar@Aruns-MacBook-Air.local` and Vercel blocked the deploy. Now set
  globally to `Arun Kumar <kumararun97429@gmail.com>`. Older commits keep the bad
  author; only the built commit matters.
- **Two Vercel accounts exist.** `arun-4367` was created by a device-code login
  and still holds an orphaned project. The live one is under
  **Arun Kumar's projects**.
- **zsh does not word-split unquoted variables** — `set -- $var` in a loop
  silently puts everything in `$1`. Cost two debugging rounds.
- **QR decoding needs Chrome** (`BarcodeDetector`); Safari has no support, so the
  merchant list below the viewfinder is the fallback.
