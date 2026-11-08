# Validation

## Local prerequisites

Use Node 24, npm and the migrated disposable PostgreSQL service from DATABASE.md.
No test uses paid APIs. Do not point SQL or browser tests at a real live world.

```sh
npm ci
npm run typecheck
npm test
npm run simulate
npm run build
```

Without TEST_DATABASE_URL, Vitest reports DB suites as skipped; this is not SQL
validation. The engine suite includes a fixed-seed reproducible 30-village-day run,
bounds, retry behavior, invalid state and bounded retained catch-up backlog.
Narrative/unit tests cover effects, objective building blocks, progression and
mocked provider output/timeout/error handling.

## PostgreSQL tests

```sh
export TEST_DATABASE_URL="$DATABASE_URL"
npm test
# Or run only the four PostgreSQL suites, requiring a URL:
npm run test:db
```

Tests exercise the restricted runtime role and use a migration owner only for
schema checks, isolated fixture setup and fault injection. Coverage includes
same/different-ID concurrent ticks, late-write failure, backend termination/retry,
reload/reseed, append-only history, world boundaries, action retries, resource and
permission checks, scoped narrator proposals, manual/stale approval, one-time quest
rewards, concurrent daily request/token budgets, conservative usage accounting,
AI outages, CSRF/origin checks, session expiry/logout/root revocation, failed-login
limits, operator receipt conflicts, pause/resume, live-control denial and preserved
history on confirmed local reset. Database fixtures use new UUID worlds.

## Browser tests

```sh
npm run build
npm run test:browser
```

TEST_DATABASE_URL is required. Playwright starts/stops its own production server
on loopback port 3100; keep that port free. It uses installed system Chromium if
available, otherwise Playwright Chromium (`npx playwright install chromium`), or
PLAYWRIGHT_CHROMIUM_EXECUTABLE pointing to a trusted executable. It runs desktop
1440px and mobile 390px layouts without bypassing operator authentication.

Tests cover private login/logout/cookies, keyboard and pointer map selection,
creature profiles, horizontal overflow, test ticks and pause/resume, journal
filters/effects, escaped proposal text, approval, full quest progress, confirmed
reset/history preservation and root credential revocation. They create isolated
worlds and generated credentials, revoking access afterward. Screenshots and
failure traces live under ignored test-results. Vitest excludes Playwright specs.

## Separate API clients

With the built server running locally on port 3001 against the same migrated DB:

```sh
npm run test:http
npm run test:narrative-http
```

These independent smoke clients are documented in API.md and NARRATOR.md. They
exercise real HTTP without Groq. The Phase 5 browser suite also exercises the
narrator/caretaker APIs to complete the displayed quest. No live model availability
claim follows from mocked provider tests. The full 30-day caretaker chronicle and
scheduled deployment tests remain Phases 7 and 6 respectively.
