# The First 30 Days experiment (Phase 7)

The experiment exercises a persistent local world, three creatures, an authenticated
rule-based caretaker, approved mock narrator proposals, the seed quest and failure
handling. It runs without network/model calls. It is not a live Groq/Mac mini trial,
a hosted deployment, or evidence of open-ended AI creativity.

The committed seed-42 result is in docs/experiment/report.md, report.json and
chronicle.md. verification.json records two matching semantic fingerprints. Full
local inputs, journal and daily states are excluded from Git by default.

## Run a reproducible experiment

From the repository root, use Node 24 and the disposable local PostgreSQL setup
from DATABASE.md. Apply migration 0007 before running:

```sh
npm ci
export DATABASE_URL='postgresql://postgres:local-development-only@127.0.0.1:54329/little_worlds'
npm run db:migrate
export EXPERIMENT_DATABASE_URL="$DATABASE_URL"
npm run experiment -- --verify --output .local/experiments/my-first-30-days
```

The runner creates two NEW random-UUID worlds, marks them as test worlds, and
compares their results. It refuses remote database destinations; there is no
remote-approval flag for experiments. TEST_DATABASE_URL is a fallback if
EXPERIMENT_DATABASE_URL is unset; DATABASE_URL alone is deliberately not enough.
Use the local migration owner for fixture creation/credential provisioning; all
actual game operations use the restricted runtime pool. It never accepts an
existing world as a simulation target or changes another world's clock/settings.
Output directories must not already exist. Progress prints every five days.

Options: --seed (1–4294967295, default 42), --days (1–30, default 30),
--narrator mocked|disabled, --verify, --output, and optional
--usd-per-million-mock-tokens (a nonnegative uniform hypothetical rate).
No live provider option exists and Groq environment keys are never read by this
runner. No paid API resource is created. A verified 30-day mocked run may use
--publish-sample to write the three compact reports and portable verification into
docs/experiment, but only if that directory is absent. The checked-in sample is
not overwritten automatically. To refresh it, review/copy a new verified result
explicitly rather than deleting unknown user files.

## Version 1 protocol

World clock starts at logical real timestamp 0, virtual time 0, unchanged multiplier
3 and unchanged five-minute real tick interval. These are isolated test timestamps,
not a claim that real time passed or that the world was created in 1970. Each
experiment day performs its planned care/story cycle, then advances exactly 96
validated fixed ticks to the following midnight. Thirty elapsed days end at the
start of village day 31. No production validation or persistence rule is bypassed.

The caretaker sees only its permitted observation projection and uses typed
commands with stable idempotency keys. Each day it visits/feeds/rests/interacts
with its creatures as needs/resources allow. Pip plays every third day, Moss's
limited seeds support weekly gardening, and Nim explores the pond every fourth
day. No inventory is refilled by fixture magic. Normal autonomous creatures still
have the baseline unlimited cottage food; this is distinct from finite caretaker
supplies. Rest/travel/resource preconditions and all repository permissions remain
active. The accelerated harness calls authenticated repository methods directly;
it does not claim to test external HTTP transport or its real-minute request limit.
Those boundaries have separate API/browser tests.

With narration mocked, the registered protocol is:

| Day | Intervention |
|---|---|
| 3 | Position Pip/Moss through caretaker actions; mock seed proposal; operator approval |
| 4 | Investigate seed, then visit pond through real validated quest actions |
| 5 | Plant/tend the garden; complete quest; repeat the tend command to test one-time effects |
| 9 | Valid JSON with an illegal effect; record/audit the rejection |
| 12 | Repeat the day's committed tick ID; verify no duplicate events |
| 15 | Simulate a provider outage through both bounded attempts; simulation continues |
| 21 | A second approved, everyday social story at the square |
| 24 | Repeat the seed proposal under another request ID; semantic duplicate rejection |
| 27 | Propose an unregistered item; schema/catalogue rejection |

The mock implements the production provider interface and actual usage reservation
path. Its model is labelled scripted-mock-v1. Each attempt reserves 512 mock units;
a successful JSON response reports 96 mock units. The isolated world's real-UTC-day
budget is explicitly six requests/12,000 units, enough for five attempts in minutes.
Manual approval, ordinary/rare pacing and referential checks stay enabled. Disabled
mode makes no mock calls and starts no quest. Scripted beats are interventions,
not spontaneous discoveries or emergent story generation.

## What persists and what is compared

Migration 0007 adds world-scoped experiment_runs, experiment_inputs and
experiment_days behind RLS. Input intent is persisted BEFORE execution, followed
by its result. Daily checkpoints include state, creature profiles, caretaker
resources and quest progress. Completed/failed records and checkpoints are
protected against modification. All run credentials are generated privately,
stored only as hashes and revoked afterward. A completed or failed world is
archived; history is retained for inspection. A trusted local operator may provision
a fresh read credential later using OPERATOR.md.

There is no automatic resume from uncertain AI calls. Unexpected errors abort,
retain evidence, mark/archive a failed run when the DB is reachable and exit
nonzero. A killed process may leave status running with pending inputs; that is
incomplete/unknown evidence, not proof a process is still alive or a run completed.
Repeat in a fresh isolated world. Do not reset inputs or reuse uncertain provider
attempt IDs. For inspection, use DB checkpoints/input status and export only what
can be traced; untraceable journal effects are rejected by the report builder.

The semantic SHA-256 covers configuration, initial/final state, all daily states,
recorded input decisions/results, ordered journal payloads/effects, proposal
outcomes and mock usage. Generated world/proposal IDs are replaced by stable
logical identities. Event order follows recorded operation sequence, virtual time
and creature order rather than random UUID sorting. Wall-clock caretaker/narrator
journal timestamps and runtime credential metadata are omitted; simulated real
timestamps remain. Needs, traits, relationships, memories, inventories, PRNG state,
quest clues, accepted/rejected decisions and explicit mock contexts are retained.
A different effect or untraced event changes/refuses verification even if final
counts happen to match. Byte-identical raw runtime artifacts are not claimed.

A separate source fingerprint hashes src/, migration SQL, the CLI and package-lock
contents; it does not depend on Git metadata or generated reports. The manifest
records Node version. Reproducibility requires the same source/protocol/config;
it is not a statistical guarantee across different seeds or changed policies.

## Artifacts and re-export

Each run directory contains:

- report.json: structured metrics, need ranges, trait/relationship changes,
  recorded memories, daily activity/weather/resources, quest progress, rejection
  codes, simulation failures, mock usage/cost assumptions and validation checks.
- report.md and chronicle.md: readable summary and per-day chronicle derived from
  accepted journal entries, with mock-service notes separated from village story.
- inputs.json, journal.json, daily-states.json and semantic.json: complete local
  inspectable evidence. No raw keys, credentials or connection strings are exported.
- manifest.json and SHA256SUMS: provenance plus artifact checksums.

Validate an artifact directory using `sha256sum -c SHA256SUMS` inside it. Keep raw
exports private/outside public web directories. The .local directory is ignored;
files are written with restrictive modes. The root verification.json records both
world IDs/hashes and verified true/false. A mismatch exits nonzero and does not
publish the compact sample. Completion checks require the full horizon, exact
2,880 ticks/8,640 simulation events for 30 days, unique IDs, all inputs completed,
matched action/narrator event counts, unchanged clock settings and final checkpoint,
and the completed one-time seed reward when required by the mocked profile.

A completed archived experiment can be re-exported without rerunning it:

```sh
npm run experiment -- --export '<recorded-world-UUID>' --output .local/experiments/re-export
```

Export accepts no simulation/verification/pricing overrides. Incomplete results
are explicitly labelled and return nonzero; unknown/untraced effects require
inspection rather than an invented success. A filesystem-write failure does not
erase the retained database report/history. Use a new destination for export.
The existing recovery checker also discovers these three new tables when comparing
a paused/archived experiment backup with an isolated restore (DEPLOYMENT.md).

## Cost interpretation and limits

All live LLM requests, live model tokens and live API spend in this protocol are
zero. Mock reported/reserved units and unknown outage usage are listed separately.
An optional uniform USD/million rate produces only a hypothetical known/reserved
mock-unit estimate; it is not Groq input/output pricing or a vendor bill. Hardware,
database and hosting costs are unmetered and not invented. With no price supplied,
hypothetical estimates are null. Monetary values retain up to eight decimal places.

Results show the current simple engine, including relationship/need ceilings,
unlimited autonomous cottage food and gardening-only patience development. A
scripted quest succeeding is integration evidence, not evidence that an LLM
invented a coherent quest. The caretaker policy is rule-based and no OpenClaw,
Hermes, live Mac mini or hosted Supabase/Vercel operation is claimed.

## Tests

`npm test` with TEST_DATABASE_URL runs unit checks plus two complete 30-day worlds,
matching reports/fingerprints, disabled narration, local-world guards, immutable
records and an injected failed checkpoint. Unit checks also reject missing event
history, changed effects, untraced events and premature completion, and verify
safe Markdown escaping and explicit hypothetical pricing. Tests make no paid calls.
