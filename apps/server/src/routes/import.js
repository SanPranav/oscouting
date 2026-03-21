import { Router } from 'express';
import { parse } from 'csv-parse/sync';
import { prisma } from '@3749/db/src/client.js';
import { normalizeMatchSubmission } from '@3749/ai/src/normalize.js';
import { callSmolLM } from '@3749/ai/src/lemonade-client.js';
import { recomputeTeamStats } from '../stats.js';

const router = Router();

const toBool = (value) => {
  const normalized = String(value ?? '').toLowerCase().trim();
  return ['yes', 'y', 'true', '1', 'x'].includes(normalized);
};

const toRating = (value) => {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(5, n));
};

const parseClimb = (value) => {
  const normalized = String(value ?? '').toLowerCase().trim();
  if (['l3', 'level3', '3'].includes(normalized)) return 'level3';
  if (['l2', 'level2', '2'].includes(normalized)) return 'level2';
  if (['l1', 'level1', '1'].includes(normalized)) return 'level1';
  return 'none';
};

const get = (row, aliases) => {
  for (const key of aliases) {
    if (row[key] !== undefined) return row[key];
  }
  return '';
};

const parsePenaltyCount = (value) => {
  const found = String(value ?? '').match(/\d+/)?.[0];
  return found ? Number(found) : 0;
};

async function ensureEvent(eventKey) {
  await prisma.event.upsert({
    where: { eventKey },
    update: {},
    create: { eventKey, name: eventKey, year: 2026 }
  });
}

async function ensureTeam(teamNumber) {
  if (!teamNumber) return;
  await prisma.team.upsert({
    where: { teamNumber },
    update: {},
    create: { teamNumber, nickname: `Team ${teamNumber}` }
  });
}

async function detectPasteType(headerLine, bodySample) {
  const lowered = `${headerLine}\n${bodySample}`.toLowerCase();
  if (lowered.includes('red1,red2,red3,blue1,blue2,blue3')) return 'schedule';
  if (lowered.includes('color,team') && lowered.includes('match_key')) return 'flat_schedule';
  if (lowered.includes('team_number') && lowered.includes('opr')) return 'oprs';
  if (lowered.includes('team number you are scouting') || lowered.includes('your name')) return 'scouting_csv';

  try {
    const ai = await callSmolLM(
      'Classify CSV-like scouting text. Return JSON: {"type":"schedule|flat_schedule|oprs|scouting_csv|unknown"}.',
      JSON.stringify({ headerLine, bodySample }),
      true
    );
    return ai.type || 'unknown';
  } catch {
    return 'unknown';
  }
}

function mapScoutingRowToRaw(row, eventKey) {
  const matchNumber = Number.parseInt(get(row, ['Match Num', 'Match', 'match_number']).toString(), 10) || 0;
  const teamNumber = Number.parseInt(get(row, ['Team Number You Are Scouting', 'Team', 'team_number']).toString(), 10) || 0;
  const crossing = String(get(row, ['Did they cross center line for auto?', 'Auto Mobility'])).toLowerCase().trim();
  const cycleCount = Number.parseInt(get(row, ['How many cycles', 'Cycles', 'cycle_count']).toString(), 10) || 0;
  const penaltiesRaw = get(row, ['Things they did wrong (penalties)', 'Penalties', 'fouls']);

  const notes = [
    `start_pos=${get(row, ['Starting Position 1 left 3 right', 'Starting Position'])}`,
    `auto_path=${get(row, ['Describe The Auto Path', 'Auto Path'])}`,
    `cycle_accuracy=${toRating(get(row, ['Cycle accuracy']))}`,
    `cycle_notes=${get(row, ['Addtional Cycle Notes', 'Additional Cycle Notes'])}`,
    `driving_behavior_notes=${get(row, ['Elaborate  (Jerky, smooth etc.)', 'Elaborate'])}`,
    `driving_team=${toRating(get(row, ['Driving TEAM Behavior', 'Driving Team Behavior']))}`,
    `driving_team_elaborate=${get(row, ['Driving TEAM Behavior Elaborate', 'Elaborate.1'])}`,
    `intake=${get(row, ['Ground Intake or Outpost Intake'])}`,
    `using_depot=${get(row, ['Are they using depot'])}`,
    `using_bump=${get(row, ['Using Bump?'])}`,
    `using_trench=${get(row, ['Using Trench?'])}`,
    `passing=${get(row, ['Are they Passing?'])}`,
    `penalties=${penaltiesRaw}`,
    `notes=${get(row, ['Additional Notes?', 'Notes'])}`
  ].filter(Boolean).join(' | ');

  return {
    eventKey,
    scoutName: String(get(row, ['Your name:', 'Your name', 'ScoutName']) || 'csv-import'),
    team_number: teamNumber,
    match_number: matchNumber,
    alliance_color: 'red',
    auto_fuel_auto: 0,
    auto_fuel_missed: 0,
    auto_tower_climb: parseClimb(get(row, ['Auto Climb'])) === 'none' ? 0 : 1,
    auto_mobility: crossing !== 'no',
    auto_hub_shift_won: false,
    teleop_fuel_scored: 0,
    teleop_fuel_missed: 0,
    teleop_defense_rating: toRating(get(row, ['Driving TEAM Behavior', 'Driving Team Behavior'])),
    teleop_speed_rating: toRating(get(row, ['Driving Behaviour', 'Driving Behavior'])),
    teleop_crossed_bump: toBool(get(row, ['Using Bump?'])),
    teleop_crossed_trench: toBool(get(row, ['Using Trench?'])),
    endgame_result: parseClimb(get(row, ['Climb', 'End Climb'])),
    endgame_attempted_climb: parseClimb(get(row, ['Climb', 'End Climb'])) !== 'none',
    robot_disabled: false,
    robot_tipped: false,
    fouls_committed: parsePenaltyCount(penaltiesRaw),
    general_notes: notes
  };
}

async function importScoutingCsv(records, eventKey) {
  await ensureEvent(eventKey);
  const inserted = [];
  const errors = [];

  for (const [index, row] of records.entries()) {
    try {
      const raw = mapScoutingRowToRaw(row, eventKey);
      if (!raw.team_number || !raw.match_number) {
        errors.push({ row: index + 2, error: 'Missing team_number or match_number' });
        continue;
      }

      await ensureTeam(raw.team_number);
      const normalized = await normalizeMatchSubmission(raw);

      const report = await prisma.matchScoutingReport.create({
        data: {
          eventKey,
          teamNumber: normalized.team_number,
          scoutName: raw.scoutName,
          allianceColor: normalized.alliance_color,
          matchNumber: normalized.match_number,
          compLevel: 'qm',
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
          generalNotes: raw.general_notes
        }
      });

      inserted.push({ id: report.id, teamNumber: report.teamNumber, matchNumber: report.matchNumber });
      await recomputeTeamStats(eventKey, report.teamNumber);
    } catch (error) {
      errors.push({ row: index + 2, error: error.message });
    }
  }

  return { imported: inserted.length, inserted, errors, type: 'scouting_csv' };
}

async function importSchedule(records, eventKey) {
  await ensureEvent(eventKey);

  let importedMatches = 0;
  for (const row of records) {
    const matchKey = String(row.match_key || '').trim();
    const compLevel = String(row.comp_level || 'qm').trim();
    const matchNumber = Number.parseInt(row.match_number, 10);
    const setNumber = Number.parseInt(row.set_number || '1', 10) || 1;

    if (!matchKey || !compLevel || !matchNumber) continue;

    const redTeams = [Number(row.red1), Number(row.red2), Number(row.red3)].map((n) => Number.isFinite(n) ? n : null);
    const blueTeams = [Number(row.blue1), Number(row.blue2), Number(row.blue3)].map((n) => Number.isFinite(n) ? n : null);

    for (const team of [...redTeams, ...blueTeams]) {
      if (team) await ensureTeam(team);
    }

    const datePart = String(row.scheduled_date || '').trim();
    const timePart = String(row.scheduled_time || '').trim();
    const scheduledAt = datePart && timePart ? new Date(`${datePart} ${timePart}`) : null;

    await prisma.match.upsert({
      where: { matchKey },
      update: {
        eventKey,
        compLevel,
        matchNumber,
        setNumber,
        redTeam1: redTeams[0],
        redTeam2: redTeams[1],
        redTeam3: redTeams[2],
        blueTeam1: blueTeams[0],
        blueTeam2: blueTeams[1],
        blueTeam3: blueTeams[2],
        redScore: row.red_score ? Number.parseInt(row.red_score, 10) : null,
        blueScore: row.blue_score ? Number.parseInt(row.blue_score, 10) : null,
        predictedTime: scheduledAt && !Number.isNaN(scheduledAt.valueOf()) ? scheduledAt : null
      },
      create: {
        matchKey,
        eventKey,
        compLevel,
        matchNumber,
        setNumber,
        redTeam1: redTeams[0],
        redTeam2: redTeams[1],
        redTeam3: redTeams[2],
        blueTeam1: blueTeams[0],
        blueTeam2: blueTeams[1],
        blueTeam3: blueTeams[2],
        redScore: row.red_score ? Number.parseInt(row.red_score, 10) : null,
        blueScore: row.blue_score ? Number.parseInt(row.blue_score, 10) : null,
        predictedTime: scheduledAt && !Number.isNaN(scheduledAt.valueOf()) ? scheduledAt : null
      }
    });

    importedMatches += 1;
  }

  return { importedMatches, type: 'schedule' };
}

async function importFlatSchedule(records, eventKey) {
  await ensureEvent(eventKey);

  const grouped = new Map();
  for (const row of records) {
    const key = String(row.match_key || '').trim();
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const normalized = [];
  for (const [matchKey, rows] of grouped.entries()) {
    const base = rows[0] || {};
    const red = rows.filter((r) => String(r.color || '').toLowerCase() === 'red').map((r) => Number.parseInt(r.team, 10)).filter(Boolean);
    const blue = rows.filter((r) => String(r.color || '').toLowerCase() === 'blue').map((r) => Number.parseInt(r.team, 10)).filter(Boolean);

    normalized.push({
      match_key: matchKey,
      scheduled_date: base.scheduled_date,
      scheduled_time: base.scheduled_time,
      comp_level: base.comp_level || 'qm',
      match_number: base.match_number,
      set_number: base.set_number || 1,
      red1: red[0] || null,
      red2: red[1] || null,
      red3: red[2] || null,
      blue1: blue[0] || null,
      blue2: blue[1] || null,
      blue3: blue[2] || null
    });
  }

  const result = await importSchedule(normalized, eventKey);
  return { ...result, type: 'flat_schedule' };
}

async function importOprs(records, eventKey) {
  await ensureEvent(eventKey);

  let importedTeams = 0;
  for (const row of records) {
    const teamNumber = Number.parseInt(row.team_number, 10);
    if (!teamNumber) continue;

    await ensureTeam(teamNumber);

    const opr = Number.parseFloat(row.OPR || row.opr || '0') || 0;
    const auto = Number.parseFloat(row.totalAutoPoints || '0') || 0;
    const tele = Number.parseFloat(row.totalTeleopPoints || '0') || 0;
    const end = Number.parseFloat(row.endGameTowerPoints || row.totalTowerPoints || '0') || 0;
    const fouls = Number.parseFloat(row.foulPoints || '0') || 0;

    await prisma.teamAggregatedStat.upsert({
      where: { eventKey_teamNumber: { eventKey, teamNumber } },
      update: {
        avgAutoTotalPoints: auto,
        avgTeleopTotalPoints: tele,
        avgEndgamePoints: end,
        foulRate: Math.max(0, fouls),
        spiderAuto: Math.max(0, Math.min(100, auto * 5)),
        spiderTeleop: Math.max(0, Math.min(100, tele * 3)),
        spiderDefense: Math.max(0, Math.min(100, 50 + (opr / 6))),
        spiderCycleSpeed: Math.max(0, Math.min(100, 50 + (tele / 4))),
        spiderReliability: Math.max(0, Math.min(100, 100 - Math.max(0, fouls))),
        spiderEndgame: Math.max(0, Math.min(100, end * 3)),
        lastComputed: new Date()
      },
      create: {
        eventKey,
        teamNumber,
        matchesScouted: 0,
        avgAutoTotalPoints: auto,
        avgTeleopTotalPoints: tele,
        avgEndgamePoints: end,
        foulRate: Math.max(0, fouls),
        spiderAuto: Math.max(0, Math.min(100, auto * 5)),
        spiderTeleop: Math.max(0, Math.min(100, tele * 3)),
        spiderDefense: Math.max(0, Math.min(100, 50 + (opr / 6))),
        spiderCycleSpeed: Math.max(0, Math.min(100, 50 + (tele / 4))),
        spiderReliability: Math.max(0, Math.min(100, 100 - Math.max(0, fouls))),
        spiderEndgame: Math.max(0, Math.min(100, end * 3)),
        lastComputed: new Date()
      }
    });

    importedTeams += 1;
  }

  return { importedTeams, type: 'oprs' };
}

function parseCsvText(csvText) {
  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });
}

function teamToNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(String(value).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseScheduleJsonText(text, eventKey) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.matches)
      ? parsed.matches
      : Array.isArray(parsed?.schedule)
        ? parsed.schedule
        : [];

  const records = [];
  for (const item of list) {
    const compLevel = String(item.comp_level || item.compLevel || 'qm').toLowerCase();
    const matchNumber = Number.parseInt(item.match_number ?? item.matchNumber ?? '', 10);
    const setNumber = Number.parseInt(item.set_number ?? item.setNumber ?? '1', 10) || 1;
    if (!Number.isFinite(matchNumber) || !compLevel) continue;

    const normalizedComp = ['qm', 'qf', 'sf', 'f'].includes(compLevel) ? compLevel : 'qm';
    const defaultMatchKey =
      normalizedComp === 'qm'
        ? `${eventKey}_qm${matchNumber}`
        : `${eventKey}_${normalizedComp}${setNumber}m${matchNumber}`;

    const alliances = item.alliances || {};
    const redAlliance = alliances.red || {};
    const blueAlliance = alliances.blue || {};

    const redKeys = Array.isArray(redAlliance.team_keys) ? redAlliance.team_keys : [];
    const blueKeys = Array.isArray(blueAlliance.team_keys) ? blueAlliance.team_keys : [];

    records.push({
      match_key: item.match_key || item.key || item.matchKey || defaultMatchKey,
      scheduled_date: item.scheduled_date || item.scheduledDate || '',
      scheduled_time: item.scheduled_time || item.scheduledTime || '',
      comp_level: normalizedComp,
      match_number: matchNumber,
      set_number: setNumber,
      red1: teamToNumber(item.red1) ?? teamToNumber(redKeys[0]),
      red2: teamToNumber(item.red2) ?? teamToNumber(redKeys[1]),
      red3: teamToNumber(item.red3) ?? teamToNumber(redKeys[2]),
      blue1: teamToNumber(item.blue1) ?? teamToNumber(blueKeys[0]),
      blue2: teamToNumber(item.blue2) ?? teamToNumber(blueKeys[1]),
      blue3: teamToNumber(item.blue3) ?? teamToNumber(blueKeys[2]),
      red_score: item.red_score ?? redAlliance.score ?? null,
      blue_score: item.blue_score ?? blueAlliance.score ?? null
    });
  }

  return records;
}

router.post('/csv', async (req, res) => {
  try {
    const { eventKey, csvText } = req.body || {};
    if (!eventKey) return res.status(400).json({ error: 'eventKey is required' });
    if (!csvText) return res.status(400).json({ error: 'csvText is required' });

    const records = parseCsvText(csvText);
    const result = await importScoutingCsv(records, eventKey);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/paste', async (req, res) => {
  try {
    const { eventKey = '2026casnd', text, type = 'auto' } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text is required' });

    const trimmed = String(text).trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const jsonRecords = parseScheduleJsonText(trimmed, eventKey);
      if (!jsonRecords.length) {
        return res.status(400).json({ error: 'JSON schedule contains no matches' });
      }
      const result = await importSchedule(jsonRecords, eventKey);
      return res.json({ ...result, type: 'schedule_json' });
    }

    const lines = String(text).split(/\r?\n/).filter(Boolean);
    const headerLine = lines[0] || '';
    const bodySample = lines.slice(1, 6).join('\n');

    const resolvedType = type === 'auto' ? await detectPasteType(headerLine, bodySample) : type;
    const records = parseCsvText(text);

    if (!records.length) return res.status(400).json({ error: 'No rows parsed from text' });

    if (resolvedType === 'schedule') {
      const result = await importSchedule(records, eventKey);
      return res.json(result);
    }

    if (resolvedType === 'flat_schedule') {
      const result = await importFlatSchedule(records, eventKey);
      return res.json(result);
    }

    if (resolvedType === 'oprs') {
      const result = await importOprs(records, eventKey);
      return res.json(result);
    }

    if (resolvedType === 'scouting_csv') {
      const result = await importScoutingCsv(records, eventKey);
      return res.json(result);
    }

    return res.status(400).json({ error: `Unable to classify paste type: ${resolvedType}` });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/offline-batch', async (req, res) => {
  try {
    const { eventKey, reports } = req.body || {};
    if (!eventKey) return res.status(400).json({ error: 'eventKey is required' });
    if (!Array.isArray(reports)) return res.status(400).json({ error: 'reports must be an array' });

    await ensureEvent(eventKey);

    let imported = 0;
    for (const report of reports) {
      const normalized = await normalizeMatchSubmission({ ...report, eventKey });
      await ensureTeam(normalized.team_number);
      await prisma.matchScoutingReport.create({
        data: {
          eventKey,
          teamNumber: normalized.team_number,
          scoutName: report.scoutName || 'offline-batch',
          allianceColor: normalized.alliance_color,
          matchNumber: normalized.match_number,
          compLevel: report.compLevel || 'qm',
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
          generalNotes: report.general_notes || null
        }
      });
      await recomputeTeamStats(eventKey, normalized.team_number);
      imported += 1;
    }

    return res.json({ imported });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

export default router;
