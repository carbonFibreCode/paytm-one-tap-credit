# One-Tap Credit

**Paytm Build for India AI Hackathon — Delhi Edition · Track 2: AI-Powered Financial Journeys**
Team1 — Arun Kumar, Vivek Goswami

A real-time decision layer that decides, at the moment of payment, whether to surface
pre-approved credit — and which product — so the customer never has to separately discover,
apply for and wait on a loan.

The novel piece is not the checkout screen. It is an engine that can **explain every decision it
makes, including the ones where it stays silent.**

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 32 engine tests, ~150ms
npm run scenarios    # prints every demo scenario with its reasoning
```

Nothing needs configuring. Without any API keys the app runs end to end on template copy and the
direct API path; keys upgrade those two slots in place. See `.env.example`.

---

## What's real and what's mocked

|                |                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Built here** | The decision engine, the memory/feature layer, the audit trail, the checkout UI, the orchestration wiring                                                   |
| **Mocked**     | Credit issuance, KYC, OTP, the partner-bank approval call — Paytm and its partner banks (SBI / HDFC / IDFC First / Suryoday) run this in production already |
| **Synthetic**  | Every user, merchant and transaction. Eligibility is a _simplified stand-in_ for Paytm's real underwriting, not an attempt to reproduce it                  |

Synthetic does not mean arbitrary. Each persona has a seeded transaction ledger, and every
behavioural signal is re-derived from those rows — see below.

---

## Architecture

```
checkout screen
   └─> n8n webhook ──> POST /api/decide ──> IF showNudge ──> POST /api/nudge-text
        (3s timeout,                                              (Sarvam, with
         auto-fallback)                                            template fallback)
   └─> POST /api/decide            [fallback path, identical result]
```

```
lib/
  memory/       ledger.ts     seeded transaction history per persona
                features.ts   detects salary + recurring obligations from the rows
                signal.ts     features -> eligibility signal, with a breakdown
  engine/       gates.ts      14 hard blocks, ordered, short-circuiting
                score.ts      4 weighted relevance factors
                product.ts    Postpaid vs card, deterministic
                emi.ts        tenures and exact-rounding schedules
                decide.ts     orchestrates the above
  nudge/        sarvam.ts     generation, validation, cache, fallback
                templates.ts  contextual copy in hi / en / ta / bn
```

**The engine is a pure function.** It reads no clock, no database and no environment — the caller
supplies the timestamp and the nudge history. Three consequences:

- the same request always produces the same decision, so it is reproducible in front of a judge
- frequency caps survive a serverless cold start, because history lives with the client
- it is trivially testable, which is why there are 32 tests and not 3

### The memory layer

The pitch rests on "the system already knows." That claim is backed rather than asserted:

- **Salary** is detected by finding repeated credits of a similar size across months — not read
  from config. Irregular freelance income is detected as _weaker_, which is the point.
- **Existing EMIs** are detected by finding the same merchant charging the same amount in three or
  more distinct months.
- Those two drive `affordabilityCapacity`, which is what the affordability gate checks.
- Account age and transaction count drive the cold-start gate.

So three of the fourteen gates are grounded in derived behaviour rather than a hardcoded flag.
Open the demo drawer → **"What the system already knows"** to see the ledger, the detections and
the resulting signal side by side.

### The gates

Ordered, short-circuiting; the first failure decides the outcome and no score overrides it.

`CATEGORY_PROHIBITED` · `MERCHANT_NOT_ENABLED` · `AMOUNT_FLOOR` · `AMOUNT_CEILING` ·
`CATEGORY_RELEVANCE` · `OPTED_OUT` · `COLD_START` · `NOT_ELIGIBLE` · `BANK_COOLOFF` ·
`FREQUENCY_CAP` · `NO_PRODUCT` · `ALREADY_ACTIVE` · `INSUFFICIENT_LIMIT` · `AFFORDABILITY`

Two worth calling out. **`CATEGORY_PROHIBITED`** blocks person-to-person transfers, wallet
top-ups, gambling and crypto outright — routing borrowed money into a cash-equivalent is what
lending rules exist to prevent. **`AFFORDABILITY`** declines users who _pass_ eligibility but whose
existing commitments leave no room; it is the gate that says we are not optimising for disbursal.

---

## API

All three endpoints are plain HTTP and callable from n8n.

### `POST /api/decide`

```jsonc
// request — merchantId, or merchantCategory for merchants outside the catalogue
{ "userId": "u_rohit", "merchantId": "m_kroma", "amount": 50000 }

// response
{
  "showNudge": true,
  "product": "postpaid",
  "score": 90,
  "amount": 50000,
  "blockedBy": null,
  "offer": {
    "partner": "Paytm Postpaid",
    "limit": 100000,
    "tenures": [
      { "months": 3, "emi": 16667, "lastEmi": 16666, "noCost": true, "interest": 0 },
      { "months": 6, "emi": 8727,  "lastEmi": 8727,  "noCost": false, "interest": 2362 }
    ]
  },
  "decline": { "label": "No thanks, pay normally", "suppressDays": 7 },
  "trace": { "gates": [], "factors": [], "productRationale": "", "counterfactual": "", "summary": "" },
  "eligibilitySignal": 86,
  "eligibilityBreakdown": []
}
```

A withheld nudge returns the same shape with `showNudge: false`, a `blockedBy` code and a
human-readable `blockedReason`. **No-nudge is a first-class response, not an error.**

### `POST /api/nudge-text`

Takes terms the engine has already settled and returns one line of copy. Always succeeds —
`source` is `sarvam`, `cache` or `template`, and `reason` says why if it fell back.

### `GET /api/health` · `GET /api/profile?userId=`

Health is for the n8n healthcheck. Profile returns the derived features plus the ledger they came
from.

---

## Sarvam

Sarvam's job is **phrasing, never deciding**. The engine settles what to offer and on what terms;
Sarvam says it well in the user's language. A language model must never be able to talk a user
into credit the engine did not approve.

Three protections wrap the call:

1. **A 2.5s timeout.** The nudge card animates in immediately with a shimmer on the copy line and
   fills when the text arrives. The offer never waits on a model.
2. **Output validation.** Any number the model introduces that we did not supply invalidates the
   response and the template runs instead. An LLM inventing "0% interest" or a wrong credit limit
   in a credit product is a compliance incident, not a typo. Indic digits are normalised first, so
   a Devanagari numeral is caught too.
3. **A cache**, pre-keyed by product, amount band, category and language.

Set `SARVAM_API_KEY` to go live. Without it every response is a template and says so.

---

## n8n

Import `n8n/one-tap-credit.workflow.json`, then replace `https://REPLACE-ME.vercel.app` in the two
HTTP Request nodes with your deployed URL. Copy the production webhook URL into
`NEXT_PUBLIC_N8N_WEBHOOK_URL`.

```
Transaction event (webhook)
  └─> Decision engine        POST /api/decide
      └─> Eligible?          IF showNudge
          ├─ true  ─> Pick headline plan ─> Sarvam nudge copy ─> Attach copy ─> Respond
          └─ false ─────────────────────────────────────────────────────────> Respond
```

n8n Cloud cannot reach `localhost`, so the app must be deployed before the orchestrated path
works. The checkout falls back to calling `/api/decide` directly after 3 seconds, and the demo
drawer shows which path actually served the response — so a dead network degrades silently
instead of breaking the demo.

If the import misbehaves, the workflow is six nodes and takes about five minutes to rebuild by
hand from the diagram above.

---

## Demo script

Open the drawer by tapping the avatar on the home screen. Each row is one tap.

| #   | Do this                                          | What happens                                        | The line to say                                                                          |
| --- | ------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Rohit → Kroma Electronics, ₹50,000               | Nudge: Postpaid, 3 × ₹16,667, no cost               | "The offer appears at the moment of paying, in Hindi, already priced."                   |
| 2   | Tap **Why am I seeing this?**                    | 14 checks, 4 score factors, 5 signal components     | "Every decision is auditable. That's slide 11, shipped."                                 |
| 3   | Keypad → change to ₹450                          | Nudge disappears, engine strip shows `AMOUNT_FLOOR` | "It declines more often than it offers."                                                 |
| 4   | Merchant → Rahul Sharma (P2P), ₹35,000           | `CATEGORY_PROHIBITED`                               | "No amount and no eligibility signal unlocks this one."                                  |
| 5   | Persona → Priya, ₹50,000                         | `AFFORDABILITY`, signal 70                          | "She _passes_ eligibility. We decline anyway — ₹8,727/month against ₹7,951 of capacity." |
| 6   | Persona → Aman                                   | `COLD_START` — 18 days, 8 transactions              | "Cold start is on our risk slide. Here it is, handled."                                  |
| 7   | Drawer → **What the system already knows**       | Ledger rows, detected salary, detected EMIs         | "This is where the eligibility number comes from. Nothing is hardcoded."                 |
| 8   | Back to Rohit ₹50,000 → Activate & Pay → confirm | Approval, schedule, success                         | "16,667 + 16,667 + 16,666 — it adds up to exactly ₹50,000."                              |
| 9   | Terminal: `npm test`                             | 32 passing in ~150ms                                | "And it's covered."                                                                      |

**Closing line:** _"The credit products already exist. The bank approvals already exist. What was
missing was the decision layer that knows when to ask — and, more often, when not to."_

---

## Testing

```bash
npm test        # 32 tests: every gate, product selection, EMI rounding, the audit trail
npm run scenarios
```

The EMI tests are worth a look — no-cost instalments must sum to the principal _exactly_, and the
final payment must never be the largest one.
