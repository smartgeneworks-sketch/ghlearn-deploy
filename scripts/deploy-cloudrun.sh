#!/usr/bin/env bash
# Deploy the GH Learn API to Google Cloud Run. Never prints secret values.
# Usage: scripts/deploy-cloudrun.sh <env-file>
#   <env-file>: KEY=VALUE lines (the Render env export). Keys matching SECRET_RE go to
#   Secret Manager; everything else becomes plain env vars. Requires an authenticated gcloud
#   (e.g. gcloud auth activate-service-account --key-file=...).
set -euo pipefail
ENV_FILE=${1:?usage: $0 <env-file>}
PROJECT=${PROJECT:-gh-curriculum-f31c9}
REGION=${REGION:-europe-west1}
SERVICE=${SERVICE:-ghlearn-api}
REPO=${REPO:-ghlearn}
RUNTIME_SA=${RUNTIME_SA:-ghlearn-run@${PROJECT}.iam.gserviceaccount.com}
MEMORY=${MEMORY:-1Gi} CPU=${CPU:-1} MIN=${MIN:-1} MAX=${MAX:-3}
SECRET_RE='(SECRET|PASSWORD|PASS|KEY|TOKEN|URI|URL|PASSPHRASE)$'
TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/api:${TAG}"
g() { gcloud --project "$PROJECT" --quiet "$@"; }
cd "$(dirname "$0")/.."

g services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com >/dev/null
g artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1 || \
  g artifacts repositories create "$REPO" --repository-format docker --location "$REGION"
g iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1 || \
  g iam service-accounts create "${RUNTIME_SA%%@*}" --display-name "GH Learn API runtime"

ENVS=() SECS=()
while IFS= read -r line || [ -n "$line" ]; do
  [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
  k=${line%%=*} v=${line#*=}; v=${v%\"}; v=${v#\"}
  [[ "$k" == PORT ]] && continue                       # Cloud Run sets PORT
  if [[ "$k" =~ $SECRET_RE ]]; then
    s="ghlearn-$(echo "$k" | tr 'A-Z_' 'a-z-')"
    g secrets describe "$s" >/dev/null 2>&1 || g secrets create "$s" --replication-policy automatic >/dev/null
    printf '%s' "$v" | g secrets versions add "$s" --data-file=- >/dev/null
    g secrets add-iam-policy-binding "$s" --member "serviceAccount:$RUNTIME_SA" --role roles/secretmanager.secretAccessor >/dev/null
    SECS+=("$k=$s:latest"); echo "secret: $k -> $s"
  else
    ENVS+=("$k=$v"); echo "env:    $k"
  fi
done < "$ENV_FILE"

g builds submit --tag "$IMAGE" .
IFS=@; ENV_ARG="${ENVS[*]}"; SEC_ARG="${SECS[*]}"; unset IFS    # '@' delimiter: values may contain commas
g run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" --service-account "$RUNTIME_SA" \
  --allow-unauthenticated --port 8080 --memory "$MEMORY" --cpu "$CPU" \
  --min-instances "$MIN" --max-instances "$MAX" --no-cpu-throttling --cpu-boost \
  --concurrency 80 --timeout 300 --execution-environment gen2 \
  ${ENV_ARG:+--set-env-vars "^@^$ENV_ARG"} ${SEC_ARG:+--set-secrets "^@^$SEC_ARG"}
URL=$(g run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')
echo "Deployed: $URL"; curl -fsS "$URL/api/health" && echo
