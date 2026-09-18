# Cognee sidecar — optional, and probably not needed

**Use Cognee Cloud instead.** It exposes a REST API (`X-Api-Key`, per-tenant base
URL), which the Next.js app calls directly — see `lib/memory/cognee.ts`. No extra
service, and it works from a Vercel function.

This sidecar exists for one case: running Cognee's **local** engine via
`@cognee/cognee-ts`, the native Node addon. That is 257 MB of platform-specific
binary, so it cannot live inside the app — hence a separate process.

Reach for it only if you want the knowledge graph on your own machine with no
cloud account:

```bash
npm install
OPENAI_TOKEN=<key> npm start     # needs an LLM to extract entities
```

Then point the app at it with `COGNEE_SERVICE_URL=http://localhost:4000`.

Otherwise ignore this folder.
