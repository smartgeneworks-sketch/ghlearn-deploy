#!/usr/bin/env bash
# Pull an encrypted backup export from the live API (POST /api/admin/system/backup) and keep the newest 6.
#   scripts/backup/pull-backup.sh                 # full export (includes embedding chunks)
#   EXCLUDE_CHUNKS=1 scripts/backup/pull-backup.sh  # skip embedding chunks (regenerable by re-processing manuals)
# Credentials come from $SECRETS_ENV (default /home/box/.ghlearn-deploy/secrets.env):
#   BACKUP_ADMIN_EMAIL (default smartgeneworks@gmail.com, the owner super admin) and BACKUP_ADMIN_PASSWORD.
#   $GHLEARN_OWNER_PASSWORD in the environment, if set, overrides BACKUP_ADMIN_PASSWORD. No SEED_PASSWORD fallback.
# The file stays encrypted (AES-256-GCM, key from BACKUP_PASSPHRASE). It is verified (tag + counts) before it is kept.
# Restore: node server/scripts/backup-restore.mjs restore <file> <mongodb-uri> [--drop]. Nothing secret is printed.
set -euo pipefail
API=${API:-https://api.ghlearn.com}; ORIGIN=${ORIGIN:-https://ghlearn.com}
DEST=${DEST:-/home/box/backups/ghlearn}; KEEP=${KEEP:-6}
SECRETS_ENV=${SECRETS_ENV:-/home/box/.ghlearn-deploy/secrets.env}; export SECRETS_ENV
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
get() { sed -n "s/^$1=//p" "$SECRETS_ENV" | tail -1 | sed "s/^[\"']//; s/[\"']$//"; }
EMAIL=$(get BACKUP_ADMIN_EMAIL); EMAIL=${EMAIL:-smartgeneworks@gmail.com}
PW=${GHLEARN_OWNER_PASSWORD:-$(get BACKUP_ADMIN_PASSWORD)}
[ -n "$PW" ] || { echo "no GHLEARN_OWNER_PASSWORD env or BACKUP_ADMIN_PASSWORD in $SECRETS_ENV" >&2; exit 1; }
[ -n "$(get BACKUP_PASSPHRASE)" ] || { echo "no BACKUP_PASSPHRASE in $SECRETS_ENV (needed to verify)" >&2; exit 1; }

mkdir -p "$DEST"; chmod 700 "$DEST"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; umask 077
J="$T/cookies"; H=(-H "Origin: $ORIGIN" -H 'Content-Type: application/json')
CSRF=$(curl -fsS -c "$J" -b "$J" "${H[@]}" "$API/api/auth/csrf" | python3 -c 'import json,sys;print(json.load(sys.stdin)["csrfToken"])')
EMAIL="$EMAIL" PW="$PW" python3 -c '
import json,os; print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PW"]}))' > "$T/login.json"
code=$(curl -sS -o "$T/login.out" -w '%{http_code}' -c "$J" -b "$J" "${H[@]}" -H "X-CSRF-Token: $CSRF" --data @"$T/login.json" "$API/api/auth/login")
rm -f "$T/login.json"; [ "$code" = 200 ] || { echo "login as $EMAIL failed: HTTP $code" >&2; exit 1; }

STAMP=$(date -u +%Y%m%dT%H%M%SZ); SUFFIX=$([ "${EXCLUDE_CHUNKS:-0}" = 1 ] && echo -nochunks || true)
OUT="$DEST/ghlearn-$STAMP$SUFFIX.glbk"; PART="$OUT.part"
echo "downloading backup as $EMAIL ..."
code=$(curl -sS --max-time 3600 -o "$PART" -w '%{http_code}' -c "$J" -b "$J" "${H[@]}" -H "X-CSRF-Token: $CSRF" \
  --data "{\"excludeChunks\":$([ "${EXCLUDE_CHUNKS:-0}" = 1 ] && echo true || echo false)}" "$API/api/admin/system/backup")
if [ "$code" != 200 ]; then echo "export failed: HTTP $code $(head -c 300 "$PART")" >&2; rm -f "$PART"; exit 1; fi
curl -sS -o /dev/null -b "$J" "${H[@]}" -H "X-CSRF-Token: $CSRF" -X POST "$API/api/auth/logout" || true

echo "verifying ..."
(cd "$ROOT/server" && node scripts/backup-restore.mjs verify "$PART") > "$T/verify.txt" || { cat "$T/verify.txt" >&2; echo "verification failed; kept nothing" >&2; rm -f "$PART"; exit 1; }
mv "$PART" "$OUT"; cp "$T/verify.txt" "${OUT%.glbk}.counts.txt"
tail -1 "$T/verify.txt"
# retention: newest $KEEP exports (and their count files)
ls -1t "$DEST"/ghlearn-*.glbk 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old" "${old%.glbk}.counts.txt"; echo "pruned $(basename "$old")"; done
echo "saved $OUT ($(du -h "$OUT" | cut -f1), $(stat -c %s "$OUT") bytes)"
