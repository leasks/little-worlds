# Scheduling and controlled deployment (Phase 6)

Implementation is prepared and validated locally. No Vercel deployment, hosted
Supabase migration, paid resource or live Groq request was performed. A successful
local build/preflight does not establish hosted connectivity or deployed readiness.
Remote provisioning, migrations and deployment require explicit operator approval.
Do not enable a Git deployment integration before that approval.

## Runtime configuration

Node 24, Next.js App Router and PostgreSQL are used. Vercel needs no Docker or
persistent filesystem. All authoritative state, tick receipts, sessions, budgets
and scheduler attempts live in PostgreSQL. Keep the migration owner separate from
the runtime login. Required values belong in secure platform settings, never Git:

| Setting | Purpose |
|---|---|
| DATABASE_URL | Dedicated restricted PostgreSQL runtime login; verified TLS outside loopback |
| APP_ORIGIN | Exact HTTPS browser origin, scheme + host, with no wildcard |
| CRON_SECRET | Separate random secret of 32–256 characters; not an agent/operator key |
| CRON_WORLD_ID | UUID of the one live village this scheduler may advance |
| CRON_MAX_STEPS | Optional catch-up cap, 1–96, default 96 |
| CRON_EXPECTED_INTERVAL_MS | Expected job cadence for health/capacity checks, default 300000 |
| LOCAL_TEST_TOOLS_ENABLED | Leave unset/false on hosted deployments |
| GROQ_API_KEY / GROQ_MODEL | Optional, server-only; missing either disables the separate narrator worker |

Supabase service-role/anonymous keys are not required by this direct PostgreSQL
adapter and must not be put in client bundles. Agent/operator keys are provisioned
as hashed DB records; they are not an environment-variable authentication bypass.

## Approved Supabase setup

These steps describe a future approved operation; they were not run remotely.
Use a new/verified private Supabase project, choose an appropriate region, and
confirm network access and backup/retention requirements before creating resources.
For an existing world, pause writes and take/test a backup before migration.

1. Store a migration-owner connection URL privately as MIGRATION_DATABASE_URL.
   For psql use sslmode=verify-full. The Node migration tool also enforces verified
   remote TLS, including when supplied a require-style URL. Never disable TLS or
   alter package/checksum verification to work around a connection error.
2. Review all SQL migrations and run only after explicit approval:

   ```sh
   DATABASE_URL="$MIGRATION_DATABASE_URL" npm run db:migrate -- --remote-approved
   DATABASE_URL="$MIGRATION_DATABASE_URL" npm run db:seed -- --remote-approved
   ```

   The runner uses a transaction, advisory migration lock and immutable SHA-256
   ledger. It does not run automatically during build/start. Applied migrations
   must not be edited. Conflicting pre-existing role/schema names need investigation,
   not blind replacement. The first seed preserves an existing world.
3. As that migration owner, review/apply supabase/operations/runtime-login.sql:

   ```sh
   PGDATABASE="$MIGRATION_DATABASE_URL" psql -v ON_ERROR_STOP=1 -f supabase/operations/runtime-login.sql
   PGDATABASE="$MIGRATION_DATABASE_URL" psql -c '\password little_worlds_app'
   ```

   psql prompts for the new password privately. The SQL creates a non-owner LOGIN
   role with inherited little_worlds_runtime permissions and no superuser,
   CREATEROLE, CREATEDB or BYPASSRLS capability. It contains no password. A role
   name collision fails safely; do not replace an unknown existing login.
4. Obtain the project's supported direct/session-pooler connection URL for that
   custom login. For a Supabase pooler, use its documented project-qualified
   username and actual hostname/port; do not infer them. Store the URL/password as
   the application DATABASE_URL, not the migration-owner URL. Confirm network
   reachability from the intended hosting region. No paid IPv4/network option is
   assumed. Direct and pooler routes still need their own hosted validation.
5. Generate separate operator/caretaker/narrator secrets securely. Provision the
   selected roles under the reviewed administrative connection, for example:

   ```sh
   # WORLD_ID and OPERATOR_API_KEY must already be set securely.
   AGENT_ROLE=operator DATABASE_URL="$MIGRATION_DATABASE_URL" npm run caretaker:credential -- --remote-approved
   ```

   Use the same pattern for caretaker/narrator with their distinct variables from
   API.md/NARRATOR.md. The defaults remain local-only without --remote-approved.
   Narrative settings can be applied under the same approved-owner workflow using
   `npm run narrator:settings -- --remote-approved`. Do not give this owner URL to
   external agents or the web runtime. Do not enter secret values in chat.

Outside loopback, the runtime uses verified TLS and checks each new pooled
connection before handing it to repositories. It rejects privileged session/current
roles, table owners and roles without inherited runtime membership. Remote
connections avoid startup SET ROLE options, which some poolers cannot preserve.
Local Compose owner URLs are explicitly narrowed with SET ROLE for development.
Use standard system CA trust, or a trusted NODE_EXTRA_CA_CERTS path when required;
connection-string certificate overrides/disabled verification are rejected. A pooler
may terminate TLS before its internal DB hop, so pg_stat_ssl's observed backend
flag is diagnostic, not proof of the client-to-pooler TLS segment.

## Preflight before enabling a scheduler

Set the application values above in a secure shell/environment. Then:

```sh
npm ci
npm run typecheck
npm run build
npm run deploy:preflight
```

The preflight is read-only. It checks runtime role restrictions, history write
permissions, RLS, required migrated-table availability, an active operator credential,
a live/non-archived scheduler world, origin settings and catch-up capacity. The
configured maximum must exceed normal steps due per job so downtime can drain.
It does not deploy, call Groq, create a cron job or establish Vercel plan support.
No hosted preflight was run in this task because no deployment credentials/target
are configured. Browser/SQL tests use only the existing local development database.

## Choose one scheduler

**Vercel cron:** vercel.json declares GET /api/cron/tick every five real minutes
(`*/5 * * * *`, UTC). The route uses the Node runtime with maxDuration 60 seconds.
Vercel sends Authorization: Bearer CRON_SECRET when that project secret is set.
Confirm the current plan supports the chosen frequency before deployment; no free
tier, billing change or paid resource is assumed. If it does not, omit the crons
entry in the reviewed deployment configuration and use the external worker below.
Do not silently slow simulation or purchase a plan to satisfy configuration.

After approval, deploy through the operator's selected Vercel project/workflow,
with the production variables and restricted login. No deployment command has been
run here. Verify unauthenticated /api/operator is denied, cookie login works over
HTTPS, and authenticated scheduler/health calls succeed. Confirm actual run records
at the operator desk; merely saving configuration does not prove execution.

**External one-shot worker:** a separate Ubuntu/Mac mini host can invoke the same
private endpoint without database credentials, Groq or any agent framework:

```sh
# Set VILLAGE_URL and CRON_SECRET securely on the worker host.
npm ci
npm run tick
npm run scheduler:health
```

The worker prints its non-secret request ID before sending, uses a 30-second
request timeout, refuses non-loopback HTTP/redirects and retries at most three times
with the SAME ID and bounded backoff. Preserve TICK_REQUEST_ID for an uncertain
retry: `TICK_REQUEST_ID='<recorded-id>' npm run tick`. A long Retry-After is deferred,
never shortened. A new scheduled invocation represents a new current-time tick.
No client can supply world ID, virtual/real time, multiplier or catch-up size.

Optional systemd unit/timer examples are in ops/. Review host paths/user/Node 24
installation, then install only on an authorised worker host. The example expects
/srv/little-worlds and a little-worlds user. Keep /etc/little-worlds/scheduler.env
root-owned mode 0600, based on ops/scheduler.env.example. Verify Node 24 is on the
service PATH. After that host setup/approval, install the reviewed unit files and
use `systemctl daemon-reload` and `systemctl enable --now little-worlds-tick.timer`.
Check `systemctl list-timers` and `journalctl -u little-worlds-tick.service`.
The timer is calendar-based UTC, fires once after missed downtime and delegates
bounded catch-up to the engine. No daemon/VPN/framework was installed here.
If the worker runs inside a managed proxy environment, preserve its proxy/CA
settings and use NODE_USE_ENV_PROXY=1 where required for Node fetch. Raw PostgreSQL
access also needs an authorised TCP route, not merely an HTTPS domain allowlist.

## Tick lifecycle and monitoring

GET cron requests deduplicate by world interval and real-time slot. POST accepts
only `{request_id}`. CRON_WORLD_ID pins the world and a constant-time bearer check
runs before DB access. Cookie/agent credentials cannot authenticate this endpoint.
Paused, archived and test worlds do not advance. Catch-up is capped at 96 fixed
steps per call (or a lower configured cap), retaining the remaining backlog.

An attempt row is committed before processing. The engine's world row lock
serializes workers, and successful run result, clock/creature updates, tick receipt
and batched journal effects commit atomically. A failed transaction leaves no
partial effects. Retries see the original result; success cannot be downgraded by
a later failed caller. A killed process leaves a visible started/unknown row and
can safely retry the same ID. SQL lock, statement and idle-in-transaction timeouts
bound stuck work; no network/LLM request runs inside a transaction.

GET /api/cron/health requires the same scheduler bearer secret. The CLI
`scheduler:health` exits nonzero for missing runs, stale/error/behind status or a
misconfigured archived/test target, and succeeds for healthy or intentionally
paused worlds. Cadence and backlog checks use CRON_EXPECTED_INTERVAL_MS and the
world's persisted tick interval. Keep that setting aligned with the actual timer
when changing frequency. Alert on repeated unhealthy checks or failed/unknown
attempts; inspect the request ID and operator desk's persisted last runs/errors.
A configured endpoint is not evidence that a timer is running. No hosted alerting
service, retention policy or uptime claim is configured automatically.

## Backup, restore and recovery

Pause the source village and stop scheduled/narrator/caretaker writes before a
rehearsal. Store backups outside the checkout, mode 0600, encrypted in an approved
backup destination. Choose retention/RPO and test restores regularly; no managed
backup/PITR purchase or offsite retention was configured here. Full dumps include
all game tables, journal/receipt ledgers, settings, agent metadata and functions;
cluster login roles/passwords are separate and must be protected independently.

Local rehearsal commands, using a NEW empty destination database:

```sh
umask 077
docker compose exec -T postgres pg_dump -U postgres -d little_worlds -Fc > /tmp/little-worlds.dump
sha256sum /tmp/little-worlds.dump > /tmp/little-worlds.dump.sha256
docker compose exec -T postgres createdb -U postgres little_worlds_recovery
sha256sum -c /tmp/little-worlds.dump.sha256
docker compose exec -T postgres pg_restore -U postgres -d little_worlds_recovery --exit-on-error < /tmp/little-worlds.dump
export RESTORE_DATABASE_URL='postgresql://postgres:local-development-only@127.0.0.1:54329/little_worlds_recovery'
# RECOVERY_WORLD_ID names the paused source village; DATABASE_URL remains source.
npm run recovery:check
```

On a fresh cluster create the NOLOGIN little_worlds_runtime group before restoring
its grants; do not apply migrations into the empty target before pg_restore.
Restore as a trusted owner, then create/verify the dedicated app login. The checker
requires an isolated local target and paused/archived source, compares SHA-256
fingerprints of every world-scoped table plus validated engine state/history, and
replays an existing tick ID to prove no duplicate effects. It needs a world with
at least one committed tick. Source must stay unchanged after the backup.

Validate an isolated restore BEFORE reconnecting public traffic. A backup can
predate credential revocation: revoke restored operator sessions and agent keys,
provision fresh approved credentials and rotate CRON_SECRET as part of a real
recovery cutover. Validate role/TLS/RLS and scheduled health again. Resume only
after review. Never restore just current-state tables without their journal,
proposal, budget and idempotency ledgers. Additive migrations keep old data; do not
try to repair failures by deleting receipts/events or resetting live clocks.

## Verification in this task

Local SQL/unit tests, production build, real scheduler HTTP/worker/health checks,
restricted-login acceptance/admin rejection, desktop/mobile browser regressions,
and a checksum-verified full backup/restore rehearsal were executed. Recovery
compared 24 world-scoped tables and a duplicate tick without changing state.
Hosted Supabase networking/pooler/TLS behavior, Vercel cron frequency/plan and
actual hosted scheduling remain unverified until the approved target is configured.
