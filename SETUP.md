# Setup — n8n, Cognee, Sarvam, Vercel

Everything you need to plug credentials in and get the full stack running.
No CLI spelunking: each part says what it is, why it exists, and exactly what to click.

---

## The big picture

Four pieces, each with a clear job.

```
                  ┌──────────────────────────────────────────┐
  Paytm app  ───► │  n8n  ·  the machinery                   │
  (Vercel)        │  runs the decision pipeline stage by     │
       ▲          │  stage, and owns every side-effect       │
       │          └───┬──────────┬──────────┬─────────┬──────┘
       │              │          │          │         │
       │         ┌────▼───┐ ┌────▼────┐ ┌───▼────┐ ┌──▼─────┐
       │         │ Memory │ │ Engine  │ │ Sarvam │ │ Audit  │
       │         │ Cognee │ │ 4 stages│ │  copy  │ │ trail  │
       │         └────────┘ └─────────┘ └────────┘ └────────┘
       │                                                │
       └────────────────  decision + copy  ─────────────┘
```

| Piece | Job | Without it |
|---|---|---|
| **n8n** | Orchestrates every stage; owns logging, retries, schedules | App calls `/api/decide` directly — still works |
| **Cognee** | Remembers how each user answers offers | Falls back to the local audit trail |
| **Sarvam** | Writes the nudge line in the user's language | Falls back to templates |
| **Vercel** | Hosts the app and the engine stages | Runs on `localhost:3111` |

**Nothing is a hard dependency.** Every integration degrades to a working fallback,
which is deliberate: the demo must survive a dead venue network.

---

## Part 1 · n8n

### What it does here

n8n is not a proxy in this project. It runs the decision pipeline **stage by stage**,
so the canvas is the architecture diagram:

```
Transaction event
  → Recall memory        ask Cognee what this user did before
  → Build profile        ledger → behavioural features → eligibility signal
  → Run gates            14 hard blocks, stops at the first failure
  → Score relevance      4 weighted factors + the memory adjustment
  → Gates passed?    ──no──┐
  → Worth interrupting? ─no─┤
  → Build offer             │  → Assemble withheld → Respond → Log
  → Pick headline plan      │
  → Sarvam nudge copy       │
  → Assemble decision       │
  → Respond → Log decision ─┘
```

Four workflows in total:

| # | Name | Trigger | What it proves |
|---|---|---|---|
| 1 | Decision pipeline | Webhook | Branching, retries, error branches, async logging |
| 2 | Outcome recorder | Webhook | Validation, Cognee write, the funnel closing |
| 3 | Sarvam copy pre-warm | Schedule 3am + manual | Fan-out, batching, rate limiting |
| 4 | Daily funnel digest | Schedule 9am + manual | Aggregation, file output |

### Running it locally (already working)

```bash
bash n8n/sync.sh
```

One command: imports the workflows, activates the two webhook ones, restarts n8n.
Editor at **http://localhost:5678**.

First visit asks you to create an owner account — any email and password, it is
your machine.

### Moving it to n8n Cloud

**Step 1 — deploy the app first.** n8n Cloud cannot reach your laptop.

```bash
npx vercel --prod
```

**Step 2 — retarget the workflows** to the deployed URL:

```bash
node n8n/retarget.mjs https://your-app.vercel.app
```

This writes cloud-ready copies into `n8n/cloud/`. The originals keep pointing at
localhost so the offline demo still works.

> Done as a build step rather than with n8n Variables on purpose — `$vars` is a
> paid n8n Cloud feature, and a demo should not depend on a billing tier.

**Step 3 — import into n8n Cloud** (browser):

1. **Workflows → Import from File**
2. Import all four files from `n8n/cloud/`
3. Open workflow **1** and workflow **2**, toggle **Active** (top right)
4. On each, click the Webhook node and copy the **Production URL**

**Step 4 — point the app at n8n.** In Vercel → Settings → Environment Variables:

```
NEXT_PUBLIC_N8N_WEBHOOK_URL         = https://<instance>.app.n8n.cloud/webhook/one-tap-credit
NEXT_PUBLIC_N8N_OUTCOME_WEBHOOK_URL = https://<instance>.app.n8n.cloud/webhook/one-tap-credit-outcome
```

Redeploy. The checkout now calls n8n first and falls back to `/api/decide` after
3 seconds. The demo drawer shows which path actually served each response.

---

## Part 2 · Cognee

### What it actually is

**Cognee is not a REST API.** It is `@cognee/cognee-ts`, a Node package wrapping a
Rust engine through native bindings. You install it and call it in-process:

```ts
import { init, Cognee } from '@cognee/cognee-ts';

init();
const c = new Cognee({ llmModel: 'gpt-4o-mini', llmApiKey: process.env.OPENAI_TOKEN });
await c.warm();

await c.remember({ type: 'text', text: 'User u_rohit declined a postpaid offer on electronics.' }, 'one-tap-credit');
const result = await c.recall('What has u_rohit done with credit offers?');
```

Two measured facts shape everything below. I installed it to check:

```
node_modules: 257 MB        binary: neon-darwin-arm64
```

**1. It cannot run on Vercel.** 257 MB of platform-specific native binary against a
50 MB compressed function limit, on a linux-x64 runtime when the binary here is
darwin-arm64. This is not a tuning problem.

**2. It needs an LLM key of its own.** Cognee does not merely store text — it
extracts entities and relationships into a knowledge graph, and that extraction
runs on an LLM. `COGNEE_API_KEY` alone is not enough; it also needs `OPENAI_TOKEN`.

Because `OPENAI_URL` accepts any OpenAI-compatible endpoint, **Sarvam can be
Cognee's extraction model** — one sponsor powering another. Worth trying; keep a
fallback.

### So Cognee runs as a sidecar

```
Vercel app  ──HTTP──►  cognee-service/  ──►  knowledge graph
n8n Cloud   ──HTTP──►  (Node + SDK)     ──►  structured ledger
```

It already exists in this repo at **`cognee-service/`**, and it already works:

```bash
cd cognee-service
npm install          # pulls the 257 MB native addon
OPENAI_TOKEN=<key> npm start
```

Then point the app at it:

```bash
COGNEE_SERVICE_URL=http://localhost:4000
```

Three endpoints: `POST /remember`, `POST /recall`, and `POST /ask` (plain-language
questions against the graph — good for the demo, not wired into scoring).

**It runs without credentials.** Start it with no `OPENAI_TOKEN` and the graph is
skipped while the ledger still answers, so nothing is blocked waiting on keys.

### Why counts come from a ledger, not from the graph

Every outcome is written twice: into Cognee's knowledge graph (semantic, good for
exploring and visualising) and into a small structured ledger on disk (exact, good
for arithmetic). **`/recall` answers from the ledger.**

That is deliberate. A graph query returns generated prose, and prose is a terrible
basis for a lending decision — you cannot audit it, and nothing stops it being
subtly wrong. The graph is what you *explore*; the ledger is what moves a score.
It is the same separation the engine already makes between Sarvam writing copy and
the engine making decisions.

### Where to run the sidecar

| Option | Good for | Notes |
|---|---|---|
| Your laptop | The demo | Zero cost, zero latency; n8n Cloud cannot reach it |
| Railway / Render / Fly | Cloud demo | Supports native modules; free tier is enough |
| Skip it | Safety | The local audit fallback already works |

### Environment variables

```bash
# In the Next.js app — unset means "use the local audit fallback".
COGNEE_SERVICE_URL=http://localhost:4000
COGNEE_DATASET=one-tap-credit

# In the sidecar — Cognee needs an LLM to build the graph.
OPENAI_TOKEN=<key>
OPENAI_URL=https://api.sarvam.ai/v1     # optional: use Sarvam as the extraction model
OPENAI_MODEL=sarvam-m
MOCK_EMBEDDING=true                     # skips the embedding model download
```

### What memory is allowed to do

Two rules, enforced in code, worth saying out loud to a judge:

- **Memory supplies facts, never judgements.** What comes back is counts and
  categories — "declined twice, once on electronics" — never prose. There is
  nothing for a retrieval layer to hallucinate into a lending decision.
- **Memory adjusts relevance only.** It can make us less likely to interrupt
  someone who keeps saying no. It can never unlock eligibility, affordability, or
  any other hard gate. Those stay deterministic.

Verified running through the whole chain — app → n8n → engine stages → sidecar:

```
rohit travel   : score 86   {  0, "No prior offer outcomes recalled"}   backend=cognee
    ↓ user declines a travel offer
after decline  : score 66   {-20, "declined a credit offer on travel before"}  backend=cognee
```

## Part 3 · Sarvam

One variable:

```bash
SARVAM_API_KEY=<key>
```

Without it every nudge line comes from the template bank and `source` says
`template`. With it, Sarvam writes the line and `source` says `sarvam`.

Three protections wrap the call, and they stay in force either way:

1. **2.5s timeout** — the nudge card renders immediately with a shimmer on the copy
   line. The offer never waits on a language model.
2. **Output validation** — any number the model introduces that we did not supply
   invalidates the response and the template runs instead. An LLM inventing
   "0% interest" in a credit product is a compliance incident, not a typo.
   Devanagari numerals are normalised first, so `१६,६६७` is caught too.
3. **Cache** — keyed by product, amount band, category and language.

---

## Part 4 · Vercel

```bash
npx vercel --prod
```

Then add the environment variables above in **Settings → Environment Variables**
and redeploy.

### Two things that behave differently in the cloud

**The audit trail.** Locally it is `.data/decisions.jsonl`, a real file you can
`tail -f` during a demo. Vercel's filesystem is read-only and ephemeral, so writes
fall back to an in-process buffer that survives a warm lambda but not a cold start.
**This is the argument for Cognee being the durable store in production**, and it is
an honest thing to say rather than a limitation to hide.

**The Sarvam cache** is per-lambda-instance, so the nightly pre-warm helps less in
the cloud than it does on a single local server. The timeout and fallback still
protect the user experience.

---

## Part 5 · Demo-day runbook

**The night before**

```bash
npm test              # 53 tests, ~1s
npx next build        # must be clean
bash n8n/sync.sh      # n8n up with all four workflows
```

Open http://localhost:3111 and walk the full flow once.

**Have both paths ready.** Cloud is the primary; local is the rehearsed fallback.
If the venue network dies, everything still runs on `localhost` with templates and
the local audit trail — and the app falls back automatically, without you touching
anything.

**The n8n moment.** Open workflow 1 on the canvas in a second tab, then hit the app.
Watch sixteen nodes light up in sequence. That is the fifteen seconds that wins the
n8n prize — do not let it get lost mid-demo.

**Show restraint.** Switch to Priya and watch it refuse: *eligible on paper, declined
because ₹8,727/month exceeds the ₹7,951 she can carry.* An engine that says no is
more convincing than one that always says yes.

---

## Part 6 · Troubleshooting

### n8n

**A webhook returns 404 "not registered."**
The workflow is not active. `bash n8n/sync.sh` fixes it. If you activated in the UI
instead, that works too.

**Changes to a workflow file do not appear after importing.**
n8n 2.x has three sharp edges here, all handled by `sync.sh`:
- `import:workflow` *clones* rather than updates unless the JSON has a top-level `id`
- it always **deactivates** what it imports, ignoring the `active` field in the file
- activation silently fails unless `activeVersionId` matches the current `versionId`

**"The URL path that the Webhook node uses is already taken."**
Orphaned rows in `webhook_entity` from a deleted workflow. `sync.sh` clears them.

**`n8n execute --id=...` says "Missing node to start execution."**
The CLI only starts from an Execute Workflow Trigger. Workflows 3 and 4 carry a
**manual trigger** for exactly this reason — run them from the canvas with
**Test workflow**.

### The app

**The nudge stopped appearing.**
You probably tapped *"No thanks, pay normally"*. That is recorded, and the engine
respects a decline for seven days — which is the feature working. The engine strip
shows `Frequency Cap` with a **Reset** button next to it.

**"Could not score this transaction."**
The amount is zero or invalid. Type a real amount.

### Cognee

**Memory always reads `local-audit`.**
`COGNEE_SERVICE_URL` is unset, or the sidecar is unreachable. The fallback is
working as designed — the decision path never depends on memory being up.

**The sidecar will not start.**
It needs an LLM key (`OPENAI_TOKEN`). Set `MOCK_EMBEDDING=true` to skip the
embedding model download while testing.

---

## Where things live

```
cognee-service/      the memory sidecar — the only place the native SDK lives
  server.mjs         /remember · /recall · /ask

app/api/
  decide/            whole pipeline in one call — the fallback path
  engine/profile     stage 1 · memory → features → eligibility signal
  engine/gates       stage 2 · the 14 hard blocks
  engine/score       stage 3 · relevance + memory adjustment
  engine/offer       stage 4 · product selection + EMI plans
  nudge-text/        Sarvam, with template fallback
  memory/recall      what do we remember about this user?
  memory/remember    record what they did with an offer
  audit/             the decision trail, and its funnel summary

n8n/
  01-nudge-pipeline.json     16 nodes · the staged decision pipeline
  02-outcome-recorder.json    4 nodes · audit + Cognee write
  03-copy-prewarm.json        6 nodes · nightly Sarvam fan-out
  04-daily-digest.json        6 nodes · funnel digest to disk
  sync.sh                     import + activate + restart, in one command
  retarget.mjs                rewrite URLs for cloud deployment
  README.md                   what each workflow does, node by node
```
