-- CreateTable
CREATE TABLE "events" (
    "event_key" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "city" TEXT,
    "state_prov" TEXT,
    "country" TEXT,
    "start_date" DATETIME,
    "end_date" DATETIME,
    "year" INTEGER NOT NULL,
    "event_type" INTEGER,
    "week" INTEGER,
    "website" TEXT,
    "tba_synced_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "teams" (
    "team_number" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nickname" TEXT,
    "full_name" TEXT,
    "city" TEXT,
    "state_prov" TEXT,
    "country" TEXT,
    "rookie_year" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "matches" (
    "match_key" TEXT NOT NULL PRIMARY KEY,
    "event_key" TEXT NOT NULL,
    "comp_level" TEXT NOT NULL,
    "match_number" INTEGER NOT NULL,
    "set_number" INTEGER NOT NULL DEFAULT 1,
    "red_team_1" INTEGER,
    "red_team_2" INTEGER,
    "red_team_3" INTEGER,
    "blue_team_1" INTEGER,
    "blue_team_2" INTEGER,
    "blue_team_3" INTEGER,
    "red_score" INTEGER,
    "blue_score" INTEGER,
    "winning_alliance" TEXT,
    "predicted_time" DATETIME,
    "actual_time" DATETIME,
    "tba_synced_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "matches_event_key_fkey" FOREIGN KEY ("event_key") REFERENCES "events" ("event_key") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rankings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event_key" TEXT NOT NULL,
    "team_number" INTEGER NOT NULL,
    "rank" INTEGER,
    "ranking_points" REAL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    "dq" INTEGER NOT NULL DEFAULT 0,
    "matches_played" INTEGER NOT NULL DEFAULT 0,
    "tba_synced_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rankings_event_key_fkey" FOREIGN KEY ("event_key") REFERENCES "events" ("event_key") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "rankings_team_number_fkey" FOREIGN KEY ("team_number") REFERENCES "teams" ("team_number") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "match_scouting_reports" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event_key" TEXT NOT NULL,
    "match_key" TEXT,
    "team_number" INTEGER NOT NULL,
    "scout_name" TEXT NOT NULL,
    "alliance_color" TEXT,
    "match_number" INTEGER,
    "comp_level" TEXT NOT NULL DEFAULT 'qm',
    "auto_fuel_auto" INTEGER NOT NULL DEFAULT 0,
    "auto_fuel_missed" INTEGER NOT NULL DEFAULT 0,
    "auto_tower_climb" INTEGER NOT NULL DEFAULT 0,
    "auto_mobility" BOOLEAN NOT NULL DEFAULT false,
    "auto_hub_shift_won" BOOLEAN NOT NULL DEFAULT false,
    "teleop_fuel_scored" INTEGER NOT NULL DEFAULT 0,
    "teleop_fuel_missed" INTEGER NOT NULL DEFAULT 0,
    "teleop_defense_rating" INTEGER,
    "teleop_speed_rating" INTEGER,
    "teleop_crossed_bump" BOOLEAN NOT NULL DEFAULT false,
    "teleop_crossed_trench" BOOLEAN NOT NULL DEFAULT false,
    "endgame_result" TEXT,
    "endgame_tower_points" INTEGER NOT NULL DEFAULT 0,
    "endgame_attempted_climb" BOOLEAN NOT NULL DEFAULT false,
    "robot_disabled" BOOLEAN NOT NULL DEFAULT false,
    "robot_tipped" BOOLEAN NOT NULL DEFAULT false,
    "fouls_committed" INTEGER NOT NULL DEFAULT 0,
    "general_notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "match_scouting_reports_event_key_fkey" FOREIGN KEY ("event_key") REFERENCES "events" ("event_key") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "match_scouting_reports_team_number_fkey" FOREIGN KEY ("team_number") REFERENCES "teams" ("team_number") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "team_aggregated_stats" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event_key" TEXT NOT NULL,
    "team_number" INTEGER NOT NULL,
    "matches_scouted" INTEGER NOT NULL DEFAULT 0,
    "avg_auto_total_points" REAL,
    "avg_teleop_total_points" REAL,
    "avg_endgame_points" REAL,
    "climb_attempt_rate" REAL,
    "climb_success_rate" REAL,
    "disable_rate" REAL,
    "foul_rate" REAL,
    "spider_auto" REAL,
    "spider_teleop" REAL,
    "spider_defense" REAL,
    "spider_cycle_speed" REAL,
    "spider_reliability" REAL,
    "spider_endgame" REAL,
    "last_computed" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "team_aggregated_stats_event_key_fkey" FOREIGN KEY ("event_key") REFERENCES "events" ("event_key") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "team_aggregated_stats_team_number_fkey" FOREIGN KEY ("team_number") REFERENCES "teams" ("team_number") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "external_scout_imports" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source_team" INTEGER NOT NULL DEFAULT 2485,
    "event_key" TEXT NOT NULL,
    "team_number" INTEGER,
    "match_number" INTEGER,
    "match_type" TEXT,
    "scout_name" TEXT,
    "epa_score" REAL,
    "no_show" BOOLEAN NOT NULL DEFAULT false,
    "auto_fuel" INTEGER NOT NULL DEFAULT 0,
    "tele_fuel" INTEGER NOT NULL DEFAULT 0,
    "defense_rating" INTEGER,
    "fouls" INTEGER NOT NULL DEFAULT 0,
    "general_comments" TEXT,
    "scraped_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_to_main" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "external_scout_imports_event_key_fkey" FOREIGN KEY ("event_key") REFERENCES "events" ("event_key") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "external_scout_imports_team_number_fkey" FOREIGN KEY ("team_number") REFERENCES "teams" ("team_number") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "matches_event_key_idx" ON "matches"("event_key");

-- CreateIndex
CREATE UNIQUE INDEX "rankings_event_key_team_number_key" ON "rankings"("event_key", "team_number");

-- CreateIndex
CREATE INDEX "match_scouting_reports_event_key_idx" ON "match_scouting_reports"("event_key");

-- CreateIndex
CREATE INDEX "match_scouting_reports_team_number_idx" ON "match_scouting_reports"("team_number");

-- CreateIndex
CREATE INDEX "team_aggregated_stats_event_key_idx" ON "team_aggregated_stats"("event_key");

-- CreateIndex
CREATE INDEX "team_aggregated_stats_team_number_idx" ON "team_aggregated_stats"("team_number");

-- CreateIndex
CREATE UNIQUE INDEX "team_aggregated_stats_event_key_team_number_key" ON "team_aggregated_stats"("event_key", "team_number");

-- CreateIndex
CREATE INDEX "external_scout_imports_team_number_idx" ON "external_scout_imports"("team_number");

-- CreateIndex
CREATE INDEX "external_scout_imports_event_key_idx" ON "external_scout_imports"("event_key");

-- CreateIndex
CREATE UNIQUE INDEX "external_scout_imports_team_number_match_number_source_team_event_key_key" ON "external_scout_imports"("team_number", "match_number", "source_team", "event_key");
