import { Router } from 'express';
import { prisma } from '@3749/db/src/client.js';
import { normalizeMatchSubmission } from '@3749/ai/src/normalize.js';
import { recomputeTeamStats } from '../stats.js';

const router = Router();

const UNKNOWN_VALUE = /^(idk|unknown|n\/?a|na|null|undefined|none)?$/i;

function normalizeGeneralNotes(input) {
  const text = String(input || '');
  if (!text) return null;

  const normalized = text
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf('=');
      if (idx < 0) return part;

      const key = part.slice(0, idx).trim();
      const rawValue = part.slice(idx + 1).trim();
      const value = UNKNOWN_VALUE.test(rawValue) ? 'N/A' : rawValue;
      return `${key}=${value}`;
    })
    .join(' | ');

  return normalized || null;
}

router.post('/match', async (req, res) => {
  try {
    const raw = req.body || {};
    const normalized = await normalizeMatchSubmission(raw);

    const report = await prisma.matchScoutingReport.create({
      data: {
        eventKey: raw.eventKey,
        teamNumber: normalized.team_number,
        scoutName: raw.scoutName || 'unknown',
        allianceColor: normalized.alliance_color,
        matchNumber: normalized.match_number,
        compLevel: raw.compLevel || 'qm',
        autoFuelAuto: normalized.auto_fuel_auto,
        autoFuelMissed: normalized.auto_fuel_missed,
        autoTowerClimb: normalized.auto_tower_climb,
        autoMobility: normalized.auto_mobility,
        autoHubShiftWon: normalized.auto_hub_shift_won,
        teleopFuelScored: normalized.teleop_fuel_scored,
        teleopFuelMissed: normalized.teleop_fuel_missed,
        teleopDefenseRating: normalized.teleop_defense_rating,
        teleopSpeedRating: normalized.teleop_speed_rating,
        teleopCrossedBump: normalized.teleop_crossed_bump,
        teleopCrossedTrench: normalized.teleop_crossed_trench,
        endgameResult: normalized.endgame_result,
        endgameAttemptedClimb: normalized.endgame_attempted_climb,
        endgameTowerPoints:
          normalized.endgame_result === 'level3' ? 30 :
          normalized.endgame_result === 'level2' ? 20 :
          normalized.endgame_result === 'level1' ? 15 : 0,
        robotDisabled: normalized.robot_disabled,
        robotTipped: normalized.robot_tipped,
        foulsCommitted: normalized.fouls_committed,
        generalNotes: normalizeGeneralNotes(raw.general_notes)
      }
    });

    const stats = await recomputeTeamStats(raw.eventKey, normalized.team_number);

    return res.status(201).json({
      report,
      stats,
      ai: {
        confidence_score: normalized.confidence_score,
        warnings: normalized.warnings
      }
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get('/match/:eventKey/:teamNumber', async (req, res) => {
  const { eventKey, teamNumber } = req.params;
  const data = await prisma.matchScoutingReport.findMany({
    where: { eventKey, teamNumber: Number(teamNumber) },
    orderBy: { createdAt: 'desc' }
  });
  res.json(data);
});

export default router;
