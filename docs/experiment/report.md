# The First 30 Days — experiment report

Status: **complete** · seed **42** · 30 village days · 2880 ticks.

Semantic fingerprint: `a51d46c8bb31dfe1158aeefbb8e14d8ac4d0336cc31e4d02e784aff6aedff430`. Source fingerprint: `e799cc4d1a4d2454702d6a677f19b3a13cc0604a97c6eeac9c1ba890c078dc9b`.

Journal entries: 8995. Accepted caretaker actions: 353. Narrator events: 2. Rejected proposals: 3. Simulation failures: 0.

Mock attempts: 5; reported mock units: 288; reserved units: 2560; unknown usage attempts: 2. **Live requests/tokens/spend: 0.** Hosting costs are unmetered.

No pricing was supplied; no hypothetical token-cost estimate is claimed.

## Pip

Autonomous activity counts: explore 628, socialise 1019, play 368, rest 356, eat 406, garden 103.

Final needs: hunger 57.5, energy 68.5, happiness 99.5, health 100. Patience: 20 → 20.515. Retained/observed memories: 20/64.

Relationships: nim 100, moss 100.

## Moss

Autonomous activity counts: rest 374, play 276, explore 100, socialise 920, garden 801, eat 409.

Final needs: hunger 56.25, energy 76.25, happiness 100, health 100. Patience: 90 → 94.005. Retained/observed memories: 20/62.

Relationships: pip 100.

## Nim

Autonomous activity counts: socialise 799, garden 194, explore 762, play 457, eat 407, rest 261.

Final needs: hunger 63.75, energy 37, happiness 100, health 100. Patience: 75 → 75.97. Retained/observed memories: 20/60.

Relationships: pip 100.

## Quest and rejection checks

Quest: completed; completion day: 5. Rejections: INVALID_PROPOSAL 2, DUPLICATE_PROPOSAL 1.

## Observed behavior

- Pip's most frequent autonomous activity was socialise \(1019 steps\).
- Pip's patience grew by 0.515 through recorded gardening practice.
- Moss's most frequent autonomous activity was socialise \(920 steps\).
- Moss's patience grew by 4.005 through recorded gardening practice.
- Nim's most frequent autonomous activity was socialise \(799 steps\).
- Nim's patience grew by 0.97 through recorded gardening practice.
- Nim explored on 33.6667% of night steps and 21.3095% of day steps.

## Scope and limits

- Caretaker policy and two accepted story beats are scripted interventions, not emergent AI creativity.
- The harness uses authenticated repository commands, not HTTP transport or its wall-clock rate limits.
- Autonomous cottage food is unlimited; caretaker inventory is finite.
- Need/relationship saturation and only gardening-driven patience development are current engine limitations.
- Daily states and full event/input ledgers are retained; only the compact sample is committed.
- Mock token units are not live Groq usage or a vendor bill. Hosting is unmetered.
- Days cover each ordered care/story cycle followed by 96 fixed ticks, ending at the next midnight.
- Interrupted/failed runs are preserved as incomplete; repeat in a new isolated world rather than resuming uncertain AI attempts.

See report.json for all metrics, daily records and recorded memories; chronicle.md follows the journal. Full raw ledgers are in the local artifact directory.
