#!/usr/bin/env bash
# Publishes a code-only snapshot of HEAD to the PUBLIC deploy mirror that Render builds from.
# Then trigger a deploy (no webhook without the Render GitHub app): POST /v1/services/<id>/deploys, see docs/DEPLOYMENT.md.
# Render cannot read this private repo without its GitHub app, so the mirror is the deploy source.
# Excluded: git history, server/data/uploaded.jsonl (private Drive file ids), docs/CREDENTIALS.md. No secrets live in the repo.
set -euo pipefail
MIRROR=${MIRROR:-https://github.com/smartgeneworks-sketch/ghlearn-deploy.git}
SRC=$(git rev-parse --show-toplevel); SHA=$(git -C "$SRC" rev-parse --short HEAD)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
git -C "$SRC" archive HEAD | tar -x -C "$TMP"
rm -f "$TMP/server/data/uploaded.jsonl" "$TMP/docs/CREDENTIALS.md"
printf '# ghlearn-deploy\n\nRead-only, code-only deploy mirror of the private `ghlearn` repo (snapshot %s). Do not open PRs here.\nNo secrets are stored in this repository; runtime configuration lives in Render environment variables.\n' "$SHA" > "$TMP/MIRROR.md"
cd "$TMP" && git init -q -b main && git add -A && git -c user.name="${GIT_NAME:-ghlearn deploy}" -c user.email="${GIT_EMAIL:-deploy@ghlearn.invalid}" commit -qm "Deploy snapshot $SHA"
git push -q --force "$MIRROR" main
echo "mirror updated to $SHA"
