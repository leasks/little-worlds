# Verified seed-42 result

Two fresh PostgreSQL test worlds completed 30 village days with identical semantic
fingerprints. See [report.md](report.md), [report.json](report.json),
[chronicle.md](chronicle.md) and [verification.json](verification.json).

- Each run: 2,880 ticks; 8,995 journal entries (8,640 autonomous activities,
  353 caretaker actions and two approved narrator events).
- The scripted seed quest was introduced on day 3 and completed on day 5.
  The repeated final action did not duplicate the charm reward.
- Three deliberate invalid/duplicate proposal probes were rejected. The mock
  provider's two outage attempts did not stop simulation. Simulation failures: 0.
- Live LLM calls/tokens/spend: 0. Mock reported units: 288 across three JSON
  responses; two outage attempts retained unknown usage and conservative reserves.
  No pricing was supplied; hosting costs were not estimated.

## What is worth following up

All three creatures' single most frequent autonomous activity was socialising.
Moss nevertheless gardened 801 times, compared with Pip's 103 and Nim's 194, and
Moss's patience grew by 4.005 points. Nim explored on 33.6667% of night steps versus
21.3095% of day steps, so the intended night preference is visible in this run.
These are observations from one fixed seed with a caretaker policy, not estimates
for every possible world.

Several friendships reached the ceiling of 100, and health stayed at 100 in every
recorded sample. That makes this a useful balance-testing baseline, not proof of
a rich long-term emotional model. Future work can test the relationship decision
bonus, resource pressure and additional explainable trait development. The two
narrator stories and quest progression were scripted interventions and are not
presented as emergent AI creativity.

Full input/context, event and daily-state exports stay in the local ignored
artifact directory; reproduce them using EXPERIMENT.md. The compact sample omits
runtime UUIDs/credentials and wall-clock metadata. No deployment or remote database
migration was run to produce these results.
