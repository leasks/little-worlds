# Private village dashboard (Phase 5)

The website now provides a private operator login, original interactive SVG map,
creature profiles, paginated village journal, quest/clue journal, narrator review,
AI usage/error records and simulation controls. All displayed world state comes
from PostgreSQL; there is no public demo or fabricated live data. The clock is a
persisted simulation clock, refreshed on request, not an authoritative browser timer.
Phase 6 supplies scheduling configuration and a one-shot worker (DEPLOYMENT.md);
no service is deployed by these instructions.

## Start a marked local test village

Requires Node 24, npm, Docker/Compose and the migrations from DATABASE.md. The
password below is the public, loopback-only Compose development password.

```sh
npm ci
docker compose up -d --wait
export DATABASE_URL='postgresql://postgres:local-development-only@127.0.0.1:54329/little_worlds'
npm run db:migrate
# Generate a new private key without printing it.
export OPERATOR_API_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
npm run db:test-world
# Copy the printed village UUID, not a secret, into the sign-in form.
export LOCAL_TEST_TOOLS_ENABLED=true
export APP_ORIGIN='http://127.0.0.1:3000'
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open the local app on port 3000, enter the printed village ID and your privately
held OPERATOR_API_KEY. No key is printed by setup. Use a password manager or other
secure local handling to transfer your generated key into the password field;
never paste it into chat, logs or tracked files. `db:test-world` creates a fresh
world and operator credential atomically and marks only that world for testing.
Use a freshly generated key for each new test world; credential hashes are unique.
Next reads local .env files, but standalone CLI scripts use exported environment
variables. .env files are ignored; never commit them.

For an optimized local build, use `npm run build`, then
`npm run start -- --hostname 127.0.0.1 --port 3000` with the same server environment.
APP_ORIGIN must match the browser's actual origin exactly. A different hostname,
protocol or port will cause write requests to fail the Origin check.

## Use an existing live world

Apply migrations and seed using DATABASE.md. Provision an operator key for that
world using the existing local administrative tool:

```sh
export WORLD_ID='00000000-0000-4000-8000-000000000001'
export AGENT_ROLE=operator
export OPERATOR_API_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
npm run caretaker:credential
unset AGENT_ROLE
unset LOCAL_TEST_TOOLS_ENABLED
```

Start the website with DATABASE_URL and APP_ORIGIN configured. The local setup
uses an administrative connection for CLI work; the website always SET ROLEs to
little_worlds_runtime. In hosted use, give its dedicated DB login membership in
that role, not migration-owner privileges. Do not deploy or migrate remote worlds
without the explicit approval required by DEPLOYMENT.md.

The original seed is a live world, not an accelerated test fixture. Synthetic
advancement and reset require BOTH a test-marked world and
LOCAL_TEST_TOOLS_ENABLED=true with a loopback database destination. They fail
closed for other worlds even when the server flag is set. There is no HTTP API
to mark an existing live world as a test world. Keep that flag disabled on hosted
servers. The core simulation continues to function without Groq configuration.

## Around the dashboard

- **The village:** persisted day/time, multiplier, weather, status and resident
  count. Select any of five SVG locations to see occupants, allowed activities and
  its latest events. Map locations support Tab, Enter and Space; mobile shortcuts
  provide readable touch targets. Resident cards open needs, traits, preferences,
  relationships, memories and possessions.
- **Village journal:** newest virtual-time events first, with creature, location,
  source and event-type filters. Source labels separate village simulation,
  caretaker and narrator events. Pages hold 50 entries; recorded effects can be
  expanded for debugging. Filters apply in SQL across the world history.
- **Little mysteries:** the registered active/completed seed story, its ordered
  progress and only the clues already discovered. No quest is invented for an
  empty world. Actual caretaker actions progress it; see NARRATOR.md.
- **Operator desk:** manual ticks, pause/resume, marked-test acceleration/reset,
  narrator approve/reject controls, reserved/known-actual AI usage, sanitized
  errors, and recent operator activity. Proposal/AI text is rendered as plain text.
  No click initiates a paid AI request; the optional worker remains separate.

Refresh retrieves the latest committed state. The interface does not assume an
always-running scheduler. A live-world “Run one tick” performs at most one step
that is due at server real time; it may report that nothing is due. In a local
test world it explicitly advances one interval. At defaults that is 15 village
minutes. Test advancement accepts 1–96 ticks and does not change the multiplier.

Pause is persisted and honored by ordinary tick and operator paths. Resume shifts
the simulation's real-time anchor by the paused duration, preserving the backlog
that existed before pause while excluding time intentionally spent paused.
Narrator/caretaker actions are not simulation ticks; pausing does not revoke
agent permissions or freeze their explicit commands.

Operator commands have durable actor-scoped receipts. Retry metadata in
sessionStorage contains only a command, request ID and world ID—never a key or
session secret. An uncertain request can be retried with the same ID. The explicit
world binding prevents an old reset/advance request from being applied to a new
world after the session switches. Known validation failures clear pending UI
metadata; successful logout clears it too.

## Confirmed reset preserves history

Only marked local test villages offer reset. Type `RESET TEST VILLAGE` into the
confirmation field before confirming. This creates a new isolated test village,
archives/pauses the old one, and switches the current browser session. Old state,
quests, journal and audit history are preserved, not deleted or rewritten.
Archived villages reject new actions/events/controls; their reads remain available
to previously authorized credentials. This is an intentional implementation of
reset that protects the append-only history contract.

The fresh village gets a derived operator session with no displayed long-lived
key. It inherits the original credential's revocation boundary and an eight-hour
maximum; revoking the original root credential closes derived access as well.
The original key still signs into the original archived village for inspection.
To sign into the fresh village later, securely provision a new operator key for
its UUID (available under “Village reference”) with the local tool above. Reset
receipts are idempotent; a network retry cannot create another fresh world.
No live-world reset or destructive database truncate endpoint is exposed.

## Session and security model

Login exchanges a scoped operator key for a random 256-bit DB-backed session;
only its SHA-256 hash is stored. The browser receives an HttpOnly, SameSite=Strict,
host-only cookie. It is Secure on HTTPS or non-loopback hosts; HTTP cookies are
allowed only for loopback development. Sessions expire after at most eight hours,
earlier when the underlying credential expires, and are checked on every request.
Logout revokes the session. Credential revocation invalidates all of its sessions,
including sessions derived by test reset. No signing secret is required for these
opaque DB sessions; OPERATOR_AUTH_SECRET is reserved for future auth providers.

All cookie-authenticated mutations require the exact configured APP_ORIGIN (or
request origin locally), including login/logout. They accept strict validated JSON
within 8 KiB. Bearer agent endpoints remain separate and do not accept browser
cookies. Session requests share the credential's 60/minute limit. Login attempts,
including invalid tokens, are separately limited to 30/minute per world. Private
responses are no-store; frame embedding is denied. Hosting still needs HTTPS,
coarse ingress protection, restricted DB networking and operational backups.
No broad security audit or accessibility certification is claimed.

## Browser and database checks

Use a migrated disposable local DB, not real world data:

```sh
export TEST_DATABASE_URL="$DATABASE_URL"
npm run typecheck
npm test
npm run build
npm run test:browser
```

Playwright starts and stops its own production server on loopback port 3100 with
local test controls enabled. Do not run another server on that port. It uses system
Chromium when available; otherwise install Playwright Chromium using
`npx playwright install chromium`, or set PLAYWRIGHT_CHROMIUM_EXECUTABLE to a
trusted installed executable. No browser capability is assumed without running it.
The tests create isolated worlds and ephemeral credentials and revoke them after
use. They cover login/logout, private reads, keyboard map selection, profiles,
layout overflow, controls, journal effects, escaped proposal text, approval/quest
progress and confirmed reset/history/revocation in desktop and mobile Chromium.
Screenshots and failure traces are under ignored test-results; test credentials
are local, generated and revoked. No paid AI calls are part of these checks.

## Troubleshooting

- **Cannot sign in:** use an operator credential, not a caretaker/narrator key;
  verify the world UUID, migrations, credential expiry and revocation status.
- **Sign-in unavailable:** wait for the one-minute limit or inspect local DB/server
  health. No service error returns raw connection details.
- **Write rejected by origin:** align APP_ORIGIN and the address used in the browser.
- **No test controls:** confirm you created a marked test world and enabled the
  local flag against loopback PostgreSQL; live worlds intentionally do not qualify.
- **No new journal entries:** a live tick may not yet be due, or the world is paused.
  Configure the Phase 6 scheduler from DEPLOYMENT.md, or use explicit test ticks.
- **Unconfirmed operation:** use “Retry same operation”; do not invent a new ID.
- **Proposal rejected after approval:** current co-location, pacing or prerequisites
  changed. The rejection is a recorded safe decision, not a partially applied event.

The operator desk also displays persisted scheduler outcomes, attempt counts,
backlog and sanitized failures. Endpoint configuration alone is not a running-timer
claim. Private health and deployment/recovery instructions are in DEPLOYMENT.md.
