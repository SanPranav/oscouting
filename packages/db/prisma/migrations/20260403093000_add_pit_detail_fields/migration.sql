-- AlterTable
ALTER TABLE "pit_scouting_reports" ADD COLUMN "hopper_capacity" INTEGER;
ALTER TABLE "pit_scouting_reports" ADD COLUMN "swerve_module_type" TEXT;
ALTER TABLE "pit_scouting_reports" ADD COLUMN "swerve_gearing" TEXT;
ALTER TABLE "pit_scouting_reports" ADD COLUMN "cycle_speed" TEXT;
ALTER TABLE "pit_scouting_reports" ADD COLUMN "outpost_capability" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pit_scouting_reports" ADD COLUMN "depot_capability" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pit_scouting_reports" ADD COLUMN "vision_type" TEXT;
ALTER TABLE "pit_scouting_reports" ADD COLUMN "auto_paths" TEXT;
ALTER TABLE "pit_scouting_reports" ADD COLUMN "climb_capability" TEXT;
ALTER TABLE "pit_scouting_reports" ADD COLUMN "software_features" TEXT;
ALTER TABLE "pit_scouting_reports" ADD COLUMN "mechanical_features" TEXT;
