# Persistent world storage (Phase 2)

The authoritative adapter is `PostgresWorldRepository`; `seedWorld` remains an
explicit in-memory fixture for engine tests. PostgreSQL 17 was tested locally.
The SQL uses standard PostgreSQL available in Supabase; no hosted Supabase project
has been contacted, migrated or verified.

## Local development

Requires Node 24, npm, Docker and Docker Compose. The development-only password
below is intentionally public and only for this loopback-bound disposable service.
Never use it on a remote host. The named volume survives container restarts.

```sh
npm ci
docker compose up -d --wait
export DATABASE_URL='postgresql://postgres:local-development-only@127.0.0.1:54329/little_worlds'
npm run db:migrate
npm run db:seed
export TEST_DATABASE_URL="$DATABASE_URL"
npm run test:db
npm run typecheck
npm test
```

`db:migrate` only accepts loopback destinations, applies sorted SQL files in one
transaction under an advisory lock, and verifies SHA-256 checksums on subsequent
runs. Do not edit applied migrations. Migration credentials require CREATE ROLE,
CREATE SCHEMA and table ownership. `db:seed` creates/preserves the First Village at
UUID `00000000-0000-4000-8000-000000000001`. Repeating seed never resets it.
No schema reset or destructive operator endpoint exists. Tests add isolated UUID
worlds to the selected local database; never use a production database for tests.

## Schema and consolidation

`little_worlds` is a private schema, separate from Supabase's exposed public
schema. Tables: worlds, world_settings, simulation_state, locations, actors,
creatures, simulation_ticks and event_journal. All world records carry `world_id`.
Worlds use UUIDs. Catalogue location/creature IDs remain stable text keys (`pip`,
`garden`), unique within each UUID world, preserving deterministic engine rules.
Composite foreign keys prevent cross-world location, owner, actor and receipt links.

Each creature row consolidates needs, traits, directional relationships, retained
memories and inventory in validated JSON. This deliberately avoids mirroring every
engine field in separate tables. Needs/traits have SQL bounds checks; full creature
shape, relationship references/bounds, memories and inventory are Zod/engine
validated before repository commits and on load. Journal entries preserve payload,
effects, virtual/simulated-real timestamps, database recording time and correlation.
Phase 3/4 migrations add the fixed item catalogue, agent credentials, proposals,
quests and story threads described below. Other content/mechanics remain excluded.

## Atomic ticks and recovery

The repository opens a transaction and locks the world's simulation-state row via
`SELECT FOR UPDATE`. The persistent `(world_id,request_id)` receipt is checked
under the lock. Duplicate requests return their original tick/time receipt, even
if the world subsequently advanced. No-due-work requests do not consume IDs.
Distinct concurrent IDs for the same elapsed interval cannot advance twice.

The engine receives current state only, not the historical journal/receipt list.
It advances at most 96 steps by default (explicit maximum 1,000), validates the
result, then the adapter inserts the receipt, updates state/creatures and appends
all journal entries in the same transaction. A crash/failure rolls back everything;
a disconnected client is discarded. A caller with an uncertain COMMIT result must
retry the same ID. Lock waits time out after 10 seconds and are safe to retry.
Backlog remains persisted rather than skipping elapsed time. A queued stale worker
observation is clamped to the already-simulated real timestamp. Tick inputs are
internal server inputs; an agent must never supply authoritative time directly.

Current-state reads use a repeatable-read transaction so they cannot combine
creatures and history from different committed ticks. `read` loads complete history
for this prototype; add pagination before journals become large. Tick writes are
bounded independently of total history. Stable creature iteration order preserves
the engine PRNG stream after reload. Clock regression is rejected by a SQL trigger.

## Database permissions

`little_worlds_runtime` is a NOLOGIN server group. The migration grants it SELECT
and INSERT plus UPDATE only on creatures and simulation_state; it cannot delete,
truncate or change existing journal/receipt rows. Triggers reject journal/receipt
UPDATE/DELETE even by the table owner. RLS is enabled on every game table with a
policy only for this server role. PUBLIC has no schema privileges; Supabase anon
and authenticated roles receive no access. There is no browser DB integration.

Production must use a dedicated server login granted membership in
`little_worlds_runtime`, with inherited privileges or `SET ROLE`, not the migration
superuser. Tests connect with `options: '-c role=little_worlds_runtime'` for runtime
operations, and use the owner only for fault injection/schema checks. This role
can access every world on the server; per-agent/world permissions belong at the
Phase 3 API boundary. Never grant the server group to external agents. The sample
local DATABASE_URL is an administrative development connection, not a production
credential. Keep database credentials server-only with verified TLS for hosted DBs.

## Backup and restore

Keep backups outside the checkout and protect them as private world data. Example
for this local Compose service (does not delete the source database):

```sh
docker compose exec -T postgres pg_dump -U postgres -d little_worlds -Fc > /tmp/little-worlds.dump
docker compose exec -T postgres createdb -U postgres little_worlds_restore
docker compose exec -T postgres pg_restore -U postgres -d little_worlds_restore --exit-on-error < /tmp/little-worlds.dump
```

The restore destination must be empty. On a fresh cluster, first create the
NOLOGIN `little_worlds_runtime` group (pg_dump does not include cluster roles),
and restore as a trusted migration owner. The dump includes the migration ledger,
constraints, indexes, RLS policies, state, receipt ledger and journal. Reconnect the
repository to the restored database, read/validate the world and retry a recorded
tick ID; it must not advance. Verify backup restores routinely before relying on
retention. Hosted Supabase backups/PITR require operator configuration and review;
none are claimed here. `docker compose down` retains local data; never add `-v`
unless intentionally deleting disposable local worlds.

## Troubleshooting

Connection refused: run `docker compose ps` and `docker compose logs postgres`.
Permission denied: check the server login's group membership, not anonymous RLS.
Migration checksum mismatch: restore the original file and create a new migration.
Lock timeout: investigate the worker holding the world transaction, then retry
with the same request ID. No network or AI requests belong inside a DB transaction.

## Phase 3 additions

Migration 0002 adds per-world actor state (location, berry/seed inventory, crop
count), hashed agent credential metadata with expiry/revocation and shared request
buckets, and immutable action receipts. The unified event journal now references
either a tick receipt or an actor-scoped action receipt; a CHECK and world-scoped
foreign keys enforce valid provenance. Existing history is preserved by a single
transactional backfill. Caretaker journal entries include the initiating actor.
Credentials can only be provisioned by a trusted migration owner; the runtime role
can read credentials and update only request-window/counter columns; it cannot
insert, rebind, revive or revoke credentials. Revocation requires the trusted
local provisioning tool. Migration 0003 enforces these column-level grants.
Actor-state resource bounds and shape are enforced by Zod in the server transition.
See API.md for actions, credential provisioning and resource semantics.

## Phase 4 additions

Migration 0004 adds private world-scoped items, quests, quest_instances,
story_threads, narrative_settings, event_proposals, immutable proposal_decisions,
ai_daily_usage and ai_usage. It extends the unified journal's provenance constraint
to require a proposal FK for narrator events, preserving all tick/action history.
A narrowly scoped SECURITY DEFINER seed trigger inserts only fixed catalogue and
actor definitions for new worlds; PUBLIC cannot execute it directly. Runtime
access cannot edit catalogue/settings or grant itself credentials. Operator tokens
are a distinct role and remain validated at every API boundary. See NARRATOR.md
for data contracts, retained audit inputs and the accounting model. Backups must
now include these tables and seed/protection functions too (full DB dumps do).

## Phase 5 additions

Migration 0005 adds world test/pause/archive flags, operator sessions, persisted
login limits, immutable command receipts and operator audit. The restricted runtime
role cannot mint ordinary credentials. A narrowly scoped SECURITY DEFINER function
may derive only a short-lived operator credential from an active operator in a
marked test world into another marked test world. It cannot issue caretaker or
narrator access, copy live-world access or accept arbitrary SQL. PUBLIC cannot
execute it. Session reads additionally check the root credential across resets.
All tables remain private with RLS, and full database backups include them.

Confirmed test reset creates a fresh world rather than clearing tables. The old
world is archived read-only, preserving history and avoiding clock regression or
disabling append-only protections. Pause/resume is persisted; no in-process lock or
browser timer is authoritative. See OPERATOR.md for exact behavior and setup.
