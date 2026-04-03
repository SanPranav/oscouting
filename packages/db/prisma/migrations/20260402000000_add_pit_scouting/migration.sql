-- CreateTable
CREATE TABLE "pit_scouting_reports" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event_key" TEXT NOT NULL,
    "team_number" INTEGER NOT NULL,
    "scout_name" TEXT NOT NULL,
    "drivetrain_type" TEXT,
    "can_use_trench" BOOLEAN NOT NULL DEFAULT false,
    "can_cross_bump" BOOLEAN NOT NULL DEFAULT false,
    "cycle_balls_per_sec" REAL,
    "intake_type" TEXT,
    "shooter_type" TEXT,
    "climber_type" TEXT,
    "has_ground_intake" BOOLEAN NOT NULL DEFAULT false,
    "has_source_intake" BOOLEAN NOT NULL DEFAULT false,
    "drive_motor_type" TEXT,
    "shooter_motor_type" TEXT,
    "intake_motor_type" TEXT,
    "climber_motor_type" TEXT,
    "mechanism_notes" TEXT,
    "ai_tags" TEXT,
    "ai_confidence_score" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "pit_scouting_reports_event_key_fkey" FOREIGN KEY ("event_key") REFERENCES "events" ("event_key") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pit_scouting_reports_team_number_fkey" FOREIGN KEY ("team_number") REFERENCES "teams" ("team_number") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "pit_scouting_reports_event_key_idx" ON "pit_scouting_reports"("event_key");

-- CreateIndex
CREATE INDEX "pit_scouting_reports_team_number_idx" ON "pit_scouting_reports"("team_number");
