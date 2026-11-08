# Checkpoints

## Phase 0 — complete
Architecture, directory structure, schema outline, API contracts, lifecycle,
environment inventory, phase plan and risks are documented in ARCHITECTURE.md.
Plan was saved before engine implementation.

## Phase 1 — local engine checkpoint complete
- Strict TypeScript check: passed.
- Vitest: 6 tests passed, including deterministic repeated 30-day runs.
- Accelerated report: 30 village days, 2,880 ticks, 8,640 activity events, zero AI requests.
- Next production build: passed.
- Built scaffold HTTP request: passed; no private world state served.
- First long-run test incorrectly supplied 90 days while expecting 30; corrected
  the test time horizon and event/tick expectations, then reran successfully.

See phase-1-report.json for final creatures, relationships, memories and seed state.
This report is not the Phase 7 caretaker/quest experiment. Cottage food is currently
unlimited. Relationships model seeking interaction, not spatial movement physics.
Full journal exists during the run; the report contains final state and counts.
No database durability or concurrency guarantee is provided by this local engine.

## Phase 2 — local PostgreSQL checkpoint complete

- Added versioned private-schema migration, checksummed transactional migration
  runner and repeatable seed command.
- Added server repository with consistent reads, per-world row locks, durable
  receipts and atomic clock/creature/journal updates.
- Local PostgreSQL 17: migrations applied and verified again without changes.
- Strict TypeScript: passed.
- Vitest with TEST_DATABASE_URL: 15 tests passed (6 engine + 9 database).
- Real simultaneous workers, late-write failure, backend termination and retry,
  permissions, FK/bounds failures, monotonic clock and append-only history tested.
- PostgreSQL container restarted: persisted simulation-state hash unchanged.
- pg_dump/pg_restore into separate local database succeeded (684 journal entries
  at backup time); restored world validated through repository; recorded request
  retry returned duplicate without changing state/history.
- Fault injection initially exposed an unhandled connection-error event. Repository
  now handles checked-out connection errors and discards broken connections; rerun
  passed with no unhandled errors.

Runtime role cannot mutate history. DB owner is used only for local migration and
fault-injection tests. Creature fields remain consolidated in validated JSON;
future quest/proposal/catalogue/credential tables await their mechanics. These
choices and local commands are documented in DATABASE.md. Hosted Supabase and
production TLS/login provisioning have not been tested. No remote migrations,
paid resources, deployment or environment draft changes were made.

## Phase 3 — caretaker API checkpoint complete

- Added authenticated world/creature reads and strict action route adapters.
- Added world/actor-scoped hashed credentials, expiry, revocation and persisted
  60-request/minute buckets. Runtime DB role can update only credential counters.
- Added ownership/location/inventory/energy validation for feeding, rest, play,
  visiting, planting/tending, exploration and interaction. Investigation returns
  an explicit unavailable response pending registered Phase 4 discoveries.
- Added transactional durable action receipts and audited caretaker entries in
  the unified append-only journal. Action and tick writes share the world lock.
- Added a local credential tool, separate external client and repeatable real-HTTP
  smoke script. See API.md for complete commands and security assumptions.
- Strict TypeScript: passed. Full suite with local PostgreSQL: 28 tests passed
  (6 engine, 9 Phase 2 SQL, 5 caretaker rules/handler checks, 8 caretaker SQL/API).
- Production Next build: passed, including the three private API routes.
- Built-server HTTP smoke: passed with the separate client observing, feeding Pip,
  retrying the same key, inspecting persisted needs/resources/history and verifying
  revocation. Tokens were generated locally and never displayed or committed.
- A concurrency test initially assumed feeding would always precede a tick. It
  now checks both valid serial outcomes: a later feed can fail if Pip moved away,
  with no receipt, inventory loss or partial effects.

Creature/actor resource shapes are server validated. Gardening is a small immediate
plant/harvest mechanic; invalid-token ingress throttling is a future hosting
requirement. No operator login, discovery catalogue, narrator or quest engine is
claimed. No remote services were migrated or deployed; no environment draft or
published settings were changed.

## Phase 4 — narrator and quest checkpoint complete

- Added a strict versioned proposal schema, registered effect/item/quest catalogue,
  bounded application rules, location/participant checks and semantic duplicate
  detection. Invalid proposals are retained as rejected without world effects.
- Added manually reviewed proposals by default, immutable terminal decisions,
  actor/role separation and revalidation under the world lock on approval.
- Added the four-stage Glowing Seed quest, factual clues, an unresolved/resolved
  story thread and a one-time seed_charm reward in the caretaker transaction.
- Added ordinary/rare event pacing, local validated settings tooling, compact
  narrator context and separate protected narrator/operator HTTP routes.
- Added an optional provider interface and Groq adapter with operator-selected
  model, timeout/size limits, at most two attempts, Retry-After handling, persisted
  real-day request/token reservations and sanitized usage/error records.
- Local migration 0004 applied. Strict TypeScript and production Next build passed.
- Full local suite: 47 tests passed, including existing 30-day reproducibility,
  narrative invariants, objective building blocks, PostgreSQL approval/quest/
  rollback/concurrency/budget checks and mocked Groq failures/responses.
- Built-server narrative HTTP smoke passed: three separately provisioned roles,
  context, submission, manual approval, complete quest, reward, and rejection
  without mutation. Existing external caretaker client HTTP smoke also passed.
- Fixed a text/UUID parameter inference failure found by real PostgreSQL tests.
  HTTP validation initially reached a stale Phase 3 server; it was restarted with
  the new build. The prior caretaker smoke now selects its actor explicitly rather
  than relying on row order after new actor roles were introduced.

No live Groq/model availability or hosted Supabase claim is made. All AI tests
were mocked; no paid calls, remote migrations, deployment or environment settings
changes occurred. The objective library includes six condition types; only the
registered seed quest is enabled, with no branching/custom mechanics. Frontend
operator login and village UI remain unimplemented. See NARRATOR.md for exact
contracts, defaults, local commands and remaining hosting requirements.

## Phase 5 — private operator interface checkpoint complete

- Added the private key-to-session login flow, hashed opaque DB sessions,
  HttpOnly/SameSite cookies, exact Origin checks, login/request limits and immediate
  credential/root revocation. No app credential is kept in browser storage.
- Added a responsive Tailwind/CSS interface with original interactive SVG village
  art, three original portraits, keyboard/touch location controls, authoritative
  clock/weather/status, profiles, relationships, memories and inventories.
- Added SQL-filtered/paginated village journal, clear event sources, inspected
  effects, active/completed quest clues, narrator approval/rejection, usage/errors
  and operator activity. Untrusted proposal markup is rendered as text.
- Added durable operator command receipts, tick/pause/resume controls and isolated
  local-test acceleration. Pause is honored by normal tick execution too.
- Confirmed test reset opens a fresh marked test world and preserves the original
  state/history read-only. Derived access respects root credential revocation.
  Explicit control world binding prevents replay following a session switch.
- Added local test-world setup tooling and complete operator instructions in
  OPERATOR.md. No public demo or authentication bypass is exposed.
- Local migration 0005 applied. Strict TypeScript and production build passed.
- Full Vitest suite with local PostgreSQL: 56 tests passed, including existing
  simulation/narrative suites and nine new operator integration tests.
- Playwright: all 10 desktop/mobile Chromium checks passed in a complete final
  run. Coverage includes login/logout, map keyboard/pointer selection, profiles,
  viewport overflow, ticks/pause/resume, filtered journal/effects, escaped proposal
  text, approval/quest progress, confirmed reset/history and root revocation.
- Desktop and mobile screenshots inspected; improved secondary text contrast,
  mobile location shortcuts and unsupported arrow glyphs. Test selectors were
  refined to target exact headings and the login form rather than framework live
  regions; the actual user-facing assertions remain in place.

No remote services were migrated, no paid AI requests were made, and no deployment
or environment configuration/publishing changes occurred. Live Groq and hosted
Supabase remain unverified. Refresh/manual actions load persisted state; scheduled
execution remains Phase 6 work. Browser checks are Chromium desktop/mobile,
not an all-browser accessibility or security certification.

## Phase 6 — scheduling/deployment preparation checkpoint complete locally

- Committed/pushed the completed Phase 0–5 baseline to origin/main as 12760a2
  before Phase 6 work, as requested.
- Added a dedicated-secret, pinned-world stateless cron/worker endpoint and private
  health endpoint. Cron slots and explicit worker IDs deduplicate across instances.
- Added persisted attempt/error/result records. Success commits atomically with
  state, receipt and journal; failed/interrupted work can retry safely. Catch-up
  remains capped, skips paused/test/archived worlds and exposes remaining backlog.
- Batched journal inserts and bounded SQL lock/statement/idle waits for serverless
  operation. No LLM work is part of a simulation transaction or scheduler call.
- Added verified remote TLS and new-connection runtime-role checks. A real local
  dedicated app login was accepted; a privileged session was rejected. Pooler
  connections need inherited membership rather than startup SET ROLE options.
- Prepared Vercel five-minute cron configuration, one-shot HTTP worker and UTC
  systemd examples. Timer calendar syntax checked; no worker service installed.
- Added private operator scheduler history/failure display, health CLI, read-only
  deployment preflight and reviewed restricted-role bootstrap SQL. Remote owner
  tooling requires prior approval plus --remote-approved; no such remote operation
  was run. Test-world controls remain local-only.
- Strict TypeScript and production build passed. Full local Vitest: 69 tests passed.
  Final desktop/mobile Chromium suite: 12 tests passed, including scheduler errors.
- Real HTTP checks passed for missing credentials, standalone worker, stable POST
  retries, Vercel-style GET slot retries, preflight and private health. No paid call.
- Full backup/restore rehearsal passed with SHA-256 artifact verification, paused
  source, isolated destination, fingerprints for all 24 world-scoped tables and an
  existing tick replay that changed neither state nor history.

DEPLOYMENT.md provides concrete approved Supabase/Vercel setup, external scheduling,
plan/cadence checks, monitoring, backup/restore and credential cutover instructions.
Hosted Supabase/pooler/TLS behavior and actual Vercel plan/cron/deployment remain
unverified until a target is securely configured and those operations are approved.
No hosted resource, paid request, remote migration, deployment command or environment
configuration publication was performed. This is local readiness evidence, not a
claim of a running production deployment or configured offsite backup retention.

## Phase 7 — First 30 Days checkpoint complete locally

- Added a local-only persistent experiment runner with a versioned caretaker
  policy, mock/disabled narrator modes, actual authenticated command validation,
  operator approval, resources and the registered multi-stage quest.
- Added migration 0007: immutable daily checkpoints, durable input intent/results
  and final run/report records. Fresh worlds only; credentials revoked and worlds
  archived. Failed/interrupted evidence is not labelled successful or resumed
  through uncertain provider attempts.
- Added source/artifact/semantic SHA-256 checks, complete JSON ledgers, readable
  report/chronicle, read-only re-export and optional uniform hypothetical pricing.
  Full raw artifacts remain ignored/private; the compact verified seed-42 sample
  is committed under docs/experiment.
- Two fresh 30-day runs matched the full semantic fingerprint
  a51d46c8bb31dfe1158aeefbb8e14d8ac4d0336cc31e4d02e784aff6aedff430.
  Each completed 2,880 ticks and 8,995 journal entries: 8,640 autonomous activities,
  353 caretaker actions and two narrator events. The scripted seed quest completed
  on day 5 with one charm reward. Three invalid/duplicate proposals were rejected.
  Simulation failures: zero; two mock outage attempts did not stop ordinary life.
- Mock requests: five, reported units 288, reserved units 2,560, two unknown usage
  attempts. Live requests/tokens/API spend: zero. No pricing was supplied; no
  hypothetical model bill or unmetered hosting cost is claimed.
- Strict TypeScript/production build passed. Full Vitest with local PostgreSQL:
  77 tests passed, including two full persistent 30-day runs, disabled mode,
  unrelated-world guards, final record protection and an injected failure.
- Artifact checksums passed. Re-exported report JSON was byte-identical to the
  original. The published source fingerprint matches the current executable source.
- A full checksum-verified local backup/restore also passed after migration 0007:
  all 27 world-scoped tables, experiment ledgers/report and an existing tick retry
  matched without duplicate state/history. No UI changes required browser reruns;
  the prior Phase 6 desktop/mobile suite remains recorded above.

The caretaker is rule-based and stories are scripted mock interventions, not a
live Mac mini/Groq trial. Observations expose current balance limits: all creatures
favored socialising, relationships reached ceilings, health stayed at 100, while
Moss gardened more and Nim's night exploration preference remained visible.
See EXPERIMENT.md and docs/experiment/README.md for protocol, evidence and limits.
No paid calls, deployment, remote database migration or environment publication was
performed. Source changes/reports are pushed to the requested Git remote.

## Initial implementation milestones complete locally

Phases 0–7 now have working local implementations and validation evidence. Hosted
Supabase/Vercel connectivity, plan support, deployment, offsite backup retention
and a live-model/remote-caretaker experiment remain separate configured/approved
operations; they are not implied by these local checks. Follow-up balancing can
use the recorded experiment as a baseline without rewriting its history.
