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

## Next: Phase 6
Authenticated scheduling/worker, Vercel configuration, hosted environment setup,
monitoring and backup/recovery validation. Deployment/remote migrations still
require explicit approval. Phase 7 remains the full caretaker experiment/report.
