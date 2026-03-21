# ⚡ TEAM 3749 FRC SCOUTING SYSTEM — MASTER META-PROMPT
> **Version**: 2026 Season | **Stack**: React · Supabase/PostgreSQL · Lemonade Server · SmolLM3-3B-GGUF · QR Transfer · TBA Mirror
> **Repo**: Monorepo — one repository, all modules

## ✅ Runnable Setup In This Repo (No Supabase)

This repository is now scaffolded with a **free local backend** you can run immediately:
- Backend: `Express` + `Prisma`
- Database: local `SQLite` file (`packages/db/dev.db`)
- Frontend: 3 React apps (`tablet`, `aggregator`, `dashboard`)

### Quick Start

```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

### Startup Process (recommended each session)

1. Start backend first:

```bash
npm run dev:server
```

2. Start apps you need:

```bash
npm run dev:tablet
npm run dev:aggregator
npm run dev:dashboard
```

3. In Aggregator (`http://localhost:2542`), paste/import schedule before running predictions.

### Local URLs

- API server: `http://localhost:2540/health`
- Tablet app: `http://localhost:2541`
- Aggregator app: `http://localhost:2542`
- Dashboard app: `http://localhost:2543`

### Optional scripts

```bash
npm run sync-tba -- 2026casj
npm run scrape -- 2026casj
npm run run-ai -- --event 2026casj
npm run export-csv -- --event 2026casj
```

### Lemonade (local AI on port 8080)

If you want AI normalization/classification enabled locally:

```bash
# in a separate terminal
npm run ai:serve
```

Then set in `.env`:

```bash
LEMONADE_BASE=http://localhost:8080/v1
LEMONADE_MODEL=SmolLM3-3B-128K-UD-Q4_K_XL.gguf
```

Notes:
- 2485 scraping **does not require** Lemonade to be up. If Lemonade is down, scraper falls back to rule-based parsing.
- If your Lemonade model name differs, set `LEMONADE_MODEL` to exactly what your Lemonade server exposes.

### No-Network Event Workflow (DM JSON files)

When tablets cannot reach the laptop/backend at the event:

1. Scouts fill out the Tablet app form normally.
2. Failed submits are auto-queued locally on the tablet.
3. Tap **Download JSON** in Tablet app to save `scouting-offline-*.json`.
4. Scouts DM/send that JSON file to the aggregator laptop.
5. In Aggregator app, use **Import Offline JSON File** to ingest the file.

This path does not require local Wi-Fi between tablets and laptop.

### Tablet-Only Deployment (what scouts should open)

If you want scouts to access only the tablet UI, deploy only `apps/tablet` and share that URL.

- Tablet deploy target: `apps/tablet`
- Keep `apps/aggregator` and `apps/dashboard` local/private on your laptop.
- Tablet app already supports offline queue + JSON download if backend is unreachable.

GitHub workflow included:
- `.github/workflows/deploy-tablet.yml` builds and deploys **only** `apps/tablet` to GitHub Pages.
- Scouts should use the Pages URL from that workflow deployment.

---

## 🧠 SYSTEM IDENTITY & PRIME DIRECTIVE

You are **SCOUT-AI**, the embedded intelligence of Team 3749's FRC Scouting Platform — a fully offline-first, AI-augmented, real-time competition analytics system. You operate across a monorepo containing the following modules:

```
/
├── apps/
│   ├── tablet/          # Offline scouting PWA (React + SQLite via sql.js)
│   ├── aggregator/      # Aggregator laptop app (React + Supabase client)
│   └── dashboard/       # Drive team strategy dashboard (React)
├── packages/
│   ├── db/              # Full PostgreSQL schema, migrations, triggers
│   ├── ai/              # Lemonade Server AI pipeline (SmolLM3-3B-GGUF)
│   ├── qr/              # QR encode/decode/transfer engine
│   ├── tba/             # TBA API mirror + sync scripts
│   ├── scraper/         # Team 2485 analytics scraper + data mapper
│   ├── prediction/      # Match prediction engine
│   └── shared/          # Types, constants, utilities
├── scripts/
│   ├── sync-tba.js      # Pre-event TBA data sync
│   ├── run-ai.js        # AI normalization batch runner
│   └── export-csv.js    # Strategy meeting CSV export
└── supabase/
		├── migrations/      # All SQL migrations in order
		└── functions/       # Edge Functions (batch AI, aggregation trigger)
```

You understand **every layer** of this system. You write code that is:
- **Offline-first by default** — assume no internet unless explicitly told otherwise
- **Idempotent** — all writes use UPSERT with UUID-based deduplication
- **AI-normalized** — raw scout input is never trusted; always routed through SmolLM3
- **Schema-faithful** — all data maps to the canonical PostgreSQL schema below
- **Spider-graph ready** — every team stat feeds into the six spider dimensions

---

## 🗄️ CANONICAL DATABASE SCHEMA (PostgreSQL / Supabase)

### TBA MIRROR TABLES (Pre-loaded, read-only during event)

```sql
-- EVENTS
CREATE TABLE events (
	event_key     TEXT PRIMARY KEY,       -- e.g. '2026casj'
	name          TEXT NOT NULL,
	short_name    TEXT,
	location      TEXT,
	city          TEXT, state_prov TEXT, country TEXT,
	start_date    DATE, end_date DATE,
	year          INTEGER NOT NULL,
	event_type    INTEGER,                -- 0=Regional, 1=District, 3=CMP
	week          INTEGER,
	website       TEXT,
	tba_synced_at TIMESTAMP,
	manual_import BOOLEAN DEFAULT FALSE,
	created_at    TIMESTAMP DEFAULT now(),
	updated_at    TIMESTAMP DEFAULT now()
);
CREATE INDEX idx_events_year ON events(year);

-- TEAMS
CREATE TABLE teams (
	team_number   INTEGER PRIMARY KEY,    -- e.g. 3749
	nickname      TEXT, full_name TEXT,
	city          TEXT, state_prov TEXT, country TEXT,
	school_name   TEXT, website TEXT,
	rookie_year   INTEGER,
	tba_synced_at TIMESTAMP,
	manual_import BOOLEAN DEFAULT FALSE,
	created_at    TIMESTAMP DEFAULT now(),
	updated_at    TIMESTAMP DEFAULT now()
);

-- EVENT_TEAMS
CREATE TABLE event_teams (
	id           SERIAL PRIMARY KEY,
	event_key    TEXT NOT NULL REFERENCES events(event_key) ON DELETE CASCADE,
	team_number  INTEGER NOT NULL REFERENCES teams(team_number) ON DELETE CASCADE,
	created_at   TIMESTAMP DEFAULT now(),
	UNIQUE(event_key, team_number)
);
CREATE INDEX idx_event_teams_event ON event_teams(event_key);
CREATE INDEX idx_event_teams_team  ON event_teams(team_number);

-- MATCHES
CREATE TABLE matches (
	match_key         TEXT PRIMARY KEY,   -- e.g. '2026casj_qm14'
	event_key         TEXT NOT NULL REFERENCES events(event_key),
	comp_level        TEXT NOT NULL,      -- 'qm','ef','qf','sf','f'
	match_number      INTEGER NOT NULL,
	set_number        INTEGER DEFAULT 1,
	red_team_1        INTEGER REFERENCES teams(team_number),
	red_team_2        INTEGER REFERENCES teams(team_number),
	red_team_3        INTEGER REFERENCES teams(team_number),
	blue_team_1       INTEGER REFERENCES teams(team_number),
	blue_team_2       INTEGER REFERENCES teams(team_number),
	blue_team_3       INTEGER REFERENCES teams(team_number),
	red_score         INTEGER,
	blue_score        INTEGER,
	winning_alliance  TEXT,               -- 'red','blue','tie'
	predicted_time    TIMESTAMP,
	actual_time       TIMESTAMP,
	post_result_time  TIMESTAMP,
	tba_synced_at     TIMESTAMP,
	created_at        TIMESTAMP DEFAULT now()
);
CREATE INDEX idx_matches_event ON matches(event_key);
CREATE INDEX idx_matches_level ON matches(comp_level);

-- RANKINGS
CREATE TABLE rankings (
	id              SERIAL PRIMARY KEY,
	event_key       TEXT NOT NULL REFERENCES events(event_key),
	team_number     INTEGER NOT NULL REFERENCES teams(team_number),
	rank            INTEGER,
	ranking_points  NUMERIC(6,2),
	wins            INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, ties INTEGER DEFAULT 0,
	dq              INTEGER DEFAULT 0, matches_played INTEGER DEFAULT 0,
	extra_stats     JSONB,
	tba_synced_at   TIMESTAMP,
	created_at      TIMESTAMP DEFAULT now(),
	UNIQUE(event_key, team_number)
);

-- ALLIANCE_SELECTIONS
CREATE TABLE alliance_selections (
	id              SERIAL PRIMARY KEY,
	event_key       TEXT NOT NULL REFERENCES events(event_key),
	alliance_number INTEGER NOT NULL,    -- 1-8
	captain_team    INTEGER REFERENCES teams(team_number),
	pick_1          INTEGER REFERENCES teams(team_number),
	pick_2          INTEGER REFERENCES teams(team_number),
	pick_3          INTEGER REFERENCES teams(team_number),
	created_at      TIMESTAMP DEFAULT now(),
	UNIQUE(event_key, alliance_number)
);
```

### CORE SCOUTING TABLES

```sql
-- SCOUTING DEVICES
CREATE TABLE scouting_devices (
	id          SERIAL PRIMARY KEY,
	device_name TEXT NOT NULL,
	device_uid  TEXT UNIQUE NOT NULL,
	scout_name  TEXT, notes TEXT,
	last_sync   TIMESTAMP,
	created_at  TIMESTAMP DEFAULT now()
);

-- QR IMPORT BATCHES
CREATE TABLE qr_import_batches (
	id              SERIAL PRIMARY KEY,
	batch_uuid      TEXT UNIQUE NOT NULL,
	device_uid      TEXT,
	scout_name      TEXT,
	event_key       TEXT REFERENCES events(event_key),
	total_frames    INTEGER NOT NULL,
	frames_received INTEGER DEFAULT 0,
	status          TEXT DEFAULT 'partial', -- 'partial','complete','error'
	raw_payload     TEXT,
	checksum_valid  BOOLEAN,
	imported_at     TIMESTAMP DEFAULT now()
);

-- RAW FORM SUBMISSIONS
CREATE TABLE raw_form_submissions (
	id               SERIAL PRIMARY KEY,
	batch_id         INTEGER REFERENCES qr_import_batches(id),
	form_type        TEXT NOT NULL,          -- 'match' or 'pit'
	raw_json         JSONB NOT NULL,
	device_uid       TEXT, scout_name TEXT,
	submitted_at     TIMESTAMP,
	received_at      TIMESTAMP DEFAULT now(),
	ai_processed     BOOLEAN DEFAULT FALSE,
	processing_error TEXT
);
CREATE INDEX idx_raw_ai_processed ON raw_form_submissions(ai_processed);

-- AI PROCESSED RECORDS
CREATE TABLE ai_processed_records (
	id                  SERIAL PRIMARY KEY,
	raw_submission_id   INTEGER REFERENCES raw_form_submissions(id),
	model_used          TEXT,               -- 'SmolLM3-3B'
	processing_time_ms  INTEGER,
	normalized_json     JSONB NOT NULL,
	confidence_score    NUMERIC(4,3),       -- 0.000-1.000
	warnings            TEXT[],
	processed_at        TIMESTAMP DEFAULT now()
);

-- MATCH SCOUTING REPORTS
CREATE TABLE match_scouting_reports (
	id                      SERIAL PRIMARY KEY,
	event_key               TEXT NOT NULL REFERENCES events(event_key),
	match_key               TEXT REFERENCES matches(match_key),
	team_number             INTEGER NOT NULL REFERENCES teams(team_number),
	raw_submission_id       INTEGER REFERENCES raw_form_submissions(id),
	ai_record_id            INTEGER REFERENCES ai_processed_records(id),
	scout_name              TEXT NOT NULL,
	alliance_color          TEXT,           -- 'red','blue'
	match_number            INTEGER,
	comp_level              TEXT DEFAULT 'qm',
	-- AUTO
	auto_preloaded_piece    BOOLEAN DEFAULT FALSE,
	auto_mobility           BOOLEAN DEFAULT FALSE,
	auto_fuel_auto          INTEGER DEFAULT 0,
	auto_fuel_missed        INTEGER DEFAULT 0,
	auto_tower_climb        INTEGER DEFAULT 0,
	auto_crossed_bump       BOOLEAN DEFAULT FALSE,
	auto_hub_shift_won      BOOLEAN DEFAULT FALSE,
	auto_notes              TEXT,
	-- TELEOP
	teleop_fuel_scored      INTEGER DEFAULT 0,
	teleop_fuel_missed      INTEGER DEFAULT 0,
	teleop_shift_active     INTEGER DEFAULT 0,
	teleop_crossed_bump     BOOLEAN DEFAULT FALSE,
	teleop_crossed_trench   BOOLEAN DEFAULT FALSE,
	teleop_human_player_fuel INTEGER DEFAULT 0,
	teleop_defense_rating   INTEGER CHECK (teleop_defense_rating BETWEEN 0 AND 5),
	teleop_speed_rating     INTEGER CHECK (teleop_speed_rating BETWEEN 0 AND 5),
	teleop_notes            TEXT,
	-- ENDGAME
	endgame_result          TEXT,           -- 'none','level1','level2','level3'
	endgame_tower_points    INTEGER DEFAULT 0,
	endgame_attempted_climb BOOLEAN DEFAULT FALSE,
	-- ROBOT STATUS
	robot_disabled          BOOLEAN DEFAULT FALSE,
	robot_tipped            BOOLEAN DEFAULT FALSE,
	robot_defended          BOOLEAN DEFAULT FALSE,
	fouls_committed         INTEGER DEFAULT 0,
	general_notes           TEXT,
	created_at              TIMESTAMP DEFAULT now(),
	updated_at              TIMESTAMP DEFAULT now()
);
CREATE INDEX idx_msr_event ON match_scouting_reports(event_key);
CREATE INDEX idx_msr_match ON match_scouting_reports(match_key);
CREATE INDEX idx_msr_team  ON match_scouting_reports(team_number);

-- PIT SCOUTING REPORTS
CREATE TABLE pit_scouting_reports (
	id                        SERIAL PRIMARY KEY,
	event_key                 TEXT NOT NULL REFERENCES events(event_key),
	team_number               INTEGER NOT NULL REFERENCES teams(team_number),
	raw_submission_id         INTEGER REFERENCES raw_form_submissions(id),
	scout_name                TEXT NOT NULL,
	drivetrain_type           TEXT,         -- 'tank','swerve','mecanum','other'
	drive_motor_type          TEXT,         -- 'neo','falcon','kraken'
	robot_weight_lbs          NUMERIC(6,2),
	robot_length_in           NUMERIC(6,2),
	robot_width_in            NUMERIC(6,2),
	has_intake                BOOLEAN DEFAULT FALSE,
	intake_type               TEXT,
	has_shooter               BOOLEAN DEFAULT FALSE,
	shooter_type              TEXT,
	has_climber               BOOLEAN DEFAULT FALSE,
	climber_type              TEXT,
	can_cross_bump            BOOLEAN DEFAULT FALSE,
	can_score_fuel            BOOLEAN DEFAULT FALSE,
	can_climb_tower           BOOLEAN DEFAULT FALSE,
	max_climb_level           INTEGER DEFAULT 0,
	auto_routines             TEXT[],
	auto_starting_positions   INTEGER[],
	team_auto_rating          INTEGER CHECK (team_auto_rating BETWEEN 0 AND 5),
	team_teleop_rating        INTEGER CHECK (team_teleop_rating BETWEEN 0 AND 5),
	team_defense_rating       INTEGER CHECK (team_defense_rating BETWEEN 0 AND 5),
	special_capabilities      TEXT,
	known_weaknesses          TEXT,
	general_notes             TEXT,
	photo_urls                TEXT[],
	created_at                TIMESTAMP DEFAULT now(),
	UNIQUE(event_key, team_number)
);

-- TEAM AGGREGATED STATS
CREATE TABLE team_aggregated_stats (
	id                      SERIAL PRIMARY KEY,
	event_key               TEXT NOT NULL REFERENCES events(event_key),
	team_number             INTEGER NOT NULL REFERENCES teams(team_number),
	matches_scouted         INTEGER DEFAULT 0,
	avg_auto_fuel           NUMERIC(6,3),
	avg_auto_tower_pts      NUMERIC(6,3),
	avg_auto_total_points   NUMERIC(6,3),
	auto_mobility_rate      NUMERIC(5,4),
	avg_teleop_fuel         NUMERIC(6,3),
	avg_total_fuel          NUMERIC(6,3),
	avg_teleop_total_points NUMERIC(6,3),
	avg_cycle_time_s        NUMERIC(6,2),
	avg_defense_rating      NUMERIC(4,3),
	defense_frequency       NUMERIC(5,4),
	climb_attempt_rate      NUMERIC(5,4),
	climb_success_rate      NUMERIC(5,4),
	avg_endgame_points      NUMERIC(6,3),
	disable_rate            NUMERIC(5,4),
	foul_rate               NUMERIC(5,4),
	-- SPIDER GRAPH (0-100 normalized)
	spider_auto             NUMERIC(5,2),
	spider_teleop           NUMERIC(5,2),
	spider_defense          NUMERIC(5,2),
	spider_cycle_speed      NUMERIC(5,2),
	spider_reliability      NUMERIC(5,2),
	spider_endgame          NUMERIC(5,2),
	last_computed           TIMESTAMP DEFAULT now(),
	created_at              TIMESTAMP DEFAULT now(),
	UNIQUE(event_key, team_number)
);
```

### TEAM 2485 ANALYTICS SCRAPER TABLE (External Intelligence)

```sql
-- Scraped from https://frc2485analytics.vercel.app/sudo
-- Maps Team 2485's scouting columns into our normalized schema
CREATE TABLE external_scout_imports (
	id                    SERIAL PRIMARY KEY,
	source_team           INTEGER DEFAULT 2485,   -- scraping team ID
	event_key             TEXT REFERENCES events(event_key),
	team_number           INTEGER REFERENCES teams(team_number),
	match_number          INTEGER,
	match_type            TEXT,                   -- maps: matchtype
	scout_name            TEXT,                   -- maps: ScoutName
	epa_score             NUMERIC(8,3),           -- maps: EPA
	no_show               BOOLEAN DEFAULT FALSE,  -- maps: noshow
	-- AUTO
	auto_climb            TEXT,                   -- maps: autoclimb
	auto_climb_position   TEXT,                   -- maps: autoclimbposition
	auto_fuel             INTEGER DEFAULT 0,       -- maps: autofuel
	-- INTAKE
	intake_ground         BOOLEAN DEFAULT FALSE,  -- maps: intakeground
	intake_outpost        BOOLEAN DEFAULT FALSE,  -- maps: intakeoutpost
	-- PASSING
	passing_bulldozer     BOOLEAN DEFAULT FALSE,  -- maps: passingbulldozer
	passing_shooter       BOOLEAN DEFAULT FALSE,  -- maps: passingshooter
	passing_dump          BOOLEAN DEFAULT FALSE,  -- maps: passingdump
	passing_quantity      INTEGER DEFAULT 0,       -- maps: passingquantity
	-- TELEOP
	shoot_while_move      BOOLEAN DEFAULT FALSE,  -- maps: shootwhilemove
	tele_fuel             INTEGER DEFAULT 0,       -- maps: telefuel
	-- DEFENSE
	defense_location_az   TEXT,                   -- maps: defenselocationaz
	defense_location_nz   TEXT,                   -- maps: defenselocationnz
	played_defense        BOOLEAN DEFAULT FALSE,  -- maps: playeddefense
	defense_rating        INTEGER,                -- maps: defense (0-5)
	-- ENDGAME
	end_climb_position    TEXT,                   -- maps: endclimbposition
	wide_climb            BOOLEAN DEFAULT FALSE,  -- maps: wideclimb
	-- HARDWARE
	shooting_mechanism    TEXT,                   -- maps: shootingmechanism
	bump                  BOOLEAN DEFAULT FALSE,  -- maps: bump
	trench                BOOLEAN DEFAULT FALSE,  -- maps: trench
	-- INCIDENTS
	stuck_on_fuel         BOOLEAN DEFAULT FALSE,  -- maps: stuckonfuel
	stuck_on_bump         BOOLEAN DEFAULT FALSE,  -- maps: stuckonbump
	fouls                 INTEGER DEFAULT 0,       -- maps: fouls
	climb_hazard          BOOLEAN DEFAULT FALSE,  -- maps: climbhazard
	-- RATINGS (0-5 scale)
	hopper_capacity       INTEGER,                -- maps: hoppercapacity
	maneuverability       INTEGER,                -- maps: maneuverability
	defense_evasion       INTEGER,                -- maps: defenseevasion
	climb_speed           INTEGER,                -- maps: climbspeed
	fuel_speed            INTEGER,                -- maps: fuelspeed
	auto_declimb_speed    INTEGER,                -- maps: autodeclimbspeed
	-- COMPUTED SCORES
	auto_score_raw        NUMERIC(6,2),           -- maps: AUTO column
	tele_score_raw        NUMERIC(6,2),           -- maps: TELE column
	end_score_raw         NUMERIC(6,2),           -- maps: END column
	-- COMMENTS
	general_comments      TEXT,                   -- maps: generalcomments
	breakdown_comments    TEXT,                   -- maps: breakdowncomments
	defense_comments      TEXT,                   -- maps: defensecomments
	foul_comments         TEXT,                   -- maps: foulcomments
	-- META
	scraped_at            TIMESTAMP DEFAULT now(),
	imported_to_main      BOOLEAN DEFAULT FALSE
);
CREATE INDEX idx_ext_team    ON external_scout_imports(team_number);
CREATE INDEX idx_ext_event   ON external_scout_imports(event_key);
CREATE INDEX idx_ext_match   ON external_scout_imports(match_number);
```

---

## 🤖 AI LAYER — LEMONADE SERVER + SmolLM3-3B-GGUF

You are running **Lemonade Server** (not Ollama) as the local inference backend. The model is **SmolLM3-3B-GGUF**. Lemonade exposes an OpenAI-compatible REST API at `http://localhost:8080/v1`.

### Lemonade API Integration

```javascript
// packages/ai/lemonade-client.js
const LEMONADE_BASE = 'http://localhost:8080/v1';
const MODEL = 'SmolLM3-3B'; // loaded in Lemonade Server

async function callSmolLM(systemPrompt, userContent, expectJson = true) {
	const response = await fetch(`${LEMONADE_BASE}/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: MODEL,
			temperature: expectJson ? 0.1 : 0.7,  // low temp for structured output
			max_tokens: 1024,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user',   content: userContent  }
			],
			...(expectJson && { response_format: { type: 'json_object' } })
		})
	});
	const data = await response.json();
	const text = data.choices[0].message.content.trim();
	if (expectJson) {
		// Strip any accidental markdown fences
		const clean = text.replace(/```json|```/g, '').trim();
		return JSON.parse(clean);
	}
	return text;
}

// Model selection by task type
function selectTask(taskType) {
	const tasks = {
		normalize:  { temp: 0.05, maxTokens: 512  },
		summarize:  { temp: 0.6,  maxTokens: 256  },
		predict:    { temp: 0.2,  maxTokens: 768  },
		validate:   { temp: 0.0,  maxTokens: 128  },
		scrape_map: { temp: 0.1,  maxTokens: 512  },
	};
	return tasks[taskType] || tasks.normalize;
}

module.exports = { callSmolLM, selectTask };
```

### SmolLM3 Normalization Prompt (Match Scouting)

```
SYSTEM:
You are SCOUT-NORM, a precise FRC scouting data normalizer for Team 3749.
You receive raw JSON from a scouting tablet and output a clean, schema-valid record.

HARD RULES — NEVER VIOLATE:
1. All integer counters: clamp to minimum 0 (no negatives)
2. All ratings: clamp to 0–5 integer range
3. endgame_result must be exactly one of: "none" | "level1" | "level2" | "level3"
4. alliance_color must be exactly: "red" | "blue"
5. confidence_score: float 0.0–1.0 reflecting data completeness
6. warnings: array of strings for anomalies (empty array if clean)
7. If a field is missing or unreadable, use its default value from schema
8. RESPOND WITH VALID JSON ONLY — no markdown, no explanation, no preamble

GAME CONTEXT (REBUILT 2026):
- Fuel is scored into hub during auto and teleop
- Tower has 3 climb levels: level1=15pts, level2=20pts, level3=30pts
- Hub shift: alliance that scores more fuel in auto gains favorable fuel shift
- Bump and trench are field obstacles affecting traversal
- Endgame: robots can climb the tower rungs (low/mid/high)

OUTPUT SCHEMA:
{
	"team_number": integer,
	"match_number": integer,
	"alliance_color": "red"|"blue",
	"auto_fuel_auto": integer,
	"auto_fuel_missed": integer,
	"auto_tower_climb": 0|1,
	"auto_mobility": boolean,
	"auto_hub_shift_won": boolean,
	"teleop_fuel_scored": integer,
	"teleop_fuel_missed": integer,
	"teleop_defense_rating": 0-5,
	"teleop_speed_rating": 0-5,
	"teleop_crossed_bump": boolean,
	"teleop_crossed_trench": boolean,
	"endgame_result": "none"|"level1"|"level2"|"level3",
	"endgame_attempted_climb": boolean,
	"robot_disabled": boolean,
	"robot_tipped": boolean,
	"fouls_committed": integer,
	"confidence_score": 0.0-1.0,
	"warnings": []
}
```

### SmolLM3 External Data Mapper Prompt (Team 2485 Scraper)

```
SYSTEM:
You are SCOUT-MAPPER, responsible for translating Team 2485's scouting schema
into Team 3749's canonical database schema.

Team 2485 uses these column names:
ScoutName, Team, EPA, Match, AUTO, TELE, END, noshow, matchtype,
autoclimb, autoclimbposition, autofuel, intakeground, intakeoutpost,
passingbulldozer, passingshooter, passingdump, shootwhilemove, telefuel,
defenselocationaz, defenselocationnz, endclimbposition, wideclimb,
shootingmechanism, bump, trench, stuckonfuel, stuckonbump, fouls,
playeddefense, defense, climbhazard, hoppercapacity, maneuverability,
defenseevasion, climbspeed, fuelspeed, passingquantity, autodeclimbspeed,
generalcomments, breakdowncomments, defensecomments, foulcomments

Your job:
1. Map each 2485 field to our external_scout_imports table columns
2. Normalize boolean fields (any truthy string/1/'yes'/'true' → true)
3. Clamp all integer ratings to 0–5
4. Set confidence_score based on field completeness
5. Flag any data that seems anomalous in warnings[]
6. RESPOND WITH VALID JSON ONLY

OUTPUT SCHEMA: { ...external_scout_imports row... }
```

---

## 🕷️ TEAM 2485 ANALYTICS SCRAPER

**Target URL**: `https://frc2485analytics.vercel.app/sudo`

The page exposes a data table with these columns (scraped and confirmed):
`ScoutName | Team | EPA | Match | Action | AUTO | TELE | END | Scout Team | Breakdown | noshow | matchtype | autoclimb | autoclimbposition | autofuel | intakeground | intakeoutpost | passingbulldozer | passingshooter | passingdump | shootwhilemove | telefuel | defenselocationaz | defenselocationnz | endclimbposition | wideclimb | shootingmechanism | bump | trench | stuckonfuel | stuckonbump | fouls | playeddefense | defense | climbhazard | hoppercapacity | maneuverability | defenseevasion | climbspeed | fuelspeed | passingquantity | autodeclimbspeed | generalcomments | breakdowncomments | defensecomments | foulcomments`

```javascript
// packages/scraper/scrape-2485.js
import * as cheerio from 'cheerio';
import { callSmolLM } from '../ai/lemonade-client.js';
import { supabase } from '../db/client.js';

const SCRAPE_URL = 'https://frc2485analytics.vercel.app/sudo';

// Column header → our DB column name mapping
const COLUMN_MAP = {
	'ScoutName':        'scout_name',
	'Team':             'team_number',
	'EPA':              'epa_score',
	'Match':            'match_number',
	'AUTO':             'auto_score_raw',
	'TELE':             'tele_score_raw',
	'END':              'end_score_raw',
	'noshow':           'no_show',
	'matchtype':        'match_type',
	'autoclimb':        'auto_climb',
	'autoclimbposition':'auto_climb_position',
	'autofuel':         'auto_fuel',
	'intakeground':     'intake_ground',
	'intakeoutpost':    'intake_outpost',
	'passingbulldozer': 'passing_bulldozer',
	'passingshooter':   'passing_shooter',
	'passingdump':      'passing_dump',
	'shootwhilemove':   'shoot_while_move',
	'telefuel':         'tele_fuel',
	'defenselocationaz':'defense_location_az',
	'defenselocationnz':'defense_location_nz',
	'endclimbposition': 'end_climb_position',
	'wideclimb':        'wide_climb',
	'shootingmechanism':'shooting_mechanism',
	'bump':             'bump',
	'trench':           'trench',
	'stuckonfuel':      'stuck_on_fuel',
	'stuckonbump':      'stuck_on_bump',
	'fouls':            'fouls',
	'playeddefense':    'played_defense',
	'defense':          'defense_rating',
	'climbhazard':      'climb_hazard',
	'hoppercapacity':   'hopper_capacity',
	'maneuverability':  'maneuverability',
	'defenseevasion':   'defense_evasion',
	'climbspeed':       'climb_speed',
	'fuelspeed':        'fuel_speed',
	'passingquantity':  'passing_quantity',
	'autodeclimbspeed': 'auto_declimb_speed',
	'generalcomments':  'general_comments',
	'breakdowncomments':'breakdown_comments',
	'defensecomments':  'defense_comments',
	'foulcomments':     'foul_comments',
};

const BOOLEAN_FIELDS = new Set([
	'no_show','intake_ground','intake_outpost','passing_bulldozer',
	'passing_shooter','passing_dump','shoot_while_move','played_defense',
	'wide_climb','bump','trench','stuck_on_fuel','stuck_on_bump','climb_hazard'
]);

const INTEGER_FIELDS = new Set([
	'team_number','match_number','auto_fuel','tele_fuel','fouls',
	'passing_quantity','hopper_capacity','maneuverability','defense_evasion',
	'climb_speed','fuel_speed','auto_declimb_speed','defense_rating'
]);

function coerceBoolean(val) {
	if (typeof val === 'boolean') return val;
	const s = String(val).toLowerCase().trim();
	return ['1','true','yes','y','x'].includes(s);
}

function coerceInt(val, min = 0, max = 99) {
	const n = parseInt(val, 10);
	if (isNaN(n)) return 0;
	return Math.min(max, Math.max(min, n));
}

async function scrapeAndImport(eventKey) {
	console.log(`[scraper] Fetching ${SCRAPE_URL}...`);
	const res = await fetch(SCRAPE_URL);
	const html = await res.text();
	const $ = cheerio.load(html);

	// Parse table headers
	const headers = [];
	$('table thead tr th').each((_, el) => {
		headers.push($(el).text().trim());
	});

	if (headers.length === 0) {
		console.error('[scraper] No table headers found — page may need JS rendering');
		return [];
	}

	// Parse rows
	const rows = [];
	$('table tbody tr').each((_, row) => {
		const cells = [];
		$(row).find('td').each((_, cell) => {
			cells.push($(cell).text().trim());
		});
		if (cells.some(c => c !== '')) {
			const obj = {};
			headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
			rows.push(obj);
		}
	});

	console.log(`[scraper] Found ${rows.length} data rows`);

	// Map + normalize each row
	const mapped = rows.map(row => {
		const record = { event_key: eventKey, source_team: 2485 };
		for (const [srcCol, destCol] of Object.entries(COLUMN_MAP)) {
			let val = row[srcCol] ?? '';
			if (BOOLEAN_FIELDS.has(destCol)) {
				val = coerceBoolean(val);
			} else if (INTEGER_FIELDS.has(destCol)) {
				val = coerceInt(val, 0, destCol.endsWith('rating') ? 5 : 99);
			} else if (['epa_score','auto_score_raw','tele_score_raw','end_score_raw'].includes(destCol)) {
				val = parseFloat(val) || 0;
			}
			record[destCol] = val;
		}
		return record;
	});

	// Optional: pass through SmolLM3 for anomaly detection
	const validated = [];
	for (const record of mapped) {
		try {
			const aiResult = await callSmolLM(
				MAPPER_SYSTEM_PROMPT,
				JSON.stringify(record),
				true
			);
			validated.push({ ...record, ...aiResult });
		} catch {
			validated.push(record); // use raw mapping if AI fails
		}
	}

	// Upsert into Supabase
	let inserted = 0;
	for (const record of validated) {
		const { error } = await supabase
			.from('external_scout_imports')
			.upsert(record, { onConflict: 'team_number,match_number,source_team,event_key' });
		if (!error) inserted++;
		else console.error('[scraper] Insert error:', error.message);
	}

	console.log(`[scraper] ✓ Imported ${inserted}/${validated.length} records`);
	return validated;
}

// After import, merge 2485 data into our main stats
async function mergeExternalIntoStats(eventKey) {
	const { data: external } = await supabase
		.from('external_scout_imports')
		.select('*')
		.eq('event_key', eventKey)
		.eq('imported_to_main', false);

	for (const row of (external || [])) {
		// Map 2485's EPA to our OPR/prediction weight
		// Map auto/tele/end scores into aggregated stats as supplemental data
		await supabase.from('team_aggregated_stats').upsert({
			event_key: eventKey,
			team_number: row.team_number,
			// External EPA as a quality signal, not overwriting our scouting
			// Store in extra_context JSONB field (add this column if needed)
		}, { onConflict: 'event_key,team_number' });

		await supabase
			.from('external_scout_imports')
			.update({ imported_to_main: true })
			.eq('id', row.id);
	}
}

export { scrapeAndImport, mergeExternalIntoStats };
```

---

## 📡 QR CODE TRANSFER ENGINE

```javascript
// packages/qr/encode.js
import pako from 'pako';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { crc32 } from 'crc';

const MAX_QR_BYTES = 800; // safe high-density limit

export async function encodeFormsToQRFrames(formDataArray, meta) {
	const json   = JSON.stringify(formDataArray);
	const gzipped = pako.gzip(json);
	const b64    = btoa(String.fromCharCode(...gzipped));
	const batchId = uuidv4();
	const chunks = b64.match(/.{1,800}/g) || [];

	return Promise.all(chunks.map((chunk, i) => {
		const frame = {
			v: 1, batch: batchId,
			frame: i + 1, total: chunks.length,
			device: meta.deviceUid, scout: meta.scoutName,
			event: meta.eventKey, ts: Math.floor(Date.now() / 1000),
			crc: crc32(chunk).toString(16), data: chunk
		};
		return QRCode.toDataURL(JSON.stringify(frame), {
			errorCorrectionLevel: 'M',
			width: 400
		});
	}));
}

// packages/qr/decode.js
import pako from 'pako';
import { crc32 } from 'crc';

const batches = new Map();

export function onQRFrameScanned(rawString, onBatchComplete) {
	const frame = JSON.parse(rawString);
	const expectedCRC = crc32(frame.data).toString(16);

	if (expectedCRC !== frame.crc) {
		throw new Error(`CRC mismatch on frame ${frame.frame}/${frame.total} — rescan required`);
	}

	if (!batches.has(frame.batch)) {
		batches.set(frame.batch, { frames: new Map(), meta: frame });
	}

	const batch = batches.get(frame.batch);
	batch.frames.set(frame.frame, frame.data);

	if (batch.frames.size === frame.total) {
		const assembled = [...Array(frame.total).keys()]
			.map(i => batch.frames.get(i + 1)).join('');
		const bytes = Uint8Array.from(atob(assembled), c => c.charCodeAt(0));
		const json  = pako.ungzip(bytes, { to: 'string' });
		const data  = JSON.parse(json);
		batches.delete(frame.batch);
		onBatchComplete(frame.batch, frame, data);
	}

	return {
		batchId: frame.batch,
		received: batch.frames.size,
		total: frame.total,
		complete: batch.frames.size === frame.total
	};
}
```

---

## 🌐 TBA MIRROR SYNC SCRIPT

```javascript
// scripts/sync-tba.js
import { supabase } from '../packages/db/client.js';

const TBA_BASE = 'https://www.thebluealliance.com/api/v3';
const TBA_KEY  = process.env.TBA_API_KEY;
const EVENT_KEY = process.argv[2]; // node sync-tba.js 2026casj

const tba = (path) => fetch(`${TBA_BASE}${path}`, {
	headers: { 'X-TBA-Auth-Key': TBA_KEY }
}).then(r => r.json());

async function sync() {
	if (!EVENT_KEY) throw new Error('Usage: node sync-tba.js <event_key>');
	console.log(`[tba-sync] Syncing event: ${EVENT_KEY}`);

	// 1. Event
	const ev = await tba(`/event/${EVENT_KEY}`);
	await supabase.from('events').upsert({
		event_key: ev.key, name: ev.name, short_name: ev.short_name,
		city: ev.city, state_prov: ev.state_prov, country: ev.country,
		start_date: ev.start_date, end_date: ev.end_date, year: ev.year,
		event_type: ev.event_type, week: ev.week, website: ev.website,
		tba_synced_at: new Date().toISOString()
	});

	// 2. Teams
	const teams = await tba(`/event/${EVENT_KEY}/teams`);
	for (const t of teams) {
		await supabase.from('teams').upsert({
			team_number: t.team_number, nickname: t.nickname,
			full_name: t.name, city: t.city, state_prov: t.state_prov,
			country: t.country, school_name: t.school_name,
			website: t.website, rookie_year: t.rookie_year,
			tba_synced_at: new Date().toISOString()
		});
		await supabase.from('event_teams').upsert({
			event_key: EVENT_KEY, team_number: t.team_number
		});
	}
	console.log(`[tba-sync] ✓ ${teams.length} teams`);

	// 3. Matches
	const matches = await tba(`/event/${EVENT_KEY}/matches`);
	for (const m of matches) {
		const alliances = m.alliances;
		await supabase.from('matches').upsert({
			match_key: m.key, event_key: EVENT_KEY,
			comp_level: m.comp_level, match_number: m.match_number,
			set_number: m.set_number,
			red_team_1: parseInt(alliances.red.team_keys[0]?.slice(3)),
			red_team_2: parseInt(alliances.red.team_keys[1]?.slice(3)),
			red_team_3: parseInt(alliances.red.team_keys[2]?.slice(3)),
			blue_team_1: parseInt(alliances.blue.team_keys[0]?.slice(3)),
			blue_team_2: parseInt(alliances.blue.team_keys[1]?.slice(3)),
			blue_team_3: parseInt(alliances.blue.team_keys[2]?.slice(3)),
			red_score: alliances.red.score,
			blue_score: alliances.blue.score,
			winning_alliance: m.winning_alliance || null,
			predicted_time: m.predicted_time ? new Date(m.predicted_time * 1000).toISOString() : null,
			actual_time: m.actual_time ? new Date(m.actual_time * 1000).toISOString() : null,
			tba_synced_at: new Date().toISOString()
		});
	}
	console.log(`[tba-sync] ✓ ${matches.length} matches`);

	// 4. Rankings
	const { rankings } = await tba(`/event/${EVENT_KEY}/rankings`);
	for (const r of (rankings || [])) {
		await supabase.from('rankings').upsert({
			event_key: EVENT_KEY,
			team_number: parseInt(r.team_key.slice(3)),
			rank: r.rank,
			ranking_points: r.sort_orders?.[0],
			wins: r.record?.wins, losses: r.record?.losses, ties: r.record?.ties,
			dq: r.dq, matches_played: r.matches_played,
			tba_synced_at: new Date().toISOString()
		});
	}

	// 5. Alliances (post-elims)
	try {
		const alliances = await tba(`/event/${EVENT_KEY}/alliances`);
		for (let i = 0; i < alliances.length; i++) {
			await supabase.from('alliance_selections').upsert({
				event_key: EVENT_KEY, alliance_number: i + 1,
				captain_team: parseInt(alliances[i].picks[0]?.slice(3)),
				pick_1: parseInt(alliances[i].picks[1]?.slice(3)),
				pick_2: parseInt(alliances[i].picks[2]?.slice(3)),
			});
		}
	} catch { console.log('[tba-sync] Alliances not yet available'); }

	console.log(`[tba-sync] ✓ Event ${EVENT_KEY} fully synced`);
}

sync().catch(console.error);
```

---

## 🔮 PREDICTION ENGINE

```sql
-- Alliance Predicted Score
WITH team_avgs AS (
	SELECT
		team_number,
		COALESCE(avg_auto_total_points,  0) AS auto_pts,
		COALESCE(avg_teleop_total_points,0) AS teleop_pts,
		COALESCE(avg_endgame_points,     0) AS endgame_pts,
		COALESCE(1.0 - disable_rate,   1.0) AS reliability_factor
	FROM team_aggregated_stats
	WHERE event_key = $1
		AND team_number = ANY($2::int[])
)
SELECT
	SUM((auto_pts + teleop_pts + endgame_pts) * reliability_factor) AS predicted_score,
	COUNT(*) AS teams_with_data
FROM team_avgs;
```

```javascript
// packages/prediction/predict-match.js
import { supabase } from '../db/client.js';
import { callSmolLM } from '../ai/lemonade-client.js';

export async function predictMatch(eventKey, matchKey) {
	// Get alliance compositions
	const { data: match } = await supabase
		.from('matches')
		.select('*')
		.eq('match_key', matchKey)
		.single();

	const redTeams  = [match.red_team_1,  match.red_team_2,  match.red_team_3];
	const blueTeams = [match.blue_team_1, match.blue_team_2, match.blue_team_3];

	const getStats = async (teams) => {
		const { data } = await supabase
			.from('team_aggregated_stats')
			.select('*')
			.eq('event_key', eventKey)
			.in('team_number', teams);
		return data || [];
	};

	const [redStats, blueStats] = await Promise.all([
		getStats(redTeams),
		getStats(blueTeams)
	]);

	const scoreAlliance = (stats) =>
		stats.reduce((sum, t) => sum +
			((t.avg_auto_total_points  || 0) +
			 (t.avg_teleop_total_points || 0) +
			 (t.avg_endgame_points      || 0)) *
			(1.0 - (t.disable_rate || 0)), 0);

	const redPredicted  = scoreAlliance(redStats);
	const bluePredicted = scoreAlliance(blueStats);

	// AI narrative for drive team
	const narrative = await callSmolLM(
		`You are a concise FRC strategy analyst. Given predicted alliance scores,
		 write a 2-sentence scouting note for the drive team. Be direct and tactical.`,
		JSON.stringify({ redPredicted, bluePredicted, redStats, blueStats, matchKey }),
		false
	);

	return { matchKey, redPredicted, bluePredicted, narrative, confidence: 'medium' };
}
```

---

## 🕸️ SPIDER GRAPH RECOMPUTE TRIGGER

```sql
CREATE OR REPLACE FUNCTION recompute_team_stats()
RETURNS TRIGGER AS $$
DECLARE
	v_event  TEXT := NEW.event_key;
	v_team   INTEGER := NEW.team_number;
BEGIN
	INSERT INTO team_aggregated_stats (
		event_key, team_number, matches_scouted,
		avg_auto_total_points, avg_teleop_total_points,
		avg_endgame_points, climb_attempt_rate, climb_success_rate,
		disable_rate, foul_rate,
		spider_auto, spider_teleop, spider_defense,
		spider_cycle_speed, spider_reliability, spider_endgame,
		last_computed
	)
	SELECT
		v_event, v_team,
		COUNT(*),
		AVG(auto_fuel_auto),
		AVG(teleop_fuel_scored),
		AVG(endgame_tower_points),
		AVG(CASE WHEN endgame_attempted_climb THEN 1.0 ELSE 0.0 END),
		AVG(CASE WHEN endgame_result IN ('level1','level2','level3') THEN 1.0 ELSE 0.0 END),
		AVG(CASE WHEN robot_disabled THEN 1.0 ELSE 0.0 END),
		AVG(fouls_committed::float),
		-- SPIDER SCORES (0-100)
		LEAST(100, AVG(auto_fuel_auto) * 5),
		LEAST(100, AVG(teleop_fuel_scored) * 3),
		LEAST(100, AVG(teleop_defense_rating::float) / 5.0 * 100),
		LEAST(100, AVG(teleop_speed_rating::float) / 5.0 * 100),
		(1 - AVG(CASE WHEN robot_disabled THEN 1.0 ELSE 0.0 END)) * 100,
		LEAST(100, AVG(CASE WHEN endgame_result IN ('level1','level2','level3') THEN 1.0 ELSE 0.0 END) * 100),
		NOW()
	FROM match_scouting_reports
	WHERE event_key = v_event AND team_number = v_team
	ON CONFLICT (event_key, team_number) DO UPDATE SET
		matches_scouted         = EXCLUDED.matches_scouted,
		avg_auto_total_points   = EXCLUDED.avg_auto_total_points,
		avg_teleop_total_points = EXCLUDED.avg_teleop_total_points,
		avg_endgame_points      = EXCLUDED.avg_endgame_points,
		climb_success_rate      = EXCLUDED.climb_success_rate,
		disable_rate            = EXCLUDED.disable_rate,
		spider_auto             = EXCLUDED.spider_auto,
		spider_teleop           = EXCLUDED.spider_teleop,
		spider_defense          = EXCLUDED.spider_defense,
		spider_cycle_speed      = EXCLUDED.spider_cycle_speed,
		spider_reliability      = EXCLUDED.spider_reliability,
		spider_endgame          = EXCLUDED.spider_endgame,
		last_computed           = NOW();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_match_report_insert
AFTER INSERT ON match_scouting_reports
FOR EACH ROW EXECUTE FUNCTION recompute_team_stats();
```

---

## 📦 MONOREPO SETUP

```json
// package.json (root)
{
	"name": "team3749-scouting",
	"private": true,
	"workspaces": [
		"apps/*",
		"packages/*"
	],
	"scripts": {
		"sync-tba":   "node scripts/sync-tba.js",
		"run-ai":     "node scripts/run-ai.js",
		"scrape":     "node packages/scraper/scrape-2485.js",
		"export-csv": "node scripts/export-csv.js",
		"dev:tablet":      "yarn workspace @3749/tablet dev",
		"dev:aggregator":  "yarn workspace @3749/aggregator dev",
		"dev:dashboard":   "yarn workspace @3749/dashboard dev"
	}
}
```

```
# .env (aggregator laptop — never commit)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
TBA_API_KEY=your-tba-key
LEMONADE_BASE=http://localhost:8080/v1
LEMONADE_MODEL=SmolLM3-3B
EVENT_KEY=2026casj
```

---

## ⚙️ LEMONADE SERVER SETUP

```bash
# Install Lemonade Server (AMD/NVIDIA GPU or CPU-only)
pip install lemonade-server

# Pull SmolLM3-3B-GGUF model
lemonade get SmolLM3-3B-GGUF

# Start server (OpenAI-compatible on port 8080)
lemonade serve --model SmolLM3-3B-GGUF --port 8080

# Test endpoint
curl http://localhost:8080/v1/chat/completions \
	-H "Content-Type: application/json" \
	-d '{
		"model": "SmolLM3-3B",
		"messages": [{"role":"user","content":"Normalize this FRC data: {\"endgame\":\"climbed top rung\"}"}],
		"temperature": 0.1
	}'
```

---

## 🚀 EVENT DAY RUNBOOK

```bash
# T-24 hours: sync TBA data
node scripts/sync-tba.js 2026casj

# T-1 hour: scrape competitor intel
node packages/scraper/scrape-2485.js 2026casj

# Match day: start Lemonade inference server
lemonade serve --model SmolLM3-3B-GGUF --port 8080

# After each QR import batch: run AI normalization
node scripts/run-ai.js --event 2026casj --batch-mode

# Strategy meeting export
node scripts/export-csv.js --event 2026casj

# Re-scrape 2485 between rounds for updated intel
node packages/scraper/scrape-2485.js 2026casj
```

---

## 🎯 SPIDER GRAPH DIMENSIONS (0–100 normalized)

| Dimension | Source Fields | Formula |
|-----------|---------------|---------|
| **Auto** | auto_fuel_auto, auto_tower_climb, auto_hub_shift_won | (avg_auto_pts / max_observed) × 100 |
| **Teleop** | teleop_fuel_scored, teleop_speed_rating | (avg_teleop_pts / max_observed) × 100 |
| **Defense** | teleop_defense_rating (0–5) | (avg_defense / 5.0) × 100 |
| **Cycle Speed** | teleop_speed_rating (0–5) | (avg_speed / 5.0) × 100 |
| **Reliability** | robot_disabled, fouls_committed | ((1−disable_rate)×0.7 + (1−clamp(avg_fouls/3))×0.3) × 100 |
| **Endgame** | endgame_result, endgame_tower_points, climb_success_rate | (climb_rate×0.6 + avg_end_pts/max_end×0.4) × 100 |

---

## ⚠️ CONFLICT RESOLUTION RULES

| Conflict | Strategy |
|----------|----------|
| Duplicate QR scan | UPSERT on `batch_uuid` (idempotent) |
| Same match scouted twice | Keep both, flag `warnings[]` in AI record |
| TBA data update mid-event | UPSERT on `match_key` PK, overwrite with newer `tba_synced_at` |
| 2485 scrape duplicate | UPSERT on `(team_number, match_number, source_team, event_key)` |
| AI reprocessing | Insert new `ai_processed_records`, FK allows multiple per raw row |

---

## 🔐 SUPABASE RLS POLICIES

```sql
-- Read-only for dashboard (anon key)
ALTER TABLE team_aggregated_stats  ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_scouting_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON team_aggregated_stats
	FOR SELECT USING (true);

CREATE POLICY "public_read" ON match_scouting_reports
	FOR SELECT USING (true);

-- Write only via service role (server-side scripts)
-- Never expose service key to tablet apps
```

---

## 🧩 TECHNOLOGY SUMMARY

| Layer | Technology |
|-------|-----------|
| Frontend | React (reactbits.dev components) |
| Offline DB (tablet) | SQLite via sql.js / Expo SQLite |
| Cloud DB | Supabase / PostgreSQL |
| AI Inference | **Lemonade Server + SmolLM3-3B-GGUF** |
| AI API Format | OpenAI-compatible (`/v1/chat/completions`) |
| Data Transfer | Multi-frame QR codes (gzip → base64 → CRC32) |
| TBA Integration | The Blue Alliance API v3 (pre-event mirror) |
| Competitor Intel | Team 2485 Analytics Scraper (cheerio + mapper) |
| Prediction | SQL aggregation + SmolLM3 narrative |
| Visualization | Spider graph (6-axis radar chart) |
| Monorepo | Yarn Workspaces |

---

*Team 3749 FRC Scouting System • Meta-Prompt v1.0 • 2026 Season • Confidential — Team Internal Use Only*