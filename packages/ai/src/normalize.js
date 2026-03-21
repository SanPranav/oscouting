import { clamp, VALID_ALLIANCE, VALID_ENDGAME, toBool } from '@3749/shared/src/index.js';
import { callSmolLM } from './lemonade-client.js';

const SYSTEM_PROMPT = `You are SCOUT-NORM, a precise FRC scouting data normalizer for Team 3749.
Return JSON only.`;

function normalizeLocally(raw) {
  const alliance = VALID_ALLIANCE.has(raw.alliance_color) ? raw.alliance_color : 'red';
  const endgame = VALID_ENDGAME.has(raw.endgame_result) ? raw.endgame_result : 'none';

  return {
    team_number: clamp(Number(raw.team_number || 0), 0, 99999),
    match_number: clamp(Number(raw.match_number || 0), 0, 999),
    alliance_color: alliance,
    auto_fuel_auto: clamp(Number(raw.auto_fuel_auto || 0), 0, 99),
    auto_fuel_missed: clamp(Number(raw.auto_fuel_missed || 0), 0, 99),
    auto_tower_climb: clamp(Number(raw.auto_tower_climb || 0), 0, 1),
    auto_mobility: toBool(raw.auto_mobility),
    auto_hub_shift_won: toBool(raw.auto_hub_shift_won),
    teleop_fuel_scored: clamp(Number(raw.teleop_fuel_scored || 0), 0, 200),
    teleop_fuel_missed: clamp(Number(raw.teleop_fuel_missed || 0), 0, 200),
    teleop_defense_rating: clamp(Number(raw.teleop_defense_rating || 0), 0, 5),
    teleop_speed_rating: clamp(Number(raw.teleop_speed_rating || 0), 0, 5),
    teleop_crossed_bump: toBool(raw.teleop_crossed_bump),
    teleop_crossed_trench: toBool(raw.teleop_crossed_trench),
    endgame_result: endgame,
    endgame_attempted_climb: toBool(raw.endgame_attempted_climb),
    robot_disabled: toBool(raw.robot_disabled),
    robot_tipped: toBool(raw.robot_tipped),
    fouls_committed: clamp(Number(raw.fouls_committed || 0), 0, 20),
    confidence_score: 0.75,
    warnings: []
  };
}

export async function normalizeMatchSubmission(raw) {
  try {
    const ai = await callSmolLM(SYSTEM_PROMPT, JSON.stringify(raw), true);
    const merged = { ...normalizeLocally(raw), ...ai };

    merged.teleop_defense_rating = clamp(Number(merged.teleop_defense_rating || 0), 0, 5);
    merged.teleop_speed_rating = clamp(Number(merged.teleop_speed_rating || 0), 0, 5);
    merged.auto_fuel_auto = clamp(Number(merged.auto_fuel_auto || 0), 0, 99);
    merged.auto_fuel_missed = clamp(Number(merged.auto_fuel_missed || 0), 0, 99);
    merged.teleop_fuel_scored = clamp(Number(merged.teleop_fuel_scored || 0), 0, 200);
    merged.teleop_fuel_missed = clamp(Number(merged.teleop_fuel_missed || 0), 0, 200);
    merged.fouls_committed = clamp(Number(merged.fouls_committed || 0), 0, 20);
    merged.confidence_score = clamp(Number(merged.confidence_score || 0.7), 0, 1);
    if (!Array.isArray(merged.warnings)) merged.warnings = [];

    if (!VALID_ALLIANCE.has(merged.alliance_color)) merged.alliance_color = 'red';
    if (!VALID_ENDGAME.has(merged.endgame_result)) merged.endgame_result = 'none';

    return merged;
  } catch {
    return normalizeLocally(raw);
  }
}
