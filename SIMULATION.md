# Phase 1 simulation

Virtual milliseconds advance by fixed real intervals multiplied by the world's
rate (default 3). Ticks default to five real minutes. Each request runs at most
96 steps, retaining the unsimulated real-time backlog. State includes the xorshift32
seed, virtual time and last simulated real time. Identical state and explicit
inputs produce identical output. No real clock, network or browser APIs are read
inside the engine. Local IDs provide repeat protection within retained state;
Phase 2 must add transaction-backed durable receipts and locking.

Needs and traits are 0–100. Hunger rises, energy/happiness fall, needs take priority,
and weighted rules consider preferences, traits, friendships, rain and night.
Nim favours night exploration. Cottage food/rest are unlimited baseline resources;
finite caretaker inventory and resource validation belong to Phase 3. Gardening
gradually increases patience with journalled reasons. Important daily memories
are capped at 20; complete activity history remains in the local journal.

`npm run simulate` fast-forwards an isolated fixture by 30 days, without changing
production settings. No LLM calls are made. This phase does not implement quests,
AI-assisted decisions, concurrency, database persistence or external caretaker actions.

Phase 2 wraps this transition in PostgreSQL row locks, transactions and durable
receipts; see DATABASE.md. Local fixture semantics remain unchanged.

Phase 4 narrative events and caretaker quest progression use the same DB world
lock as ticks. No LLM is called by the simulation loop. AI outages/budget failures
are independent worker outcomes and leave clock/creature behavior operational.
Quest stage changes come from ordered predefined objectives, with rewards recorded
in the same action transaction. NARRATOR.md describes the registered seed quest.

Phase 7's persistent experiment is distinct from the original Phase 1 fixture.
It preserves the multiplier/interval, supplies explicit logical test tick times,
and exercises caretaker/narrator/quest transactions with retained inputs and daily
checkpoints. Two fresh full runs must match semantic state/history fingerprints.
See EXPERIMENT.md; no live world can be selected as an experiment target.
