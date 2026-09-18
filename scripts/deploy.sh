#!/usr/bin/env bash
# Deploy to Vercel and push the environment variables from .env.local.
#
# Run `npx vercel login` first — that step needs a browser and cannot be
# automated. Everything after it is handled here.
#
# Secrets are piped straight from .env.local into `vercel env add`; nothing is
# printed to the terminal.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! npx --yes vercel whoami >/dev/null 2>&1; then
  echo "Not logged in. Run: npx vercel login"
  exit 1
fi

echo "→ deploying"
URL="$(npx --yes vercel --prod --yes 2>&1 | tee /dev/stderr | grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app' | tail -1)"

if [ -z "$URL" ]; then
  echo "Could not determine the deployment URL — check the output above."
  exit 1
fi

echo
echo "→ pushing environment variables"

# Server-side secrets only. The NEXT_PUBLIC_N8N_* values in .env.local point at
# localhost, which is useless in production — they get set once n8n Cloud exists,
# and until then the app uses its direct decision path.
for VAR in COGNEE_API_URL COGNEE_API_KEY COGNEE_DATASET SARVAM_API_KEY; do
  VALUE="$(grep -E "^${VAR}=" .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'' || true)"
  if [ -z "$VALUE" ]; then
    echo "   $VAR — not set locally, skipping"
    continue
  fi
  npx --yes vercel env rm "$VAR" production --yes >/dev/null 2>&1 || true
  printf '%s' "$VALUE" | npx --yes vercel env add "$VAR" production >/dev/null 2>&1 \
    && echo "   $VAR — set" \
    || echo "   $VAR — FAILED"
done

echo
echo "→ redeploying so the new variables take effect"
npx --yes vercel --prod --yes >/dev/null 2>&1

echo
echo "Deployed: $URL"
echo
echo "Next:"
echo "  node n8n/retarget.mjs $URL"
echo "  then import n8n/cloud/*.json into n8n Cloud"
