# Narrator, quests and optional Groq (Phase 4)

The narrator proposes data; the deterministic engine owns all mechanics. The
simulation does not import or call AI. No live Groq request has been validated,
no paid calls were made, and no hosted Supabase migration or deployment occurred.
All commands below are for an existing local setup from DATABASE.md/API.md.

## Registered content and effects

Migration 0004 installs a private per-world item catalogue, quest definition,
quest instance/story thread tables, narrative settings, proposal/decision audit
records and AI usage/budget tables. Seed hooks populate both existing worlds and
new worlds. Runtime code cannot edit the catalogue or settings. Adding mechanics
requires a reviewed code change plus migration; there is no generated-code path.

Only berries, seeds, glowing_seed and seed_charm are registered. The charm is an
engine-only quest reward. Narrator effects: give_item (1–2 registered items),
adjust_relationship (-3..3, one direction), adjust_mood (-5..5), set_weather
(clear/rain/cloudy), unlock_quest (only mystery_of_the_seed). Repeated effects,
self relationships, overflow, absent participants, mismatched locations, unknown
references, invalid categories and inconsistent quest activation are rejected.
All participants must occupy the stated location when submitted and approved.

The eight event categories are discovery, social_interaction,
environmental_occurrence, relationship_development, item_discovery,
quest_introduction, quest_progression and minor_world_change. Category/effect
combinations are validated. Quest progression events may describe an active quest
and adjust bounded mood; they cannot increment a stage. The registered seed
starter is the only unusual discovery/quest introduction available. This prevents
an endless stream of unrelated mysteries.

## The Glowing Seed

At least one village day must elapse by default. Pip (or another participant)
and any named companions must be in the garden. A valid starter must both grant
one glowing_seed and unlock mystery_of_the_seed in the same proposal. For example:

```json
{
  "schema_version": 1,
  "event_type": "discovery",
  "title": "The Glowing Seed",
  "description": "Pip finds a gently glowing seed beside Moss.",
  "location_id": "garden",
  "participants": ["pip", "moss"],
  "effects": [
    {"type": "give_item", "target_id": "pip", "item_id": "glowing_seed", "quantity": 1},
    {"type": "unlock_quest", "quest_id": "mystery_of_the_seed"}
  ]
}
```

This creates one persistent active quest and unresolved story thread. Its owner
is the creature receiving the seed. The caretaker must co-locate with that creature
and perform these objectives in order:

1. investigate_discovery with discovery_id glowing_seed, at the garden.
2. visit_location with location_id pond.
3. Return to garden, then plant_crop (requires a seed and energy).
4. tend_crop (requires the planted crop and energy).

Each completed stage retains a predefined factual clue. Completion consumes the
glowing seed, gives exactly one seed_charm, adds a memory and resolves the thread.
The final action, quest update, resource cost, reward, receipt and journal entry
commit together. Retries cannot duplicate rewards. Completed quests remain stored.
Caretaker observation exposes the active/completed quest and discovered clues,
without proposal inputs, pending decisions, AI usage or narrator pacing context.

The objective library supports visit location, find item, interact with creature,
complete activity, wait for a world condition (night/rain/time), and investigate
discovery as data-only building blocks. The initial quest uses investigation,
location and activity objectives; item possession is also an activation/progression
prerequisite. No branching choice or custom/generated condition is needed for this
small quest. Unused objective types are unit tested but no other quest is registered.

## Separate credentials and HTTP contracts

Caretaker credentials cannot access narrator context, submit proposals or approve
events. Narrator credentials cannot perform caretaker actions or approve their
own proposals. Operator credentials can inspect and review proposals. Existing
opaque token generation, expiry, revocation, world binding, request size and
rate-limit rules from API.md apply. No operator browser login exists yet.

The local credential tool now accepts AGENT_ROLE (caretaker/narrator/operator).
Generate different secrets for narrator and operator; never reuse the caretaker's
secret. Provisioning defaults to local-only and requires migration-owner DB access;
approved remote operations additionally require --remote-approved (DEPLOYMENT.md):

```sh
# DATABASE_URL and WORLD_ID must already name the migrated local world.
export AGENT_ROLE=narrator
export NARRATOR_API_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
npm run caretaker:credential
export AGENT_ROLE=operator
export OPERATOR_API_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
npm run caretaker:credential
unset AGENT_ROLE
```

Defaults are actors local-narrator and local-operator; AGENT_ACTOR_ID overrides
that selection when intentionally provisioning another registered actor. Tokens
expire after 30 days. The same tool's `-- revoke` operation uses CREDENTIAL_ID.
No token values are printed. Store them securely on the corresponding clients.
Never give remote clients DATABASE_URL.

| Route | Credential | Behavior |
|---|---|---|
| GET /api/worlds/:id/narrator/context | narrator | Compact current facts, six recent important event types, relationships/memories, quest, thread, catalogue, pacing |
| POST /api/worlds/:id/proposals | narrator | `{request_id, proposal}`; 202 pending, 200 accepted, 422 audited rejection |
| GET /api/worlds/:id/proposals | operator | Last 30 proposals and last 30 sanitized AI usage records |
| POST /api/worlds/:id/proposals/:proposalId/review | operator | `{approve:true}` or `{approve:false}`; returns the recorded terminal decision |

Review success means a decision was recorded: inspect result.status, which can
be rejected after stale-state validation. Rejected submissions return a top-level
code plus result.id/status/code. Transport-envelope errors return 400; invalid
proposal content inside a valid envelope receives a persisted rejected record.
No token, database connection error or raw provider failure text is returned.

Idempotency is scoped to world, actor and request_id. Exact retries return the
original proposal status; changed input under a recorded key conflicts. Semantic
deduplication ignores prose and effect/participant ordering, preventing reworded
equivalent events from repeating while pending or after acceptance. Rejected
proposals may be corrected under a new key. A world permits one pending proposal
at a time. Terminal decisions and decision audit rows cannot be rewritten by the
application. Raw proposal text is untrusted data: render as plain text, never HTML,
SQL, code, shell or system instructions.

## Pacing and operator settings

Defaults per world: manual approval enabled; one narrator event per village day;
one village day between ordinary events; three days between rare discoveries,
item discoveries or quest introductions; first unusual seed discovery after one
day. Every-day simulation remains dominant. Limits are evaluated using persisted
virtual time under the world lock, independent of API call frequency.

The settings tool defaults to local-only and validates and persists only supplied overrides:

```sh
export NARRATOR_MANUAL_APPROVAL=true
export NARRATOR_DAILY_REQUEST_LIMIT=2
export NARRATOR_DAILY_TOKEN_LIMIT=12000
npm run narrator:settings
```

Other overrides: NARRATOR_MIN_GAP_HOURS, NARRATOR_RARE_GAP_HOURS,
NARRATOR_EARLIEST_DISCOVERY_DAY (elapsed days, 0–30),
NARRATOR_MAX_EVENTS_PER_DAY (0–5). Request budget is 0–100 per real UTC day and token
budget 0–1,000,000; zero disables calls. Time gaps are 0–30 village days. These
variables configure the saved per-world settings when running this tool; merely
changing process variables does not overwrite authoritative DB settings.
Do not disable manual approval or pacing on a production world casually. The
HTTP smoke test uses its own isolated world and explicitly accelerates pacing.

## Optional Groq worker

The provider interface is not Groq-specific. The initial adapter uses the fixed
HTTPS Groq chat-completions endpoint, JSON output mode, an operator-supplied model,
a ten-second timeout and at most two attempts. No model or free tier is assumed.
Set GROQ_API_KEY securely and GROQ_MODEL to a currently supported model. They must
remain server-side. Allow api.groq.com in the environment network policy before
live use; preserve inherited proxy/CA trust. No network settings were changed here.

```sh
# WORLD_ID, DATABASE_URL, NARRATOR_API_KEY must be configured securely.
# GROQ_API_KEY/GROQ_MODEL are optional; missing either disables generation.
npm run narrate
```

In a managed environment requiring Node's inherited proxy support, invoke with
`NODE_USE_ENV_PROXY=1 npm run narrate`; preserve supplied trust variables. There
is no live Groq validation claim. Automated tests inject a mocked transport.
Without provider configuration, the worker reports disabled and makes no call.
Ordinary ticks/actions never invoke this worker. It may later be scheduled
separately from simulation, after deployment/scheduling approval in Phase 6.

Each network attempt reserves one daily request and a conservative token allowance
under a database lock BEFORE calling the provider. Reservation uses prompt UTF-8
bytes plus output/framing allowance (768 output tokens, 1,024 allowance); input
context is capped at 10,000 bytes and responses at 32,768 bytes. Reserved allowance
is retained even on timeout, network failure or process interruption; actual usage
is recorded when known, never fabricated for uncertain calls. If reported usage
exceeds the estimate, accounting is increased and that response is not applied.
No token allowance is refunded. This favors an upper bound over maximizing spend.

Each workflow/attempt has a unique persisted reservation. Replaying an uncertain
attempt does not call the model again. Retries reserve another request/token
allowance and back off at least 250 ms. Retry-After is honored; a delay above five
seconds defers to a later worker instead of shortening it or blocking a job.
Only network/timeout, 429 and server errors are retried. Malformed JSON/shape or
unsupported responses fail safely; structured but invalid proposals are rejected
and audited. Provider errors store sanitized codes, not response bodies or secrets.
A reserved usage row after a crash is deliberately conservative evidence of an
uncertain call. Operator inspection exposes it for diagnosis. Pricing is not
supplied, so no operating-cost estimate is claimed.

## Local validation

```sh
npm run db:migrate
export TEST_DATABASE_URL="$DATABASE_URL"
npm test
npm run build
npm run start -- --hostname 127.0.0.1 --port 3001
# In another shell using the same local database:
npm run test:narrative-http
```

The HTTP smoke provisions three distinct random credentials using the real tool,
positions creatures via the caretaker API, reads narrator context, submits and
approves the seed proposal, completes all quest stages, checks the single reward,
and verifies a malformed proposal is rejected without world mutation. It revokes
its test credentials afterward. No Groq call is made. UI/browser E2E and the full
30-day caretaker experiment remain later phases.

Phase 5 exposes proposal inspection/review and known/reserved usage in the private
operator desk. Browser login uses an opaque session derived from the same scoped
operator credential; it does not grant narrator permissions to caretaker keys.
See OPERATOR.md. No dashboard action starts a paid model call.

Phase 6 supplies controlled remote-owner setup after explicit approval and verified
TLS. Simulation cron never calls the narrator. Keep narrator generation separately
scheduled and budgeted; no paid AI call was made as part of deployment preparation.
