# Caretaker API — Phase 3

These are private, Node-runtime Next.js endpoints. Every request requires
`Authorization: Bearer <token>`. No cookie login or public registration exists.
Tokens are opaque random secrets; only SHA-256 hashes, world/actor binding,
role, expiry and revocation metadata are stored. Invalid, revoked, expired,
wrong-world or narrator credentials receive 401. Actor impersonation/ownership
violations receive 403. No tick or reset endpoint is exposed to caretaker credentials. Separate narrator/operator routes are documented in NARRATOR.md.
Private browser operator login and the dashboard are documented in OPERATOR.md.

## Prepare the local server and credential

Follow DATABASE.md first, including `npm run db:migrate` to apply migration 0002.
Provisioning defaults to local databases; reviewed remote owner operations require
explicit approval and --remote-approved (DEPLOYMENT.md). Set DATABASE_URL privately to
that local PostgreSQL database; it is never sent to the external client.

```sh
export WORLD_ID='00000000-0000-4000-8000-000000000001'
export CARETAKER_ACTOR_ID='local-caretaker'
# Generate locally; no token value is printed or committed.
export CARETAKER_API_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
npm run caretaker:credential
npm run build
npm run start -- --hostname 127.0.0.1 --port 3001
```

The credential command prints a metadata UUID, not the token; expiry is 30 days.
Keep the token securely for the Mac mini. Do not log or commit environment files.
Revocation uses local administrative credentials:

```sh
export CREDENTIAL_ID='<UUID printed by the registration command>'
npm run caretaker:credential -- revoke
```

To rotate, generate/register a new random token, update the client's secure
configuration, then revoke the old metadata UUID. Server writes/reads recheck
active credentials after authentication. The server activates the restricted
`little_worlds_runtime` group; its database login must be a member of that group.
The sample local development DB owner can SET ROLE, but production must use a
dedicated login with membership. No Supabase service-role key goes to the client.

## Routes and response envelope

- `GET /api/worlds/:worldId`: clock, weather, five locations, caretaker resources,
  detailed owned creatures, and basic public creature presence.
- `GET /api/worlds/:worldId/creatures`: the same scoped creature projection.
- `POST /api/worlds/:worldId/actions`: one validated typed command.

World IDs are UUIDs. Reads explicitly omit random state, receipts, full journal
payloads, credentials and hidden narrator/quest data. Future hidden tables must
stay out of this allowlist. Responses use `Cache-Control: no-store`.
Success: `{ "ok": true, "result": ... }`.
Failure: `{ "ok": false, "code": "...", "message": "..." }`.

POST requires application/json and at most 8,192 bytes, measured while streaming
regardless of Content-Length. Extra fields, unknown actions/targets and malformed
parameters are rejected (400); oversized bodies return 413; other content types
return 415. Database failures return a generic 503 without internal error text.
Authenticated requests share a persisted limit of 60 per credential per minute,
including reads and invalid commands; 429 includes Retry-After: 60. Invalid token
traffic is rejected but not tracked in that credential bucket; infrastructure
should also enforce coarse ingress limits before public deployment.

## Commands

Every command has `action`, `actor_id`, `target_id`, `parameters`, and
`idempotency_key` (1–128 characters). `target_id` is an owned creature (`pip`,
`moss` or `nim`), and actor_id must match the credential. No command can set raw
needs, world time, inventory quantities, arbitrary effects or SQL.

```json
{
  "action": "feed_creature",
  "actor_id": "local-caretaker",
  "target_id": "pip",
  "parameters": { "food_id": "berries", "quantity": 1 },
  "idempotency_key": "a-client-generated-unique-request-id"
}
```

| Action | Parameters | Preconditions and effects |
|---|---|---|
| feed_creature | food_id: berries, quantity: integer 1–3 | Co-located at cottage; needs food; consume berries, reduce hunger by 20 each, floor 0 |
| encourage_rest | {} | Co-located at cottage/pond, energy below 100; restore up to 15 energy |
| encourage_play | {} | Co-located at square, energy at least 8; spend 8 energy, gain up to 10 happiness |
| visit_location | location_id: square/cottage/garden/pond/forest | Owned creature with at least 3 energy; move caretaker and creature together, spend 3 energy |
| plant_crop | {} | Co-located in garden; seed, crop space (<10) and 5 energy; consume seed, add crop, spend energy |
| tend_crop | {} | Co-located in garden; planted crop and 5 energy; harvest one crop for up to 2 berries, spend energy |
| explore | {} | Co-located at pond/forest and 10 energy; spend energy, gain up to 5 happiness |
| interact_creature | {} | Co-located owned creature; gain up to 3 happiness and retain factual visit memory |
| investigate_discovery | discovery_id: nonempty string | Owned active Glowing Seed quest at stage 0; at garden carrying the seed; progresses investigation |

Needs remain 0–100. Actor inventory is bounded 0–1000 per resource. Gardening is
an intentionally small immediate plant/harvest loop, not a crop growth simulation.
The initial actor receives 12 berries and 3 seeds. Normal creature simulation
still uses the baseline unlimited cottage food; these are finite caretaker supplies.
Precondition failures return 409 and do not consume resources or idempotency keys.

## Durable retries and concurrency

Generate a unique key per intended action and preserve it before sending. Retry
the exact command with the same key after an uncertain network/503 failure.
Successful retries return the original result with `duplicate: true`; no resource
cost or journal entry repeats. Changed command data under an accepted key returns
409 IDEMPOTENCY_CONFLICT. IDs are scoped by world and authenticated actor, not
credential, so rotation does not invalidate receipts. Validation/permission failures
have no accepted receipt; after resolving them, retry or use a new key.

Ticks and actions acquire the same world row lock. If a tick moves a creature
first, a queued action may fail its new location/needs preconditions. Re-observe
and decide a fresh action; do not bypass the precondition. State, actor inventory,
receipt and caretaker journal audit entry commit atomically. The journal records
initiating actor, affected creature, virtual/real/recording times, command, before
and after effects, and request ID. No action advances authoritative world time.

## Mac mini example

On a client with Node 24 and these project dependencies (no game DB credentials),
set WORLD_ID, CARETAKER_ACTOR_ID, CARETAKER_API_KEY securely and VILLAGE_URL to the
private HTTPS server. The example supports loopback HTTP for local checks only.
It observes, feeds Pip at the cottage and reads Pip's persisted state:

```sh
export VILLAGE_URL='http://127.0.0.1:3001'
npm run caretaker:example
```

The printed action key can be supplied as ACTION_KEY for an exact retry. The
example refuses redirects to avoid sending credentials to another destination
and uses a ten-second request timeout. It deliberately has no DB/Groq/framework
dependency at runtime beyond Node; run it with the project's tsx launcher.
No OpenClaw or Hermes coupling is introduced.

## HTTP acceptance check

With the built server running on port 3001 against the migrated local DB:

```sh
export TEST_DATABASE_URL="$DATABASE_URL"
npm run test:http
```

This creates an isolated local fixture, runs the separate example client twice,
checks one resource cost and one persisted journal entry, verifies private reads
and revocation, then leaves the fixture with a revoked test token. Use only the
same disposable database the server uses. No paid API calls are made.

Phase 4 adds discovered quest progress to caretaker observation and action results.
See [NARRATOR.md](NARRATOR.md) for separate roles, proposals and the quest sequence.

Phase 5 adds a separate cookie-authenticated operator UI/API described in
[OPERATOR.md](OPERATOR.md). Agent bearer routes do not accept those cookies.
Archived test worlds remain observable but reject new caretaker/narrator writes.

Phase 6 adds separate secret-authenticated /api/cron/tick and /api/cron/health
endpoints. Neither caretaker keys nor browser cookies grant scheduler authority.
See DEPLOYMENT.md for the one-shot client and pinned-world contract.
