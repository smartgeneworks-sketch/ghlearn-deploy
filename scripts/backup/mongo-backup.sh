#!/usr/bin/env bash
# Encrypted MongoDB backup of the GH Learn app database.
#   mongodump (gzip, one archive file) -> AES-256 (openssl, PBKDF2) with BACKUP_PASSPHRASE -> keep the newest $KEEP.
# Needs: mongodump (MongoDB Database Tools), openssl, and network access to the cluster (TCP 27017).
# Config (environment or /home/box/.ghlearn-deploy/secrets.env):
#   MONGODB_URI        connection string of the app database (never printed)
#   BACKUP_PASSPHRASE  encryption passphrase (generated into secrets.env on first run if missing; never printed)
#   BACKUP_DIR         default /home/box/backups/ghlearn      KEEP  default 6
#   EXCLUDE_HEAVY=1    also skip chunks and documentpages (regenerable by re-processing manuals, but that takes hours and AI quota)
# Always skipped (short-lived, regenerable): refreshtokens, phoneotps, passwordresets, errorevents.
# Restore: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in FILE | mongorestore --uri "$TARGET_URI" --archive --gzip
set -euo pipefail
SECRETS=${SECRETS:-/home/box/.ghlearn-deploy/secrets.env}
if [ -f "$SECRETS" ]; then set -a; . "$SECRETS"; set +a; fi
: "${MONGODB_URI:?MONGODB_URI is not set}"
if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  umask 077; BACKUP_PASSPHRASE=$(openssl rand -base64 36 | tr -d '\n'); printf 'BACKUP_PASSPHRASE=%s\n' "$BACKUP_PASSPHRASE" >> "$SECRETS"
  echo "created BACKUP_PASSPHRASE in $SECRETS (keep a copy somewhere safe: without it the backups cannot be read)"
fi
export BACKUP_PASSPHRASE
PATH="$PATH:/home/box/tools/mongodb-database-tools-debian12-x86_64-100.13.0/bin"
BACKUP_DIR=${BACKUP_DIR:-/home/box/backups/ghlearn}; KEEP=${KEEP:-6}
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
EXC=(refreshtokens phoneotps passwordresets errorevents); [ "${EXCLUDE_HEAVY:-0}" = 1 ] && EXC+=(chunks documentpages)
ARGS=(); for c in "${EXC[@]}"; do ARGS+=(--excludeCollection "$c"); done
OUT="$BACKUP_DIR/ghlearn-$(date -u +%Y%m%dT%H%M%SZ).archive.gz.enc"; TMP="$OUT.partial"
trap 'rm -f "$TMP"' EXIT
# The URI goes to mongodump through a config file so it never shows in the process list.
CFG=$(mktemp); chmod 600 "$CFG"; trap 'rm -f "$TMP" "$CFG"' EXIT; printf 'uri: "%s"\n' "$MONGODB_URI" > "$CFG"
mongodump --config "$CFG" --archive --gzip "${ARGS[@]}" --quiet \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$TMP"
mv "$TMP" "$OUT"; chmod 600 "$OUT"
ls -1t "$BACKUP_DIR"/ghlearn-*.archive.gz.enc | tail -n +$((KEEP + 1)) | xargs -r rm -f --
echo "backup $OUT $(du -h "$OUT" | cut -f1); kept $(ls -1 "$BACKUP_DIR"/ghlearn-*.archive.gz.enc | wc -l) of max $KEEP"
