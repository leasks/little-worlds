# Little Worlds

A private virtual village with three original creatures and a persistent history.
**Phases 0–7 are implemented and validated locally.** PostgreSQL is authoritative;
the deterministic simulation works without AI. Caretaker actions, optional narrator
proposals, the Glowing Seed quest and the private operator website are available.
Scheduling/worker and deployment configuration are prepared, and the reproducible
30-day caretaker experiment is complete. Hosted validation/deployment approval
remain outstanding.

## Open the private village

Start with [OPERATOR.md](OPERATOR.md) for complete local PostgreSQL, operator-key,
login and server instructions. It includes a marked local test world with guarded
fast-forward/reset controls. No public demo or authentication bypass is provided.

## Engine-only workflow

Node 24 and npm are required. These commands need no credentials or paid services:

```sh
npm ci
npm run typecheck
npm test
npm run simulate
```

Without TEST_DATABASE_URL, SQL tests are reported as skipped, not passed.
`npm run simulate` writes docs/phase-1-report.json from a fixed-seed 30-village-day
fixture. This is not the full Phase 7 caretaker experiment.

- [DATABASE.md](DATABASE.md): migrations, persistence, role permissions and recovery.
- [API.md](API.md): restricted caretaker API and the Mac mini example.
- [NARRATOR.md](NARRATOR.md): proposals, approval, quests, optional Groq and budgets.
- [TESTING.md](TESTING.md): engine, PostgreSQL and desktop/mobile browser checks.
- [ARCHITECTURE.md](ARCHITECTURE.md): original architecture and checkpoint decisions.
- [docs/PHASES.md](docs/PHASES.md): actual completed checks and remaining phases.

No remote migrations, paid AI calls or deployment have been performed. Groq was
tested with mocks only; hosted Supabase remains unverified.

[DEPLOYMENT.md](DEPLOYMENT.md) covers the authenticated scheduler, Vercel/systemd
configuration, restricted Supabase login, preflight and verified recovery. Nothing
is deployed automatically; remote operations require explicit approval.

[EXPERIMENT.md](EXPERIMENT.md) runs Phase 7 against fresh local test worlds. Read
the [verified 30-day report](docs/experiment/report.md) and
[village chronicle](docs/experiment/chronicle.md). Mocked AI is clearly separated
from live usage; no paid calls or remote migrations were made.
