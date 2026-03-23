# Team 3749 Scouting and Prediction System

Monorepo for Team 3749 event scouting, data aggregation, and match strategy generation.

## Current Stack

- Frontend: React + Vite (`apps/tablet`, `apps/aggregator`, `apps/dashboard`, `apps/pitch`)
- Backend: Express (`apps/server`)
- Database: Prisma + SQLite (`packages/db/prisma/dev.db`)
- Prediction Engine: `packages/prediction`
- AI Narrative: Lemonade/SmolLM integration (`packages/ai`)
- External Data: Statbotics team-year EPA enrichment

## What Is New

### Statbotics integration (working across features)

- Server now fetches team-year data from Statbotics endpoint:
  - `https://api.statbotics.io/v3/team_year/{team}/{year}`
- Data is normalized and cached in:
  - `apps/server/src/services/statbotics.js`
- Enriched data is exposed in strategy endpoints and used in:
  - Team stats responses
  - Pick leaderboard scoring
  - Match threat analysis and tactical planning

Mapped fields include:

- `epa`: `epa.total_points.mean`
- `autoEPA`: `epa.breakdown.auto_points`
- `teleopEPA`: `epa.breakdown.teleop_points`
- `endgameEPA`: `epa.breakdown.endgame_points`
- `normEPA`: `epa.norm`
- `rank`, `percentile`: `epa.ranks.total`

### Predictor tactical strategy update

- Tactical plan is personalized and drive-team focused.
- Strategy mode is controlled by 3749 readiness (`team3749Ready=true|false`).
- Output includes:
  - primary threat
  - auto lane/cross-line call
  - offense plan (shoot + cycle behavior)
  - defense plan (team-targeted disruption)
  - shift-by-shift plan with explicit team assignments
  - AI-enhanced shift calls and habit counters from Lemonade
- Dashboard tactical card now surfaces readiness mode, assignments, habits, and AI calls.

### AI tactical meta-prompting

- Tactical AI runs through Lemonade (`callSmolLM`) with a structured strategy meta-prompt.
- Prompting is tuned to 2026 match phases:
  - auto mobility + lane control
  - teleop cycle efficiency + deny windows
  - endgame value protection + foul minimization
- Deterministic tactical logic remains as fallback if AI is unavailable.

### Aggregator loading progress

- Aggregator now shows a loading progress bar and status label for:
  - stats load
  - imports
  - scrape/sync actions
  - import + predict flow
- Existing table data remains visible while loading.
- Loading bars are milestone-based and do not perform extra stream parsing work.

### Optix visual theme

- Dashboard, Aggregator, and Tablet use a dark-first black palette for low eye strain.
- Theme is applied via shared tokenized CSS (`index.css`) in each app.

## Repository Layout

```text
apps/
  tablet/       Offline scouting client
  aggregator/   Event data import and stats console
  dashboard/    Drive-team strategy and match prediction UI
  pitch/        Standalone alliance-selection advertisement page for Team 3749
  server/       API routes for import, strategy, and sync

packages/
  db/           Prisma schema and client
  prediction/   Match prediction and tactical planning
  ai/           Lemonade client integration
  scraper/      External scrape pipeline
  tba/          TBA sync utilities
  shared/       Shared utils/types

scripts/
  sync-tba.js
  run-ai.js
  export-csv.js
```

## Local Setup

```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
```

## Run Locally

Start all apps:

```bash
npm run dev
```

Or start individually:

```bash
npm run dev:server
npm run dev:tablet
npm run dev:aggregator
npm run dev:dashboard
npm run dev:pitch
```

## Lemonade AI Setup (Real Local LLM)

This project uses OpenAI-compatible Lemonade endpoints for tactical AI calls.

### 1) Configure `.env`

Use these values:

```bash
LEMONADE_BASE=http://localhost:8080/api/v1
LEMONADE_MODEL=SmolLM3-3B-GGUF
```

Notes:

- The project will also try legacy endpoints automatically if needed (`/v1` and port `8000`).
- If the model runtime is down, Brick AI now returns fallback scouting guidance instead of HTTP 500.

### 2) Install Lemonade Server (Linux)

Use the official Lemonade Server install docs:

- https://lemonade-server.ai/install_options.html

After install, verify CLI exists:

```bash
lemonade-server --version
```

### 3) Start server and model

The repo script starts Lemonade Server on port `8080`:

```bash
npm run ai:serve
```

You can also run directly:

```bash
lemonade-server serve --port 8080
```

Then pull/run your model (examples):

```bash
lemonade-server list
lemonade-server pull SmolLM3-3B-GGUF
lemonade-server run SmolLM3-3B-GGUF --port 8080
```

### 4) Verify it is actually running

Use these checks:

```bash
lsof -i :8080 -sTCP:LISTEN
curl http://localhost:8080/api/v1/models
curl http://localhost:8080/api/version
```

Expected behavior:

- A process is listening on `8080`
- `/api/v1/models` returns a model list
- Dashboard Brick AI replies with `degraded: false` when model calls succeed

### 5) Useful control commands

```bash
npm run ai:status
npm run ai:stop
```

### Important correction about old setup advice

For this project, you do **not** need TensorFlow/Keras/CUDA/Nginx or a separate Flask app just to run Brick AI.
Those steps are unrelated to the Lemonade Server flow used by this repo.

## Local URLs

- API: `http://localhost:2540`
- Health: `http://localhost:2540/health`
- Tablet: `http://localhost:2541`
- Aggregator: `http://localhost:2542`
- Dashboard: `http://localhost:2543`
- Pick Pitch Page: `http://localhost:2544`

## Core API Endpoints

### Strategy

- `GET /api/strategy/stats/:eventKey`
- `GET /api/strategy/stats/:eventKey/:teamNumber`
- `GET /api/strategy/leaderboard/:eventKey?ourTeam=3749&limit=12`
- `GET /api/strategy/predict/:eventKey/:matchKey?team3749Ready=true|false`
- `GET /api/strategy/schedule/:eventKey?team=3749`
- `GET /api/strategy/statbotics/:eventKey`
- `GET /api/strategy/alliance-probabilities/:eventKey?refreshTba=true`
- `POST /api/strategy/alliance-probabilities/:eventKey/live?refreshTba=true`

### Import

- `POST /api/import/paste`
- `POST /api/import/offline-batch`

### Sync

- `POST /api/sync/tba/:eventKey`
- `POST /api/sync/scrape/:eventKey`
- `POST /api/sync/scrape-all`

## Data Flow Summary

1. Scout data is imported from CSV/JSON/offline tablet exports.
2. Aggregated team stats are computed from scouting and external imports.
3. Strategy endpoints enrich teams with Statbotics EPA metrics.
4. Predictor combines local scouting signals + enriched EPA context.
5. Dashboard renders score prediction, weaknesses/strengths, and tactical plan.

## Tactical Plan Output Shape

`predict` response includes `tacticalPlan` with:

- `primaryThreat`
- `secondaryThreat` (optional)
- `autoRecommendation`
- `offensePlan`
- `defensePlan`
- `concisePlan`
- `shiftStrategies`
- `shiftCalls` (AI-enhanced)
- `habitCounters` (AI-enhanced)
- `assignments`
- `mode` (`balanced` or `defense-heavy`)
- `summary`

## UI + Data Behavior Guarantees

- Dynamic match schedule completion now follows strict rules:
  - `completed` only if both alliance scores are present from TBA, OR
  - there is scouting data for that exact match (same event + comp level + match number).
- Schedule endpoint performs a throttled TBA refresh before returning rows, and supports forced refresh:
  - `GET /api/strategy/schedule/:eventKey?team=3749&refreshTba=true`
- Spider charts use only persisted aggregated spider metrics (`spiderAuto`, `spiderTeleop`, `spiderDefense`, `spiderCycleSpeed`, `spiderReliability`, `spiderEndgame`).
  - No synthetic/fallback spider values are generated from recent notes rows.
- Brick AI shows a loading indicator in-chat while waiting for a response:
  - `Brick is typing...`
- Dashboard has a global event-mode toggle button:
  - toggles `San Diego` (`2026casnd`) and `Aerospace Valley` (`2026caav`)
  - automatically remaps match key prefix to selected event
- Dashboard includes a `Probable Alliances` modal:
  - uses top 8 TBA-ranked captains
  - simulates 3 serpentine rounds (1→8, 8→1, 1→8)
  - shows 4-team projected alliances (captain + picks 1/2/3)
  - uses TBA ranking data + collected team aggregated scouting metrics
  - includes a live draft override panel where you enter actual picks by team number
  - recalculates remaining probable picks in real time as alliance selection happens IRL

## Troubleshooting

### Brick AI says `fetch failed` or returns fallback mode

- Lemonade server is not reachable at `LEMONADE_BASE`.
- Confirm listener and endpoints:
  - `lsof -i :8080 -sTCP:LISTEN`
  - `curl http://localhost:8080/api/v1/models`
- Start/restart Lemonade server and model:
  - `npm run ai:serve`
  - `lemonade-server run SmolLM3-3B-GGUF --port 8080`

### Schedule marks matches completed too early

- Completion is no longer inferred from latest scouted qual threshold.
- A match is completed only with explicit score data or scouting records on that exact match.
- Force fresh TBA sync when needed:

```bash
curl "http://localhost:2540/api/strategy/schedule/2026casnd?team=3749&refreshTba=true"
```

### Brick AI returns only very narrow team context

- Ask a broader question without team-number filtering in the prompt.
- The backend now uses all available data with event-priority merging by default.

### Statbotics values appear as 0

- Ensure backend can reach `api.statbotics.io`.
- Confirm endpoint path uses `team_year` format.
- Verify event teams are valid FRC team numbers.
- Retry after a few seconds (cache warmup and request latency).

### Aggregator looks empty after load/import click

- The loading bar should show active progress.
- Existing rows remain displayed while requests are in flight.
- Check backend status at `/health` if requests stall.

### Prediction says match not found

- Import full schedule for the event first.
- Use `qm#`, `#`, or full key format (`2026xxxx_qm#`).

### TBA sync fails with `TBA_API_KEY missing` or 401

- Set `TBA_API_KEY` in `.env`.
- Get your key from The Blue Alliance account page:
  - https://www.thebluealliance.com/account
- This project sends the key as `X-TBA-Auth-Key` header via `packages/tba/src/sync.js`.
- Quick test:

```bash
curl -H "X-TBA-Auth-Key: $TBA_API_KEY" \
  https://www.thebluealliance.com/api/v3/status
```

If you get JSON status back, your key works.

## Notes

- No local schema migration is required for Statbotics enrichment because data is fetched and merged at API response time.
- If Lemonade is unavailable, prediction still runs with deterministic logic and fallback narrative.
