# Security status

This is a private prototype validated locally, not a completed hosted security
review. Operator website access uses hashed, scoped, expiring and revocable DB
credentials exchanged for opaque sessions. All game state stays behind authenticated
server APIs. No public registration or development authentication bypass exists.

## Browser and operator boundary

Session secrets are random 256-bit values; only hashes are stored in PostgreSQL.
Cookies are HttpOnly, host-only and SameSite=Strict, with Secure enabled outside
loopback HTTP. Sessions expire within eight hours and respect credential expiry,
revocation and root revocation across test resets. Login attempts and requests
have persisted limits. Exact Origin checks protect every cookie mutation, including
login/logout. Long-lived keys are not stored by the app in browser storage or
returned in API bodies. Private responses are no-store; framing is denied.

Pending UI command metadata contains only operation/world/request identifiers.
Server control receipts enforce idempotency; explicit world binding rejects stale
commands after a session switch. Privileged operations have immutable audit records.
Local test acceleration/reset requires both an explicitly marked test world and
a local-only server flag. Reset archives history rather than truncating it.

## Agent and database boundary

Caretaker, narrator and operator credentials have separate roles, bound to a world
and actor. Ownership, inventory, co-location, energy and preconditions are checked
before caretaker actions. Tokens are stored as hashes, never plaintext. API inputs
use strict Zod schemas and streamed 8 KiB limits. Scoped IDs use bound SQL parameters.

Private PostgreSQL tables use RLS and a restricted backend group. External agents
receive no DB login. Runtime access cannot mint ordinary credentials, edit the
catalogue or mutate existing journal/receipt records. A narrow test-reset helper
can derive only temporary operator access between marked test worlds; it cannot
issue other roles or copy live access. See DATABASE.md for exact grants and caveats.

## AI boundary

The optional provider runs independently of simulation. Missing Groq configuration
makes it inert. Model requests have bounded context/output, timeout/retry limits,
persisted request/token reservations and sanitized error records. Provider bodies,
keys and raw network errors are not logged. Model IDs remain operator supplied.

Narrator output is untrusted data. Schema, catalogue, participant, location,
prerequisite, consistency, pacing, rarity and duplicate checks run before effects
commit under the world lock. Manual approval is on by default and revalidates
current state. Rejected proposals cannot partially apply. AI cannot execute SQL,
code or arbitrary conditions, nor skip quest stages. Raw proposal text is rendered
as text; browser tests verify injected markup does not execute.

## Secrets and hosting

Environment files are ignored except the placeholder-only .env.example. Never put
server credentials in NEXT_PUBLIC variables, client bundles, logs or tracked files.
The current opaque DB sessions do not use OPERATOR_AUTH_SECRET; that name is
reserved for future authentication providers. Use HTTPS and the exact APP_ORIGIN
when hosting. Verify database TLS, role membership, ingress/network limits and
backups before deployment. Coarse invalid-token ingress throttling remains a
hosting requirement. No hosted deployment, remote migration, live Groq call,
formal security audit or accessibility certification is claimed.
