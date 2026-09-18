# n8n workflows

Four workflows. Together they cover webhook and schedule triggers, branching,
fan-out with batching, retries, error branches, external integration and
async side-effects — rather than one HTTP node pretending to be an orchestrator.

## Why self-hosted, not n8n Cloud

n8n Cloud cannot reach `localhost:3111`, so it would force us to deploy before
anything worked. Running n8n locally means **the entire demo works with the wifi
unplugged** — no venue network in the critical path.

```bash
npm install -g n8n
n8n start                      # editor at http://localhost:5678
```

Import all four:

```bash
n8n import:workflow --separate --input=./n8n
n8n update:workflow --id=<id> --active=true    # for the two webhook workflows
n8n start                                       # restart to register webhooks
```

`n8n list:workflow` prints the ids.

## 1 · Nudge pipeline (real-time)

`POST http://localhost:5678/webhook/one-tap-credit`

```
Transaction event ─> Decision engine ─> Eligible for a nudge?
                                          ├─ true  ─> Pick headline plan ─> Sarvam nudge copy
                                          │           ─> Attach copy ─> Respond ─> Log nudge shown
                                          └─ false ─────────────────────> Respond ─> Log nudge withheld
```

This is the pipeline the pitch describes: detection → decision → surfaced offer.

Three things worth pointing at during a demo:

- **The audit nodes run _after_ the Respond nodes.** Logging is a side-effect; it
  can never slow down or fail a payment.
- **`Sarvam nudge copy` has `onError: continueRegularOutput`.** If Sarvam is down,
  the error flows to `Attach copy`, which falls back to the engine's own summary.
  The checkout always renders something.
- **`Decision engine` retries once** before giving up.

The app calls this webhook by default and falls back to `/api/decide` after 3
seconds. The demo drawer shows which path actually served the response.

## 2 · Outcome recorder

`POST http://localhost:5678/webhook/one-tap-credit-outcome`

Accept or decline on the nudge card fires here, fire-and-forget. A Code node
validates the outcome before it reaches the trail, so a malformed call cannot
corrupt the digest. Retries three times — this one we _do_ want to land.

This closes the funnel: without it there is no acceptance rate.

## 3 · Sarvam copy pre-warm (nightly, 3am)

```
Every night at 3am ─┐
Run now (manual) ───┴─> Build combinations ─> Loop in batches of 3 ─> Warm the cache ─┐
                                                    ^                                 │
                                                    └─────────────────────────────────┘
                                             └─> Warm-up report
```

Generates copy for 60 combinations of category × language × amount band and
warms the server-side cache, in batches of three so Sarvam is never hammered.

Turns a checkout latency problem into an overnight batch problem — the nudge
card never waits on a language model. The report says whether Sarvam actually
answered or templates covered for it, which is worth knowing before a demo.

## 4 · Daily funnel digest (9am)

```
Every morning at 9am ─┐
Run now (manual) ─────┴─> Read the audit trail ─> Format digest ─> Convert to file ─> Write to disk
```

Reads `/api/audit?summary=true`, renders a markdown digest and writes it to
`.data/digest-YYYY-MM-DD.md`.

Every number comes from decisions the system actually made. It holds itself to
the same standard as the deck's projection slide: no invented traction.

Both scheduled workflows also carry a **manual trigger**, because a cron you
cannot fire on demand is undemoable.

## The audit trail

`.data/decisions.jsonl` — one JSON object per line, written by n8n, never by the
request path.

```bash
tail -f .data/decisions.jsonl
curl 'http://localhost:3111/api/audit?summary=true' | jq
```

This is slide 11's "human-readable audit trail on every nudge decision", made
real and external. A file rather than a database on purpose: no credentials, no
network, and `tail -f` during the demo is more convincing than a dashboard we
drew ourselves.
