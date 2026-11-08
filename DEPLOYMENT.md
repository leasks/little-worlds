# Deployment — Phase 6 pending

The Next.js application, private operator sessions and PostgreSQL repositories
build and run locally. No hosted deployment, remote Supabase migration or live
Groq validation has been performed or authorised. Phases 0–5 are complete locally;
this is not yet a claim of production deployment readiness.

Phase 6 must supply the authenticated stateless scheduler/worker, Vercel scheduling
configuration, verified hosted DB connection/TLS and restricted login, operational
monitoring and recovery procedures. Browser timers and live processes are not
authoritative. Preserve the world state and restart services explicitly; do not
rely on a development process surviving an environment snapshot.

Before hosted use, configure HTTPS and an exact APP_ORIGIN, secure server-only
credentials, verified database permissions/networking, ingress protection and
backups. Leave LOCAL_TEST_TOOLS_ENABLED disabled. Operator setup is documented in
OPERATOR.md, AI budgets in NARRATOR.md, and local backup/restore in DATABASE.md.
Do not create paid resources, run remote migrations or deploy without explicit
approval.
