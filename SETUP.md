# Setup

## What runs where

| Piece | Job | If it's missing |
|---|---|---|
| **Next.js app** | The decision engine + UI | — |
| **n8n** | Runs the pipeline stage by stage; owns logging, retries, schedules | App calls `/api/decide` directly |
| **Sarvam** | Writes the nudge line in the user's language | Templates (hi/en/ta/bn) |
| **Cognee sidecar** | Remembers how each user answers offers | Local audit trail |

Nothing is a hard dependency. Every integration falls back to something that works.

---

## Run it locally

```bash
npm install && npm run dev        # http://localhost:3111
bash n8n/sync.sh                  # http://localhost:5678
cd cognee-service && npm start    # http://localhost:4000  (optional)
```

`npm test` → 53 tests. `npm run scenarios` → every demo case with its reasoning.

---

## Where the data lives

This is the part worth being precise about.

| Data | Volume | Where it lives now | Needs a database? |
|---|---|---|---|
| 6 personas, 8 merchants | tiny | Code (`lib/people.ts`, `lib/personas.ts`) | **No** — demo fixtures |
| Transaction ledgers | ~250 rows each | Generated at runtime from a seed | **No** — deterministic, never stored |
| Nudge history (frequency cap) | tiny | Browser `localStorage` | **No** — client owns it by design |
| Decision audit trail | grows | `.data/decisions.jsonl` | **Only for cloud** |
| Offer outcomes (memory) | tiny | `cognee-service/.data/outcomes.json` | **Only for cloud** |

**Locally, nothing needs a database.** Files work, and the ledgers regenerate from
a seed so there is nothing to persist.

**On Vercel, two of those break** — the filesystem is read-only and ephemeral, so
writes fall back to an in-process buffer that survives a warm lambda but not a cold
start. Good enough for a judge clicking through; not good enough for real use.

### Do you need Mongo / Cloudflare / a real DB?

**For the hackathon: no.** Adding a database the night before is another
credential, another failure mode, and the demo runs locally where files work.

**If you want cloud durability anyway**, the fastest option is **Upstash Redis** —
HTTP-based, so it works from Vercel functions *and* from n8n nodes with no
connection pooling. Free tier, about five minutes:

```bash
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Tell me and I'll swap the audit store's two functions over. Mongo Atlas and Neon
Postgres both work too; Redis is just the least ceremony for append-only data.

**Cognee is not a database.** It is a memory and knowledge-graph layer. Using it as
your system of record would mean running graph queries to count rows.

---

## Cognee

### What it actually is

`@cognee/cognee-ts` — a Node package wrapping a Rust engine through native
bindings. Not a REST API. Measured after installing it:

```
node_modules: 257 MB     binary: neon-darwin-arm64
```

**It cannot run on Vercel**: 257 MB against a 50 MB function limit, and a
darwin-arm64 binary on a linux-x64 runtime. So it runs as a sidecar, in
`cognee-service/`, and the app talks to it over HTTP.

It also needs **its own LLM key** — it extracts entities into a graph, and that
extraction runs on a model. `COGNEE_API_KEY` alone is not enough.

### What it does in the decision

One thing, and it is small and safe:

```
recallMemory(userId) → { acceptedCount, declinedCount, declinedCategories }
                     → relevance score adjustment
```

| Situation | Effect on relevance |
|---|---|
| Declined an offer in this category before | **−20** |
| Declined elsewhere | **−8** |
| Accepted before | **+5** |

Verified end to end, app → n8n → engine stages → sidecar:

```
rohit travel   : score 86   {  0, "No prior offer outcomes recalled"}
    ↓ declines a travel offer
after decline  : score 66   {-20, "declined a credit offer on travel before"}
```

**Memory only ever touches relevance.** It can make us less likely to interrupt
someone who keeps saying no. It can never unlock eligibility, affordability, or any
other hard gate — those stay deterministic.

### Why counts come from a ledger, not the graph

The sidecar writes every outcome twice: into Cognee's graph (semantic, explorable)
and into a structured ledger (exact). **`/recall` answers from the ledger.**

A graph query returns generated prose. Prose is a fine way to *explore* a user's
history and a terrible way to *justify* a lending decision — you cannot audit it,
and nothing stops it being subtly wrong. There is a `/ask` endpoint for querying
the graph in plain language; it is deliberately not wired into scoring.

### Running it

```bash
cd cognee-service
npm install
OPENAI_TOKEN=<key> npm start      # runs without a key too; graph is skipped
```

Then in the app: `COGNEE_SERVICE_URL=http://localhost:4000`

---

## n8n

n8n runs the pipeline **stage by stage**, so the canvas is the architecture:

```
Transaction event
  → Recall memory        what has this user done before?
  → Build profile        ledger → features → eligibility signal
  → Run gates            14 hard blocks, stops at the first failure
  → Score relevance      4 factors + the memory adjustment
  → Gates passed?    ──no──┐
  → Worth interrupting? ─no─┤
  → Build offer             │  → Assemble withheld → Respond → Log
  → Pick headline plan      │
  → Sarvam nudge copy       │
  → Assemble decision       │
  → Respond → Log decision ─┘
```

| # | Workflow | Trigger | Demonstrates |
|---|---|---|---|
| 1 | Decision pipeline (16 nodes) | Webhook | Branching, retries, error branches, async logging |
| 2 | Outcome recorder | Webhook | Validation, memory write, closing the funnel |
| 3 | Sarvam copy pre-warm | 3am + manual | Fan-out, batching |
| 4 | Daily funnel digest | 9am + manual | Aggregation, file output |

### Moving to n8n Cloud

```bash
npx vercel --prod                                    # 1. deploy — n8n Cloud can't reach localhost
node n8n/retarget.mjs https://your-app.vercel.app    # 2. writes n8n/cloud/
```

3. In n8n Cloud: **Workflows → Import from File**, import all four from `n8n/cloud/`
4. Open workflows **1** and **2** → toggle **Active** → copy each **Production URL**
5. Add those to Vercel and redeploy:

```
NEXT_PUBLIC_N8N_WEBHOOK_URL         = https://<instance>.app.n8n.cloud/webhook/one-tap-credit
NEXT_PUBLIC_N8N_OUTCOME_WEBHOOK_URL = https://<instance>.app.n8n.cloud/webhook/one-tap-credit-outcome
```

---

## Environment variables

```bash
# Sarvam — without it, nudge copy comes from templates and says so
SARVAM_API_KEY=

# Cognee sidecar — without it, memory falls back to the local audit trail
COGNEE_SERVICE_URL=http://localhost:4000
COGNEE_DATASET=one-tap-credit

# n8n — without these, the app calls /api/decide directly
NEXT_PUBLIC_N8N_WEBHOOK_URL=
NEXT_PUBLIC_N8N_OUTCOME_WEBHOOK_URL=
```

In the **sidecar** (`cognee-service/`), not the app:

```bash
OPENAI_TOKEN=<key>                    # Cognee's extraction model
OPENAI_URL=https://api.sarvam.ai/v1   # optional: let Sarvam be that model
MOCK_EMBEDDING=true                   # skips the embedding model download
```

---

## Demo day

**Night before:** `npm test` · `npx next build` · `bash n8n/sync.sh` · walk the flow once.

**Keep both paths.** Cloud is primary, local is the rehearsed fallback. If the venue
network dies, everything runs on `localhost` and the app falls back automatically.

**The n8n moment.** Open workflow 1 on the canvas in a second tab, then hit the app.
Sixteen nodes light up in sequence. Don't let that get lost mid-demo.

**Show restraint.** Switch to Priya: *eligible on paper, declined because ₹8,727/month
exceeds the ₹7,951 she can carry.* An engine that says no is more convincing than one
that always says yes.

---

## Troubleshooting

**Webhook 404 "not registered"** — workflow isn't active. `bash n8n/sync.sh`.

**Workflow edits don't take effect** — n8n 2.x has three sharp edges, all handled by
`sync.sh`: `import:workflow` clones unless the JSON has a top-level `id`; it always
deactivates on import; and activation fails silently unless `activeVersionId` matches
`versionId`.

**"URL path already taken"** — orphaned `webhook_entity` rows. `sync.sh` clears them.

**`n8n execute` says "Missing node to start execution"** — the CLI only starts from an
Execute Workflow Trigger. Workflows 3 and 4 have manual triggers; run them from the
canvas with **Test workflow**.

**The nudge stopped appearing** — you tapped "No thanks". Declines are respected for
seven days. The engine strip shows `Frequency Cap` with a **Reset** button.

**Memory always says `local-audit`** — `COGNEE_SERVICE_URL` unset or sidecar down.
Working as designed; the decision path never depends on memory.

---

## Map

```
app/api/
  decide/           whole pipeline in one call — the fallback path
  engine/profile    stage 1 · memory → features → eligibility signal
  engine/gates      stage 2 · the 14 hard blocks
  engine/score      stage 3 · relevance + memory adjustment
  engine/offer      stage 4 · product selection + EMI plans
  nudge-text/       Sarvam, with template fallback
  memory/recall     what do we remember about this user?
  memory/remember   record what they did with an offer
  audit/            the decision trail and its funnel summary

cognee-service/     the sidecar — the only place the native SDK lives
n8n/                4 workflows · sync.sh · retarget.mjs
```
