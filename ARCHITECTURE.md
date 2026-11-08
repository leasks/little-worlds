# Little Worlds architecture and implementation plan

Current status: Phases 0–5 are validated locally. The original Phase 0 plan below
is retained; later checkpoint updates and OPERATOR.md/API.md describe the current
contracts and working interface. Scheduling/deployment remain pending.

## Product and boundaries
A private, cosy persistent village whose rules remain authoritative without AI.
The first implementation checkpoint covers Phase 0 and Phase 1 only. Local fixtures
are not production persistence. No deployment or remote migrations are authorised.

## Stack and structure
Next.js App Router, strict TypeScript, React, Tailwind, Zod, Vitest and Playwright.
Supabase PostgreSQL becomes authoritative in Phase 2. Groq is optional in Phase 4.

- `app/`: authenticated operator UI and server route handlers (later phases)
- `src/engine/`: pure TypeScript world types, validation, clock, PRNG and rules
- `src/repositories/`: transactional PostgreSQL adapter and explicit test adapter
- `src/agents/`: caretaker commands, narrator proposals and provider adapters
- `supabase/migrations/`: versioned schema and restricted database functions
- `scripts/`: accelerated experiment and standalone authenticated tick client
- `tests/`: engine, database and browser checks
- `docs/`: phase checkpoints and experiment results

The engine takes validated state and explicit inputs and returns new state plus
events. It imports neither React nor runtime/database services. Random state and
virtual time are part of state. UUIDs identify production worlds and entities;
fixture names are stable local identifiers, not production database keys.

## Database outline (Phase 2)
Worlds, world settings, simulation state, locations, actors, creatures (bounded
needs and traits consolidated as constrained JSON), relationships, memories,
items, inventories, event journal, proposals, ticks, quest definitions/instances,
story threads and hashed credential metadata. All world records carry world_id.
Composite foreign keys enforce world boundaries; unique(world_id, request_id)
protects ticks/actions; indexes cover journal time, occupant location and quests.
RLS denies anonymous access. Privileged server-only functions perform writes.
Journal permissions deny UPDATE/DELETE to application roles. Backups combine
Postgres dumps and tested restores with a schema/migration version.

## Lifecycle and concurrency (Phase 2)
An authenticated scheduler supplies real time and a correlation ID. A transaction
locks the simulation-state row using SELECT FOR UPDATE, checks the unique tick
receipt, calculates due fixed steps, caps catch-up, validates the engine output,
then commits state, journal and receipt atomically. Failed transactions roll back;
retries reuse IDs. No network/LLM call runs while a transaction holds the lock.
Persist last simulated real timestamp, virtual timestamp and PRNG state. Drain
backlog in bounded batches. Accelerated runs use separate local fixtures and
explicit tick inputs; never modify a production clock setting.

## API contracts (original Phase 0 proposal)
All routes private and fail closed when credentials are absent. Operator, caretaker,
narrator and scheduler have separate scopes. World ID is explicit on every route.
GET /api/worlds/:id returns a permitted projection without hidden story data.
POST /api/worlds/:id/actions accepts a strict discriminated command with actor_id,
target_id, parameters and idempotency_key. The authenticated identity binds actor_id.
POST /api/worlds/:id/proposals accepts a versioned Zod event proposal with catalogue
references and bounded effects; rejection records do not mutate game state.
POST /api/worlds/:id/ticks accepts request_id; scheduler time is server supplied.
Success: {ok:true,request_id,result}; failure: {ok:false,code,message}.
Writes require size limits, rate limits, validated input, audit and atomic receipts.

## Environment inventory (no values)
DATABASE_URL (server PostgreSQL connection), NEXT_PUBLIC_SUPABASE_URL,
NEXT_PUBLIC_SUPABASE_ANON_KEY (only if browser auth requires it),
SUPABASE_SERVICE_ROLE_KEY (server only), OPERATOR_AUTH_SECRET,
CARETAKER_API_KEY, NARRATOR_API_KEY, CRON_SECRET, GROQ_API_KEY, GROQ_MODEL,
NARRATOR_DAILY_REQUEST_LIMIT, NARRATOR_DAILY_TOKEN_LIMIT.
Do not expose private state before operator auth exists. No secrets needed in Phase 1.

## Ordered checkpoints and acceptance
0. Record architecture, contracts, assumptions and risks (this document).
1. Pure deterministic engine; five locations, three creatures, needs/personality,
   relationships/memories, seeded weather, bounded catch-up and accelerated runner.
   Acceptance: reproducible 30-day run, invariant and failure tests without AI.
2. SQL migrations/repository/seed; real Postgres transaction, concurrency, rollback,
   restart and duplicate tests. Supabase account/access needed for remote validation;
   no remote migration without explicit approval. Local PostgreSQL may be used first.
3. Scoped caretaker API, example client and permission/idempotency tests.
4. Validated narrator effects, multistage Glowing Seed quest, Groq timeout/budgets,
   mocks and atomic rejection tests. Live Groq validation needs an operator key/model.
5. Responsive SVG village and operator views; Playwright critical-path tests.
6. Authenticated scheduling, Vercel configuration, recovery and monitoring docs;
   deployment requires explicit approval.
7. Reproducible caretaker experiment, journal chronicle and inspectable report.
Each phase is tested before proceeding; incomplete integrations remain labelled.

## Risks and assumptions
Eight real hours per village day; virtual epoch begins day 1 at midnight. Fixed
steps avoid request-frequency-dependent drift. Catch-up retains backlog rather
than silently skipping time. The local adapter offers functional idempotency only,
not cross-process locking or durability. DB correctness needs real Postgres tests.
Narrator content is untrusted data, never executable mechanics. Personality drifts
must be slow, bounded and journalled. Costs cannot be estimated without model pricing.
No multiplayer, paid provisioning, public access or speculative infrastructure.

## Phase 2 checkpoint update

The PostgreSQL repository and migration now implement the lifecycle above.
DATABASE.md records the exact current schema, consolidation choices, permission
model and local recovery procedure; docs/PHASES.md records validation evidence.
Future item/credential/proposal/quest/story tables are intentionally deferred to
Phases 3–4 rather than adding unused tables before their contracts are implemented.
No public game routes or deployment were added.

## Phase 3 checkpoint update

Typed caretaker commands live in src/caretaker, PostgreSQL auth/actions in the
server repository, and private Next route adapters under app/api/worlds. Actions
and ticks share the world lock and the append-only journal, with separate durable
receipt tables. API.md documents the exact command contracts, permissions and
local credential workflow. Investigation intentionally rejects until Phase 4
registers discoveries; no narrator or operator route is introduced.

## Phase 4 implementation checkpoint

Pure catalogue/proposal/quest validation lives in src/narrative. A PostgreSQL
narrator repository serializes proposal application against the same world lock
as ticks/actions. Proposals have immutable input plus audited terminal decisions;
manual approval defaults on and requires a distinct operator credential. Narrator
credentials can read compact context and submit only. Approved effects are a fixed
vocabulary with registered references. The Glowing Seed quest progresses only
through validated caretaker objectives, never arbitrary narrator stage increments.
AI calls live outside transactions. Per-attempt daily request/token reservations
and sanitized usage records persist even after uncertain failures. The optional
Groq worker is separate from ordinary ticks; unavailable AI cannot halt simulation.

## Phase 5 implementation checkpoint

A private operator credential is exchanged for a random DB-backed, HttpOnly,
SameSite session. No long-lived key is kept in browser storage. Cookie writes
require exact Origin checks; all operator data is private/no-store. A responsive
Tailwind/CSS interface uses original keyboard-accessible SVG art and authoritative
DB snapshots. Journals are filtered/paginated server-side. Simulation controls
share the world lock, persist command receipts/audit, and honor pause/resume.
Synthetic time advancement requires marked test worlds plus local-only server
configuration. Confirmed test reset creates a fresh isolated test village and
preserves the old world/history read-only, instead of deleting append-only data.
Scheduling/deployment remain Phase 6 work. Playwright uses local DB fixtures and
real Chromium to validate login, map, profiles, controls, journals and quests.
