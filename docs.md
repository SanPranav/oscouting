# System Guide

This file explains how each system actually works in this repository. Read this if you need help or need to understand the background procceses with how it develops predictions.
## System Map

- `apps/tablet`: scout data capture
- `apps/aggregator`: import/sync control center
- `apps/dashboard`: strategy + prediction UI for match prep
- `apps/pitch` and `apps/pitch-6995`: alliance-selection presentation pages
- `apps/server`: API and orchestration layer
- `packages/db`: Prisma schema + DB client
- `packages/prediction`: prediction engine + tactical plan generation
- `packages/ai`: Lemonade/SmolLM client and normalization
- `packages/tba`: Blue Alliance sync
- `packages/scraper`: external scrape sync
- `packages/qr`: QR transfer utilities
- `packages/shared`: shared cross-package helpers
- `scripts/*`: direct CLI entry points

## Runtime Topology

`npm run dev` boots all six apps:

- API server: `http://localhost:2540`
- Tablet: `http://localhost:2541`
- Aggregator: `http://localhost:2542`
- Dashboard: `http://localhost:2543`
- Pitch: `http://localhost:2544`
- Pitch-6995: `http://localhost:2545`

Frontend apps call server routes. The server reads/writes the DB and invokes package logic for prediction, AI, and sync.

## How Each App Works

### Tablet (`apps/tablet`)

Input:
- Scout observations during/after matches.

Process:
- Structured forms collect teleop/auto/endgame metrics and notes.
- Data is prepared for offline handoff/import flows.

Output:
- Raw scouting payloads that become `matchScoutingReport` and related event data after import.

### Aggregator (`apps/aggregator`)

Input:
- Tablet exports, pasted JSON/CSV, external sync triggers.

Process:
- Calls import and sync endpoints on the server.
- Runs event maintenance actions (TBA sync, scrape, import pipelines).
- Shows operator progress and status while jobs run.

Output:
- Clean, merged event dataset in DB used by dashboard strategy and prediction.

### Dashboard (`apps/dashboard`)

Input:
- API responses for stats, leaderboard, schedules, predictions.

Process:
- Reads strategy endpoints and renders tactical context for drive team.
- Uses readiness mode (`team3749Ready`) to show balanced vs defense-heavy plan behavior.

Output:
- Match-level decision screen: predicted score split, threats, assignments, tactical calls.

### Pitch Pages (`apps/pitch`, `apps/pitch-6995`)

Input:
- Team messaging/content.

Process:
- Presentation-focused rendering for pick-list conversations.

Output:
- Standalone outreach pages, separate from core strategy workflow.

## How Backend Works

### API Server (`apps/server`)

Core idea:
- Everything funnels through server routes, then through DB/services/packages.

Main route groups:
- `src/routes/import.js`: ingestion endpoints (manual paste + batch/offline imports).
- `src/routes/scouting.js`: scouting data APIs.
- `src/routes/strategy.js`: stats, schedule, leaderboard, prediction, alliance probabilities.

Important services:
- `src/services/statbotics.js`: pulls Statbotics team-year EPA and normalizes fields.
- `src/services/scrape-jobs.js`: scrape orchestration.

Server responsibilities:
- Request validation
- Event data refresh orchestration
- Prediction endpoint plumbing
- Returning stable JSON contracts to frontends

## How Package Systems Work

### `packages/db`

What it does:
- Defines schema and migrations in Prisma.
- Exposes Prisma client used across server/prediction/sync code.

Where to look:
- `prisma/schema.prisma`
- `src/client.js`

### `packages/prediction` (Most Important Section)

Prediction entrypoint:
- `predictMatch(eventKey, matchKey, options)` in `src/predict-match.js`

What the prediction pipeline does, step by step:

1. Match key normalization and lookup
- Accepts flexible inputs (`12`, `qm12`, `event_qm12`, playoff forms like `qf2m1`).
- Normalizes key, then tries exact lookup, playoff lookup, and qual lookup fallbacks.

2. Alliance extraction
- Reads red/blue team numbers from the match row.

3. Data collection from multiple sources
- Pulls `teamAggregatedStat` rows for those teams.
- Pulls scouting rows (`matchScoutingReport`) for detailed observed performance.
- Pulls external import rows (`externalScoutImport`) when available.
- Pulls Statbotics EPA for all six teams.

4. Team stat reconstruction and fallback chain
- Builds per-team derived stats from scouting/external rows when needed.
- Merges existing aggregate stats with derived values (`mergeStatWithDerived`).
- If no local stats exist, can build a Statbotics-only fallback row.

5. Data-source labeling (quality tracking)
- Each team is tagged as one of:
	- `points`
	- `derived_points`
	- `ratings_only`
	- `statbotics_only`
	- `none`
- This drives confidence/coverage visibility and blending behavior.

6. Expected point model per team
- Base expected points come from average auto/teleop/endgame points.
- If point averages are missing, spider ratings are converted to point estimates.

7. Statbotics blending logic
- Local expected points are blended with Statbotics EPA components.
- Blend weights vary by source quality:
	- `points`: mostly local
	- `derived_points`: balanced
	- `ratings_only`: mostly Statbotics
	- `statbotics_only`: fully Statbotics
- If local total is zero, prediction fully defers to Statbotics components.

8. Alliance score computation
- Sums each team expected contribution.
- Applies disable and foul penalties to reduce inflated scores.
- Produces `redPredicted` and `bluePredicted`.

9. Weakness and strength extraction
- Builds opponent weaknesses/strengths from:
	- objective metrics (disable rate, foul rate, cycle speed, reliability)
	- parsed scout-note signals from recent matches

10. Narrative generation
- Tries AI short narrative via `callSmolLM`.
- Falls back to deterministic text if AI is unavailable.

11. Tactical plan generation
- Runs deterministic tactical builder when focus team is in the match.
- Calculates threat score from teleop pace, cycle speed, reliability, and EPA.
- Produces:
	- primary/secondary threat
	- auto recommendation
	- offense and defense plans
	- shift-by-shift strategy blocks
	- explicit team assignments
- Reads readiness mode:
	- ready: balanced mode
	- not ready: defense-heavy and lower-risk mode

12. AI tactical enrichment (optional)
- Sends tactical context to Lemonade/SmolLM with structured prompt.
- If returned, overlays:
	- shift calls
	- defense calls
	- offense calls
	- habit counters
	- summary
- If not returned, deterministic tactical plan remains.

Prediction response shape highlights:
- `redPredicted`, `bluePredicted`
- `dataQuality` coverage by alliance/team
- `opponentWeaknesses`, `opponentStrengths`
- `narrative`
- `tacticalPlan`

Exact prediction formulas and why each multiplier/divider is there:

### Readable Equation Set

- Clamp helper:

```text
clamp(x, min, max) = max(min, min(x, max))
```

- Base expected points per team (`expectedPointsFromRow`):

```text
autoPoints    = avgAutoTotalPoints    > 0 ? avgAutoTotalPoints    : (spiderAuto    / 100) * 12
teleopPoints  = avgTeleopTotalPoints  > 0 ? avgTeleopTotalPoints  : (spiderTeleop  / 100) * 35
endgamePoints = avgEndgamePoints      > 0 ? avgEndgamePoints      : (spiderEndgame / 100) * 20
```

Why divide by 100 and multiply by 12/35/20:
- Spider metrics are 0-100 ratings, so `/100` converts them to a 0-1 fraction.
- `*12`, `*35`, and `*20` convert that fraction into phase-level point estimates (auto, teleop, endgame scales used by this model).

- Local-vs-Statbotics blending (`blendExpectedPointsWithStatbotics`):

```text
localWeight:
  points         -> 0.80
  derived_points -> 0.65
  ratings_only   -> 0.35
  statbotics_only-> 0.00
  default        -> localTotal > 0 ? 0.45 : 0.00

if localTotal <= 0, force localWeight = 0.00
statboticsWeight = 1 - localWeight

blendedAuto    = localAuto    * localWeight + statboticsAutoEPA    * statboticsWeight
blendedTeleop  = localTeleop  * localWeight + statboticsTeleopEPA  * statboticsWeight
blendedEndgame = localEndgame * localWeight + statboticsEndgameEPA * statboticsWeight
```

Why multiply by weights and add:
- The multipliers are confidence weights (how much to trust each source).
- Higher local-data quality gets larger `localWeight`; weaker local data leans toward Statbotics.
- Adding weighted terms creates a blended estimate instead of hard switching.

- Team contribution to alliance score:

```text
disablePenalty = 1 - disableRate
foulPenalty    = 1 - min(0.18, foulRate * 0.06)

teamContribution =
  (blendedAuto + blendedTeleop + blendedEndgame)
  * disablePenalty
  * foulPenalty
```

Why multiply by penalties:
- Penalties scale down optimistic point output for risky teams.
- `disableRate` directly reduces expected scoring uptime.
- `foulRate * 0.06` converts foul frequency into a capped penalty factor (`max 0.18`) so fouls hurt but cannot zero out a team alone.

- Alliance prediction:

```text
redPredicted  = round2(sum(teamContribution for red alliance teams))
bluePredicted = round2(sum(teamContribution for blue alliance teams))
```

Why sum:
- Alliances score as a combined unit, so each team's adjusted contribution is additive.

- Confidence and coverage:

```text
confidence = (redEffectiveStatsCount + blueEffectiveStatsCount >= 4) ? "medium" : "low"
pointsCoveragePct = round1((pointsTeams / totalTeams) * 100)
```

Why divide in coverage:
- `pointsTeams / totalTeams` measures the fraction of teams backed by point-level data, then `*100` makes it a readable percent.

- Threat score (`threatScore`) for tactical priority:

```text
threat =
  spiderTeleop * 0.40
  + spiderCycleSpeed * 0.35
  + spiderReliability * 0.15
  + min(statboticsEPA * 10, 100) * 0.10
```

Why these multipliers:
- Teleop (`0.40`) and cycle speed (`0.35`) dominate because they drive real-time scoring pressure.
- Reliability (`0.15`) captures consistency under match stress.
- EPA (`0.10`) is included as an external correction signal, but with lower weight to avoid overpowering local match context.

- Tactical auto-call switch:

```text
primaryAutoScore = (primaryThreat.spiderAuto / 100) * 12
ourAutoScore     = average((ally.spiderAuto / 100) * 12)

if primaryAutoScore > ourAutoScore + 3 => conservative auto call
else                                    => aggressive auto call
```

Why `+3` margin:
- It is a buffer threshold so the strategy only flips conservative when opponent auto edge is meaningfully above expected variance.

- Derived stat formulas (`buildTeamDerivedStat`) when direct point averages are missing:

```text
spiderAuto =
  autoAvg > 0
    ? clamp(autoAvg * 5, 0, 100)
    : clamp(avg(autoMobility ? 35 : 0), 0, 100)

spiderTeleop =
  teleAvg > 0
    ? clamp(teleAvg * 3, 0, 100)
    : clamp((driverSpeed / 5) * 100 * 0.9, 0, 100)

spiderDefense = clamp((driverDefense / 5) * 100, 0, 100)

spiderCycleSpeed =
  clamp(driverSpeed > 0 ? (driverSpeed / 5) * 100 : 50 + (teleAvg / 4), 0, 100)

spiderEndgame =
  clamp(endAvg > 0 ? endAvg * 3 : climbSuccessRate * 70, 0, 100)

spiderReliability =
  clamp(((1 - disableRate) * 0.75 + (1 - clamp(foulRate / 3, 0, 1)) * 0.25) * 100, 0, 100)
```

Why these multiply/divide constants:
- `/5` appears where scout ratings are on a 1-5 scale and are normalized to 0-1 first.
- `*100` converts normalized fractions to 0-100 spider metrics.
- `*5`, `*3`, `*3` convert point-like means into spider-scale intensity proxies.
- Reliability weights `0.75` and `0.25` bias toward availability (disable risk) more than foul behavior.

Exact strategy route scoring formulas (`apps/server/src/routes/strategy.js`):

- Pick leaderboard (`computePickLeaderboard`):
	- `rankScore = rank > 0 ? clamp(((maxRank - rank + 1) / maxRank) * 100, 0, 100) : 50`
	- `rpScore = clamp(rankingPoints * 18, 0, 100)`
	- `epaScore = maxEpa > 0 ? clamp((effectiveEpa / maxEpa) * 100, 0, 100) : 0`
	- `reportScore = clamp(autoFuelAvg * 4 + teleFuelAvg * 2.5 + endgamePointsAvg * 2, 0, 100)`
	- `capability = auto*0.13 + teleop*0.23 + defense*0.10 + cycle*0.14 + reliability*0.12 + endgame*0.10 + rpScore*0.06 + rankScore*0.04 + epaScore*0.08`
	- `durability = clamp(reliability - disableRate*65 - foulRate*10 + min(12, matchesScouted*0.9), 0, 100)`
	- `defaultFit = defense*0.35 + endgame*0.35 + cycle*0.30`
	- `needDefense = clamp((65 - ourDefense) / 65, 0, 1)`
	- `needScoring = clamp((80 - ourTeleop) / 80, 0, 1)`
	- `fit = clamp(defaultFit*0.45 + defense*needDefense*0.20 + ((teleop + cycle)/2)*needScoring*0.20 + clamp(climbSuccessRate*100,0,100)*0.15, 0, 100)`
	- `pickScore = capability*0.42 + durability*0.22 + fit*0.20 + reportScore*0.16`

Why these multipliers/dividers:
- `*0.42` on capability keeps raw on-field production as the primary signal.
- `*0.22` on durability prevents fragile robots from being overranked.
- `*0.20` on fit rewards alliance-role compatibility, not just raw output.
- `*0.16` on reportScore lets recent observed performance influence ranking without dominating.
- `rankingPoints * 18` scales RP into the same 0-100-ish range as spider metrics.
- `min(12, matchesScouted*0.9)` gives a capped sample-size bonus so larger samples help confidence but cannot overpower performance.
- `((65 - ourDefense) / 65)` and `((80 - ourTeleop) / 80)` are normalized need factors: divide by target baseline to create 0-1 demand signals.

- Alliance pick probability scoring (`computeAlliancePickProbabilities` -> `scoreCandidateForCaptain`):
	- `candidatePerformance = clamp(teleop*0.40 + defense*0.20 + reliability*0.25 + endgame*0.15, 0, 100)`
	- `needTeleop = clamp((75 - captainTeleop) / 75, 0, 1)`
	- `needDefense = clamp((70 - captainDefense) / 70, 0, 1)`
	- `needEndgame = clamp((70 - captainEndgame) / 70, 0, 1)`
	- `fitScore = clamp(teleop*(0.35 + needTeleop*0.35) + defense*(0.20 + needDefense*0.35) + endgame*(0.15 + needEndgame*0.25), 0, 100)`
	- Round weights:
		- Round 1: `{ rank: 0.36, rp: 0.16, perf: 0.30, fit: 0.18 }`
		- Round 2: `{ rank: 0.22, rp: 0.10, perf: 0.32, fit: 0.36 }`
		- Round 3: `{ rank: 0.16, rp: 0.08, perf: 0.30, fit: 0.46 }`
	- `captainBias = maxRp > 0 ? clamp((captainRankingPoints / maxRp) * 5, 0, 5) : 0`
	- `composite = clamp(rankScore*wRank + rpScore*wRp + candidatePerformance*wPerf + fitScore*wFit + captainBias, 0, 100)`
	- Returned value: `probabilityScore = round2(composite)`

Why these multipliers/dividers:
- Round-weight sets intentionally shift toward fit in later rounds (`fit` weight rises from 0.18 to 0.46) because role completion matters more after first pick.
- `captainBias` adds a small max `+5` adjustment so stronger captains have mild preference influence without overriding candidate quality.
- `rankingPoints / maxRp` and rank normalization divide by event maxima to keep scores comparable across events with different scales.

### `packages/ai`

What it does:
- Handles model call plumbing against Lemonade/OpenAI-compatible endpoint.
- Normalizes response format for callers.

How it is used:
- Prediction package calls AI for short narrative and tactical enrichment.
- System is resilient: deterministic fallbacks exist when AI fails.

### `packages/tba`

What it does:
- Pulls event/schedule data from The Blue Alliance into local DB model.

### `packages/scraper`

What it does:
- Pulls/normalizes non-TBA external data and stores it for analysis.

### `packages/qr`

What it does:
- Encodes/decodes compact payloads for QR-based transfer workflows.

### `packages/shared`

What it does:
- Shared helpers/constants used across apps and packages.

## Script Flows

- `scripts/import-csv.js`: bulk import path for scouting data.
- `scripts/export-csv.js`: export snapshot path for sharing/backup.
- `scripts/sync-tba.js`: one-shot TBA sync runner.
- `scripts/sync-external.js`: one-shot external scrape/sync runner.
- `scripts/run-ai.js`: local AI run/check helper.

## End-to-End Event Flow

1. Scouts capture data on tablet.
2. Operators import and sync from aggregator.
3. Server stores and enriches event data.
4. Prediction engine computes scores, threats, and tactical plan.
5. Dashboard displays match plan for the drive team.
6. Pitch pages support alliance-selection communication.

## Where To Edit By Concern

- Scout form or collection UX: `apps/tablet`
- Import actions/operator workflows: `apps/aggregator`
- Match strategy presentation: `apps/dashboard`
- API contract/endpoint behavior: `apps/server`
- Prediction math/tactical logic: `packages/prediction/src/predict-match.js`
- Schema/data model: `packages/db/prisma/schema.prisma`
- AI prompting/normalization: `packages/ai`
- Sync logic: `packages/tba` and `packages/scraper`

## Quick Commands

```bash
npm run dev
npm run dev:server
npm run dev:tablet
npm run dev:aggregator
npm run dev:dashboard
npm run dev:pitch
npm run dev:pitch6995
```

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

Update this document whenever prediction weights, fallback rules, or route contracts change.