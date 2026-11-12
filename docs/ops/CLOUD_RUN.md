# GH Learn API on Google Cloud Run (runbook)

Target: project `gh-curriculum-f31c9` (billing 01071A-8F4D68-CCBFBD), region `europe-west1` (Belgium).
europe-west1 is Tier-1 priced, supports Cloud Run domain mappings, and is a short hop from Ghana.
africa-south1 (Johannesburg) is not closer to Accra by network and does not support domain mappings.

## Service shape
- Image: repo-root `Dockerfile` (node:22-slim, `node dist/index.js`, listens on `$PORT`, default 8080).
- `--min-instances 1 --no-cpu-throttling` (instance-based billing). Required: the job queue
  (ingest, lesson generation, reminders, retention) runs in-process and needs CPU when no request is open.
- `--max-instances 3`. Safe: jobs are claimed with a Mongo lease (`lockedUntil`), so several instances never run the same job.
- `--memory 1Gi --cpu 1` (OCR/PDF work). 512Mi is possible but riskier.
- SIGTERM: `server/src/index.ts` closes the HTTP server and the Mongo connection, then exits (8 s hard cap).
  An interrupted job keeps its lease and is retried after the lease expires.
- `trust proxy` is 1 (one Google front end hop), so `req.ip` and rate limits work.
- Cookies: `COOKIE_DOMAIN=.ghlearn.com`, `COOKIE_SECURE=true`, same as Render. They work only once
  the API is served on api.ghlearn.com. On the *.run.app URL, browser login won't stick, but curl tests work.
- Secrets: keys ending in SECRET/PASSWORD/PASS/KEY/TOKEN/URI/URL/PASSPHRASE go to Secret Manager
  as `ghlearn-<key>`, mounted as env vars. Other keys are plain env vars. Values are never echoed.

## Deploy
```bash
# 1. Auth (service-account key the owner created, see below; keep it outside the repo)
gcloud auth activate-service-account --key-file=/home/box/.ghlearn-deploy/gcp-deployer.json
gcloud config set project gh-curriculum-f31c9
# 2. Env file = the full Render env (23 keys), saved at /home/box/.ghlearn-deploy/render.env (chmod 600)
scripts/deploy-cloudrun.sh /home/box/.ghlearn-deploy/render.env
```
The script enables the APIs, creates the Artifact Registry repo `ghlearn` and the runtime SA
`ghlearn-run@…` (secret accessor only), builds with Cloud Build, deploys, and curls `/api/health`.
Re-running it deploys a new revision and adds new secret versions.

## Atlas network access
Cloud Run has no fixed outbound IP unless you add a VPC connector and Cloud NAT (about $30+/month extra).
Render free also has no fixed IP, so Atlas almost certainly already allows `0.0.0.0/0`. The owner should
confirm this in Atlas → Network Access. If it does, nothing changes. If it doesn't, either add `0.0.0.0/0`
(auth is still enforced by user/password + TLS) or set up the VPC + NAT static IP.

## Budget alert
Billing → Budgets & alerts → Create: scope = project gh-curriculum-f31c9, all services,
amount e.g. $60/month, alerts at 50/90/100 % to the owner email. (The existing $10 budget covers Gemini;
make it a separate budget or raise it, or it will fire every month.)

## Cutover
1. Deploy and test on the run.app URL: `/api/health` shows db:true. Run a login via curl, check that a job runs,
   and confirm SMS/email in a staging check.
2. Set `WORKER_ENABLED=false` on ONE side only if both would run recurring jobs. Since the queue uses leases,
   running both briefly is safe, but turn Render's worker off at cutover.
3. Map the domain: `gcloud beta run domain-mappings create --service ghlearn-api --domain api.ghlearn.com --region europe-west1`
   (domain ownership must be verified for the deploying account in Search Console, or have the owner run it).
   Then at the DNS registrar, replace the api CNAME (currently to Render) with `CNAME api → ghs.googlehosted.com.`
   The managed TLS certificate takes 15–60 min. Alternatively keep DNS as-is and use a load balancer (costs more, not needed).
4. Watch the logs for 24 h (`gcloud run services logs read ghlearn-api --region europe-west1`).
5. Keep Render ghlearn-api running, unchanged, for 7 days as a rollback: point the CNAME back to Render.
   Then suspend it.

## Rollback
Point the `api` CNAME back to the Render host. To roll back a revision:
`gcloud run services update-traffic ghlearn-api --to-revisions <rev>=100 --region europe-west1`.

## Owner steps: deployer service account (one time, in console.cloud.google.com, project gh-curriculum-f31c9)
1. IAM & Admin → Service Accounts → Create: name `ghlearn-deployer`.
2. Grant these roles: Cloud Run Admin, Artifact Registry Administrator, Secret Manager Admin, Service Account User,
   Cloud Build Editor, Service Usage Admin (to enable APIs), Storage Admin (Cloud Build source bucket),
   Service Account Admin (only to create the runtime SA; remove it after the first deploy).
3. Open the account → Keys → Add key → JSON. Download it and send it securely (not in chat/email body).
   It is stored at /home/box/.ghlearn-deploy/gcp-deployer.json (chmod 600) and never committed.
4. After the cutover, delete the key (Keys → delete). Create a new one only when another deploy is needed.
