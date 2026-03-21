import 'dotenv/config';
import { prisma } from '@3749/db/src/client.js';
import { normalizeMatchSubmission } from '@3749/ai/src/normalize.js';
import { recomputeTeamStats } from '../apps/server/src/stats.js';

const args = process.argv.slice(2);
const eventFlagIndex = args.indexOf('--event');
const eventKey = eventFlagIndex >= 0 ? args[eventFlagIndex + 1] : process.env.EVENT_KEY;

if (!eventKey) {
  console.error('Usage: node scripts/run-ai.js --event <event_key>');
  process.exit(1);
}

const reports = await prisma.matchScoutingReport.findMany({ where: { eventKey } });
let updated = 0;

for (const report of reports) {
  const normalized = await normalizeMatchSubmission({
    team_number: report.teamNumber,
    match_number: report.matchNumber,
    alliance_color: report.allianceColor,
    auto_fuel_auto: report.autoFuelAuto,
    auto_fuel_missed: report.autoFuelMissed,
    auto_tower_climb: report.autoTowerClimb,
    auto_mobility: report.autoMobility,
    auto_hub_shift_won: report.autoHubShiftWon,
    teleop_fuel_scored: report.teleopFuelScored,
    teleop_fuel_missed: report.teleopFuelMissed,
    teleop_defense_rating: report.teleopDefenseRating,
    teleop_speed_rating: report.teleopSpeedRating,
    teleop_crossed_bump: report.teleopCrossedBump,
    teleop_crossed_trench: report.teleopCrossedTrench,
    endgame_result: report.endgameResult,
    endgame_attempted_climb: report.endgameAttemptedClimb,
    robot_disabled: report.robotDisabled,
    robot_tipped: report.robotTipped,
    fouls_committed: report.foulsCommitted
  });

  await prisma.matchScoutingReport.update({
    where: { id: report.id },
    data: {
      teleopDefenseRating: normalized.teleop_defense_rating,
      teleopSpeedRating: normalized.teleop_speed_rating,
      foulsCommitted: normalized.fouls_committed
    }
  });

  await recomputeTeamStats(eventKey, report.teamNumber);
  updated += 1;
}

console.log(`[run-ai] reprocessed ${updated} reports for ${eventKey}`);
