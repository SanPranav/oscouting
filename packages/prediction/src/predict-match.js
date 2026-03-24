import { prisma } from '@3749/db/src/client.js';
import { callSmolLM } from '@3749/ai/src/lemonade-client.js';

const UNKNOWN_VALUE = /^(idk|unknown|n\/?a|na|null|undefined|none)?$/i;
const REEFSCAPE_META_PROMPT = [
  'You are an elite FRC drive coach for Team 3749.',
  'Ground recommendations in 2026 match phases: auto mobility and opening lanes, teleop cycle efficiency, endgame value protection.',
  'Give specific, executable match instructions with team numbers, defender assignments, and cycle behavior.',
  'Use observed habits from notes to propose concrete counters.',
  'When team3749Ready is false, bias to lower-risk defense-heavy plans with simple legal contact patterns.',
  'Return JSON only with keys: shiftCalls (array of 3 short strings), defendCalls (array), offenseCalls (array), habitCounters (array), summary (string).'
].join(' ');

function parseQualMatchNumber(input) {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return null;

  if (/^\d+$/.test(value)) return Number(value);

  const qmMatch = value.match(/qm\s*(\d+)/);
  if (qmMatch) return Number(qmMatch[1]);

  const qMatch = value.match(/^q\s*(\d+)$/);
  if (qMatch) return Number(qMatch[1]);

  const keyMatch = value.match(/_qm(\d+)$/);
  if (keyMatch) return Number(keyMatch[1]);

  return null;
}

function parsePlayoffInput(input) {
  const value = String(input || '').trim().toLowerCase().replace(/\s+/g, '');
  const parsed = value.match(/^(qf|sf|f)(\d+)(?:m(\d+))?$/);
  if (!parsed) return null;

  const compLevel = parsed[1];
  const setNumber = Number(parsed[2]);
  const matchNumber = parsed[3] ? Number(parsed[3]) : 1;
  if (!Number.isFinite(setNumber) || !Number.isFinite(matchNumber)) return null;

  return { compLevel, setNumber, matchNumber, normalized: `${compLevel}${setNumber}m${matchNumber}` };
}

function buildNormalizedKey(eventKey, rawMatchKey) {
  const value = String(rawMatchKey || '').trim().toLowerCase();
  if (!value) return '';
  if (value.includes('_')) return value;

  const qmNumber = parseQualMatchNumber(value);
  if (Number.isFinite(qmNumber) && qmNumber > 0) return `${eventKey}_qm${qmNumber}`;

  const playoff = parsePlayoffInput(value);
  if (playoff) return `${eventKey}_${playoff.normalized}`;

  return `${eventKey}_${value}`;
}

function normalizeNoteValue(value) {
  const trimmed = String(value ?? '').trim();
  return UNKNOWN_VALUE.test(trimmed) ? 'N/A' : trimmed;
}

function parseGeneralNotes(generalNotes) {
  const text = String(generalNotes || '');
  if (!text) return {};

  const pairs = text
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=');
      if (index < 0) return [part, 'N/A'];
      const key = part.slice(0, index).trim();
      const value = normalizeNoteValue(part.slice(index + 1));
      return [key, value || 'N/A'];
    });

  return Object.fromEntries(pairs);
}

function buildNotesByTeam(rows) {
  const byTeam = new Map();
  for (const row of rows) {
    const teamNumber = Number(row.teamNumber);
    if (!teamNumber) continue;

    if (!byTeam.has(teamNumber)) byTeam.set(teamNumber, []);

    const parsed = parseGeneralNotes(row.generalNotes);
    byTeam.get(teamNumber).push({
      parsed,
      speed: row.teleopSpeedRating,
      defense: row.teleopDefenseRating,
      fouls: row.foulsCommitted
    });
  }

  const summary = {};
  for (const [teamNumber, entries] of byTeam.entries()) {
    const latest = entries.slice(0, 3);
    const signals = [];

    for (const entry of latest) {
      const comments = entry.parsed;
      const pushIfUseful = (key) => {
        const value = normalizeNoteValue(comments[key]);
        if (value && value !== 'N/A') signals.push(`${key}: ${value}`);
      };

      pushIfUseful('auto_path');
      pushIfUseful('fuel_cycle_notes');
      pushIfUseful('cycle_notes');
      pushIfUseful('driving_behavior_notes');
      pushIfUseful('driving_team_behavior_notes');
      pushIfUseful('fuel_notes');
      pushIfUseful('additional_notes');
    }

    summary[String(teamNumber)] = signals.length ? signals.slice(0, 6) : ['No detailed fuel notes (N/A)'];
  }

  return summary;
}

function computeWeaknesses(opponentTeams, statMap, scoutNotesByTeam) {
  const weaknesses = [];

  for (const teamNumber of opponentTeams) {
    const stat = statMap.get(teamNumber);
    if (!stat) continue;

    if (Number(stat.disableRate || 0) >= 0.2) {
      weaknesses.push(`Team ${teamNumber}: high disable risk — force long defensive possessions and contact windows`);
    }
    if (Number(stat.foulRate || 0) >= 1) {
      weaknesses.push(`Team ${teamNumber}: foul-prone — bait reaches and force tight-lane decisions`);
    }
    if (Number(stat.spiderReliability || 0) < 55) {
      weaknesses.push(`Team ${teamNumber}: inconsistent reliability — sustained pressure can create dead cycles`);
    }
    if (Number(stat.spiderCycleSpeed || 0) < 45) {
      weaknesses.push(`Team ${teamNumber}: slower cycles — deny midfield space and race them between fuel pieces`);
    }
    if (Number(stat.spiderAuto || 0) < 35) {
      weaknesses.push(`Team ${teamNumber}: weaker auto — prioritize early teleop fuel control`);
    }
  }

  for (const teamNumber of opponentTeams) {
    const notes = scoutNotesByTeam[String(teamNumber)] || [];
    const joined = notes.join(' | ').toLowerCase();

    if (joined.includes('did not move') || joined.includes("didn't move") || joined.includes('no auto')) {
      weaknesses.push(`Team ${teamNumber}: inconsistent auto mobility — expect delayed first cycle`);
    }
    if ((joined.includes('cross') && joined.includes('line')) || joined.includes('center line')) {
      weaknesses.push(`Team ${teamNumber}: predictable cross-line auto path — pre-plan traffic at their auto exit lane`);
    }
    if (joined.includes('easy to defend') || joined.includes('easily defendable') || joined.includes('defendable')) {
      weaknesses.push(`Team ${teamNumber}: easily defendable under contact — body them at shot setup points`);
    }
    if (joined.includes('jerky') || joined.includes('slow')) {
      weaknesses.push(`Team ${teamNumber}: driving consistency concerns — force turns and direction changes`);
    }
    if (joined.includes('not too accurate') || joined.includes('bounced out') || joined.includes('inaccurate')) {
      weaknesses.push(`Team ${teamNumber}: scoring accuracy issues — pressure contested shots`);
    }
  }

  return [...new Set(weaknesses)].slice(0, 8);
}

function computeStrengths(opponentTeams, statMap, scoutNotesByTeam) {
  const strengths = [];

  for (const teamNumber of opponentTeams) {
    const stat = statMap.get(teamNumber);
    if (!stat) continue;

    if (Number(stat.spiderTeleop || 0) >= 75 && Number(stat.spiderCycleSpeed || 0) >= 70) {
      strengths.push(`Team ${teamNumber}: high-tempo teleop scorer — hard to slow without coordinated double pressure`);
    }
    if (Number(stat.spiderAuto || 0) >= 70) {
      strengths.push(`Team ${teamNumber}: strong auto production — protect your opening cycle and avoid early deficit`);
    }
    if (Number(stat.spiderReliability || 0) >= 80) {
      strengths.push(`Team ${teamNumber}: very reliable under match pace`);
    }
  }

  for (const teamNumber of opponentTeams) {
    const notes = scoutNotesByTeam[String(teamNumber)] || [];
    const joined = notes.join(' | ').toLowerCase();

    if (joined.includes('impossible to defend') || joined.includes('hard to defend') || joined.includes('adaptive shooter')) {
      strengths.push(`Team ${teamNumber}: difficult to defend while shooting (adaptive release/shot shaping)`);
    }
    if (joined.includes('accurate') || joined.includes('deadeye') || joined.includes('consistent shooter')) {
      strengths.push(`Team ${teamNumber}: highly accurate shooter when left uncontested`);
    }
    if (joined.includes('fast cycle') || joined.includes('quick cycle') || joined.includes('smooth')) {
      strengths.push(`Team ${teamNumber}: efficient cycle flow through traffic`);
    }
  }

  return [...new Set(strengths)].slice(0, 6);
}

function average(rows, mapper) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + mapper(row), 0) / rows.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hasScoringSignal(row) {
  return (
    Number(row?.avgAutoTotalPoints || 0) > 0 ||
    Number(row?.avgTeleopTotalPoints || 0) > 0 ||
    Number(row?.avgEndgamePoints || 0) > 0 ||
    Number(row?.spiderAuto || 0) > 0 ||
    Number(row?.spiderTeleop || 0) > 0 ||
    Number(row?.spiderEndgame || 0) > 0
  );
}

function hasPointAverages(row) {
  return (
    Number(row?.avgAutoTotalPoints || 0) > 0 ||
    Number(row?.avgTeleopTotalPoints || 0) > 0 ||
    Number(row?.avgEndgamePoints || 0) > 0
  );
}

function mergeStatWithDerived(existing, derived) {
  if (!existing && !derived) return null;
  if (!existing) return derived;
  if (!derived) return existing;

  const existingAuto = Number(existing.avgAutoTotalPoints || 0);
  const existingTele = Number(existing.avgTeleopTotalPoints || 0);
  const existingEnd = Number(existing.avgEndgamePoints || 0);

  return {
    ...existing,
    avgAutoTotalPoints: existingAuto > 0 ? existingAuto : Number(derived.avgAutoTotalPoints || 0),
    avgTeleopTotalPoints: existingTele > 0 ? existingTele : Number(derived.avgTeleopTotalPoints || 0),
    avgEndgamePoints: existingEnd > 0 ? existingEnd : Number(derived.avgEndgamePoints || 0),
    disableRate: Number.isFinite(Number(existing.disableRate)) ? Number(existing.disableRate) : Number(derived.disableRate || 0),
    foulRate: Number.isFinite(Number(existing.foulRate)) ? Number(existing.foulRate) : Number(derived.foulRate || 0),
    spiderAuto: Number(existing.spiderAuto || 0) > 0 ? Number(existing.spiderAuto) : Number(derived.spiderAuto || 0),
    spiderTeleop: Number(existing.spiderTeleop || 0) > 0 ? Number(existing.spiderTeleop) : Number(derived.spiderTeleop || 0),
    spiderDefense: Number(existing.spiderDefense || 0) > 0 ? Number(existing.spiderDefense) : Number(derived.spiderDefense || 0),
    spiderCycleSpeed: Number(existing.spiderCycleSpeed || 0) > 0 ? Number(existing.spiderCycleSpeed) : Number(derived.spiderCycleSpeed || 0),
    spiderReliability: Number(existing.spiderReliability || 0) > 0 ? Number(existing.spiderReliability) : Number(derived.spiderReliability || 0),
    spiderEndgame: Number(existing.spiderEndgame || 0) > 0 ? Number(existing.spiderEndgame) : Number(derived.spiderEndgame || 0)
  };
}

function getTeamDataSource(existing, merged) {
  const mergedHasPoints = hasPointAverages(merged);
  const existingHasPoints = hasPointAverages(existing);

  if (existingHasPoints) return 'points';
  if (mergedHasPoints) return 'derived_points';
  if (hasScoringSignal(merged)) return 'ratings_only';
  return 'none';
}

function buildTeamDerivedStat(teamNumber, scoutingRows, externalRows) {
  if (!scoutingRows.length && !externalRows.length) return null;

  const scoutingAuto = average(scoutingRows, (row) => Number(row.autoFuelAuto || 0));
  const scoutingTele = average(scoutingRows, (row) => Number(row.teleopFuelScored || 0));
  const scoutingEnd = average(scoutingRows, (row) => Number(row.endgameTowerPoints || 0));
  const scoutingDisable = average(scoutingRows, (row) => (row.robotDisabled ? 1 : 0));
  const scoutingFouls = average(scoutingRows, (row) => Number(row.foulsCommitted || 0));
  const scoutingDefense = average(scoutingRows, (row) => Number(row.teleopDefenseRating || 0));
  const scoutingSpeed = average(scoutingRows, (row) => Number(row.teleopSpeedRating || 0));
  const scoutingClimbSuccess = average(scoutingRows, (row) => (
    ['level1', 'level2', 'level3'].includes(String(row.endgameResult || '').toLowerCase()) ? 1 : 0
  ));

  const externalAuto = average(externalRows, (row) => Number(row.autoFuel || 0));
  const externalTele = average(externalRows, (row) => Number(row.teleFuel || 0));
  const externalDisable = average(externalRows, (row) => (row.noShow ? 1 : 0));
  const externalFouls = average(externalRows, (row) => Number(row.fouls || 0));
  const externalDefense = average(externalRows, (row) => Number(row.defenseRating || 0));

  const autoAvg = scoutingAuto > 0 ? scoutingAuto : externalAuto;
  const teleAvg = scoutingTele > 0 ? scoutingTele : externalTele;
  const endAvg = scoutingEnd > 0 ? scoutingEnd : 0;

  const disableRate = scoutingRows.length
    ? scoutingDisable
    : (externalRows.length ? externalDisable : 0);
  const foulRate = scoutingRows.length
    ? scoutingFouls
    : (externalRows.length ? externalFouls : 0);

  const driverDefense = scoutingRows.length ? scoutingDefense : externalDefense;
  const driverSpeed = scoutingRows.length ? scoutingSpeed : 0;

  const spiderAuto = autoAvg > 0
    ? clamp(autoAvg * 5, 0, 100)
    : clamp(average(scoutingRows, (row) => (row.autoMobility ? 35 : 0)), 0, 100);
  const spiderTeleop = teleAvg > 0
    ? clamp(teleAvg * 3, 0, 100)
    : clamp((driverSpeed / 5) * 100 * 0.9, 0, 100);
  const spiderDefense = clamp((driverDefense / 5) * 100, 0, 100);
  const spiderCycleSpeed = clamp(
    driverSpeed > 0 ? (driverSpeed / 5) * 100 : 50 + (teleAvg / 4),
    0,
    100
  );
  const spiderEndgame = clamp(
    endAvg > 0 ? endAvg * 3 : scoutingClimbSuccess * 70,
    0,
    100
  );
  const spiderReliability = clamp(
    ((1 - disableRate) * 0.75 + (1 - clamp(foulRate / 3, 0, 1)) * 0.25) * 100,
    0,
    100
  );

  return {
    teamNumber,
    avgAutoTotalPoints: autoAvg,
    avgTeleopTotalPoints: teleAvg,
    avgEndgamePoints: endAvg,
    disableRate,
    foulRate,
    spiderAuto,
    spiderTeleop,
    spiderDefense,
    spiderCycleSpeed,
    spiderReliability,
    spiderEndgame
  };
}

function expectedPointsFromRow(row) {
  const autoRaw = Number(row.avgAutoTotalPoints || 0);
  const teleRaw = Number(row.avgTeleopTotalPoints || 0);
  const endRaw = Number(row.avgEndgamePoints || 0);

  const spiderAuto = Number(row.spiderAuto || 0);
  const spiderTeleop = Number(row.spiderTeleop || 0);
  const spiderEndgame = Number(row.spiderEndgame || 0);

  const autoPoints = autoRaw > 0 ? autoRaw : (spiderAuto / 100) * 12;
  const teleopPoints = teleRaw > 0 ? teleRaw : (spiderTeleop / 100) * 35;
  const endgamePoints = endRaw > 0 ? endRaw : (spiderEndgame / 100) * 20;

  return {
    autoPoints,
    teleopPoints,
    endgamePoints
  };
}

function buildStatFromStatbotics(teamNumber, statbotics) {
  if (!statbotics) return null;

  const autoPoints = Number(statbotics.autoEPA || 0);
  const teleopPoints = Number(statbotics.teleopEPA || 0);
  const endgamePoints = Number(statbotics.endgameEPA || 0);
  const total = autoPoints + teleopPoints + endgamePoints;
  if (total <= 0) return null;

  const percentile = clamp(Number(statbotics.percentile || 0), 0, 1);
  const reliability = clamp(55 + percentile * 40, 55, 95);

  return {
    teamNumber,
    avgAutoTotalPoints: autoPoints,
    avgTeleopTotalPoints: teleopPoints,
    avgEndgamePoints: endgamePoints,
    disableRate: 0.08,
    foulRate: 0.3,
    spiderAuto: clamp((autoPoints / 12) * 100, 0, 100),
    spiderTeleop: clamp((teleopPoints / 35) * 100, 0, 100),
    spiderDefense: 50,
    spiderCycleSpeed: clamp((teleopPoints / 35) * 100, 0, 100),
    spiderReliability: reliability,
    spiderEndgame: clamp((endgamePoints / 20) * 100, 0, 100),
    statboticsEPA: Number(statbotics.epa || 0),
    statboticsAutoEPA: autoPoints,
    statboticsTeleopEPA: teleopPoints,
    statboticsEndgameEPA: endgamePoints,
    statboticsPercentile: percentile
  };
}

function blendExpectedPointsWithStatbotics(localPoints, row, dataSource) {
  const sbAuto = Number(row?.statboticsAutoEPA || 0);
  const sbTeleop = Number(row?.statboticsTeleopEPA || 0);
  const sbEndgame = Number(row?.statboticsEndgameEPA || 0);
  const sbTotal = sbAuto + sbTeleop + sbEndgame;
  if (sbTotal <= 0) return localPoints;

  const localTotal = Number(localPoints.autoPoints || 0) + Number(localPoints.teleopPoints || 0) + Number(localPoints.endgamePoints || 0);

  let localWeight = 0.65;
  switch (dataSource) {
    case 'points':
      localWeight = 0.8;
      break;
    case 'derived_points':
      localWeight = 0.65;
      break;
    case 'ratings_only':
      localWeight = 0.35;
      break;
    case 'statbotics_only':
      localWeight = 0;
      break;
    default:
      localWeight = localTotal > 0 ? 0.45 : 0;
      break;
  }

  if (localTotal <= 0) localWeight = 0;
  const statboticsWeight = 1 - localWeight;

  return {
    autoPoints: Number(localPoints.autoPoints || 0) * localWeight + sbAuto * statboticsWeight,
    teleopPoints: Number(localPoints.teleopPoints || 0) * localWeight + sbTeleop * statboticsWeight,
    endgamePoints: Number(localPoints.endgamePoints || 0) * localWeight + sbEndgame * statboticsWeight
  };
}

// Fetch Statbotics EPA data for threat assessment
async function fetchStatboticsTeamData(teamNumber, year = 2026) {
  try {
    const response = await fetch(`https://api.statbotics.io/v3/team_year/${teamNumber}/${year}`);
    if (!response.ok) return null;
    const data = await response.json();
    const epa = data?.epa || {};
    const breakdown = epa?.breakdown || {};
    return {
      teamNumber,
      epa: Number(epa?.total_points?.mean || epa?.total_points || 0),
      autoEPA: Number(breakdown?.auto_points || 0),
      teleopEPA: Number(breakdown?.teleop_points || 0),
      endgameEPA: Number(breakdown?.endgame_points || 0),
      opr: Number(epa?.norm || 0),
      dpr: 0,
      ccwm: 0,
      source: 'statbotics'
    };
  } catch {
    return null;
  }
}

// Score threat level: higher = more dangerous to defend
function threatScore(stat) {
  const spiderTeleop = Number(stat.spiderTeleop || 0);
  const spiderCycleSpeed = Number(stat.spiderCycleSpeed || 0);
  const spiderReliability = Number(stat.spiderReliability || 0);
  const statboticsEPA = Number(stat.statboticsEPA || 0);
  
  // Weight: teleop scoring (40%) + cycle speed (35%) + reliability (15%) + external EPA (10%)
  return (spiderTeleop * 0.4) + (spiderCycleSpeed * 0.35) + (spiderReliability * 0.15) + (Math.min(statboticsEPA * 10, 100) * 0.1);
}

function inferHabitsFromNotes(notes = []) {
  const text = notes.join(' | ').toLowerCase();
  const habits = [];

  if (text.includes('center') || text.includes('midfield')) habits.push('Prefers center-lane routing');
  if (text.includes('trench') || text.includes('depot') || text.includes('bump')) habits.push('Uses consistent intake lane landmarks');
  if (text.includes('same') && text.includes('auto')) habits.push('Repeats same auto path');
  if (text.includes('slow') || text.includes('jerky')) habits.push('Loses pace during forced direction changes');
  if (text.includes('accurate') || text.includes('consistent shooter')) habits.push('High shot confidence once set');
  if (text.includes('easy to defend') || text.includes('defendable')) habits.push('Drops output under contact pressure');
  if (text.includes('no auto') || text.includes('did not move')) habits.push('Occasional auto mobility failures');

  return [...new Set(habits)].slice(0, 3);
}

function buildOurDriveProfile(notes = [], ourTeamStat = null) {
  const text = notes.join(' | ').toLowerCase();
  const speed = Number(ourTeamStat?.spiderCycleSpeed || 50);
  const reliability = Number(ourTeamStat?.spiderReliability || 50);
  const foulRate = Number(ourTeamStat?.foulRate || 0);

  const unstableNotes = ['jerky', 'inconsistent', 'slow', 'hesitant', 'missed alignment']
    .filter((term) => text.includes(term));

  return {
    speed,
    reliability,
    foulRate,
    unstable: unstableNotes.length > 0 || speed < 55 || reliability < 60 || foulRate > 1.1
  };
}

// Generate tactical strategy for drive team
function generateTacticalStrategy(opponentTeams, statMap, allianceStats, scoutNotesByTeam, ourTeamStats, options = {}) {
  const team3749Ready = options.team3749Ready !== false;
  const ourDriveProfile = options.ourDriveProfile || { unstable: false, speed: 60, reliability: 65, foulRate: 0.7 };

  if (opponentTeams.length === 0) return null;

  const rankedOpponents = opponentTeams
    .map((teamNumber) => {
      const stat = statMap.get(teamNumber);
      if (!stat) return null;
      return {
        teamNumber,
        stat,
        threatLevel: threatScore(stat),
        notes: scoutNotesByTeam[String(teamNumber)] || []
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.threatLevel - a.threatLevel);

  if (!rankedOpponents.length) return null;

  const primaryOpponent = rankedOpponents[0];
  const secondaryOpponent = rankedOpponents[1] || null;
  const tertiaryOpponent = rankedOpponents[2] || null;
  const primaryHabits = inferHabitsFromNotes(primaryOpponent.notes);

  const allyRankedDefense = [...allianceStats].sort((a, b) => Number(b.spiderDefense || 0) - Number(a.spiderDefense || 0));
  const allyRankedTeleop = [...allianceStats].sort((a, b) => Number(b.spiderTeleop || 0) - Number(a.spiderTeleop || 0));
  const primaryDefenderTeam = allyRankedDefense[0]?.teamNumber || 3749;
  const supportDefenderTeam = allyRankedDefense[1]?.teamNumber || allyRankedTeleop[0]?.teamNumber || 3749;
  const cycleLeadTeam = allyRankedTeleop[0]?.teamNumber || 3749;
  const cycleSupportTeam = allyRankedTeleop[1]?.teamNumber || supportDefenderTeam;

  const ourAutoScore = allianceStats.length
    ? allianceStats.reduce((sum, row) => sum + (Number(row.spiderAuto || 0) / 100) * 12, 0) / allianceStats.length
    : 0;
  const primaryAutoScore = (Number(primaryOpponent.stat.spiderAuto || 0) / 100) * 12;
  const primaryTeleopScore = (Number(primaryOpponent.stat.spiderTeleop || 0) / 100) * 35;
  const primaryEndgameScore = (Number(primaryOpponent.stat.spiderEndgame || 0) / 100) * 20;

  const autoRecommendation = primaryAutoScore > ourAutoScore + 3
    ? `Conservative auto start. Team ${primaryDefenderTeam} exits near-side first to establish first contact on Team ${primaryOpponent.teamNumber}.`
    : `Aggressive auto start. Team ${cycleLeadTeam} takes first scoring look, Team ${primaryDefenderTeam} shades center lane immediately after mobility.`;

  const shiftStrategies = [
    {
      number: 1,
      duration: '0:00-0:45',
      focus: [primaryOpponent.teamNumber],
      pressure: 'HIGH',
      objective: `Team ${primaryDefenderTeam} defends Team ${primaryOpponent.teamNumber} on first two cycles; Team ${cycleLeadTeam} secures two clean scoring cycles.`,
      tactic: primaryHabits.length
        ? `Exploit habit: ${primaryHabits[0]}. Cut lane early and force reroute before shot setup.`
        : `Meet at lane entry and deny preferred setup angle.`,
      backupPlan: secondaryOpponent
        ? `If Team ${secondaryOpponent.teamNumber} gets free cycles, Team ${supportDefenderTeam} tags once then returns.`
        : `Keep primary lock and avoid reach fouls.`
    },
    {
      number: 2,
      duration: '0:45-1:45',
      focus: [primaryOpponent.teamNumber, secondaryOpponent?.teamNumber].filter(Boolean),
      pressure: team3749Ready ? 'ROTATING' : 'DEFENSE-HEAVY',
      objective: team3749Ready
        ? `Run 2:1 split: Team ${primaryDefenderTeam} pressures Team ${primaryOpponent.teamNumber}, Team ${supportDefenderTeam} checks secondary lanes.`
        : `Defense mode: Team ${primaryDefenderTeam} and Team ${supportDefenderTeam} alternate pressure on Team ${primaryOpponent.teamNumber} every cycle.`,
      tactic: team3749Ready
        ? `Team ${cycleLeadTeam} + Team ${cycleSupportTeam} keep short safe cycles and shoot on clean windows only.`
        : `Reduce risky shots; prioritize block-and-release defense to minimize foul exposure.`,
      backupPlan: ourDriveProfile.unstable
        ? 'If drive consistency drops, simplify to lane-shadow defense and guaranteed short cycles.'
        : 'If ahead by >12 projected points, switch to low-foul containment.'
    },
    {
      number: 3,
      duration: '1:45-Endgame',
      focus: [primaryOpponent.teamNumber, 'endgame execution'],
      pressure: 'TACTICAL',
      objective: `Deny Team ${primaryOpponent.teamNumber} clean endgame setup while preserving own climb/tower points.`,
      tactic: `Team ${supportDefenderTeam} applies one legal bump if they set early, then disengages. Team ${cycleLeadTeam} commits to clean finish.`,
      backupPlan: `Final 10s: no hero fouls; secure guaranteed endgame value.`
    }
  ];

  const offensePlan = team3749Ready
    ? [
        `Team ${cycleLeadTeam} takes first-shot priority; Team ${cycleSupportTeam} runs short recycle lanes.`,
        'Shoot only from repeatable release points; abandon contested windows early.',
        'If two consecutive misses occur, switch to shortest guaranteed cycle path.'
      ]
    : [
        `Team ${cycleLeadTeam} only takes high-confidence shots; Team ${cycleSupportTeam} supports lane control.`,
        'Convert to possession-denial cycles between opponent intake and scoring lanes.',
        'Value consistency over volume until drive rhythm stabilizes.'
      ];

  const defensePlan = [
    `Primary target: Team ${primaryOpponent.teamNumber} handled by Team ${primaryDefenderTeam}.`,
    secondaryOpponent
      ? `Secondary disrupt: Team ${secondaryOpponent.teamNumber} by Team ${supportDefenderTeam} every third cycle.`
      : `Secondary disrupt: hold center denial and force all opponents wide.`,
    primaryHabits.length
      ? `Habit exploit: ${primaryHabits.join('; ')}.`
      : 'Habit exploit: force direction changes and deny repeat routes.'
  ];

  const concisePlan = [
    `Defend Team ${primaryOpponent.teamNumber} first; do not allow free opening cycles.`,
    `Cycle assignment: Team ${cycleLeadTeam} lead offense, Team ${cycleSupportTeam} support cycles.`,
    autoRecommendation,
    primaryEndgameScore >= 12
      ? `Endgame threat from Team ${primaryOpponent.teamNumber} (${primaryEndgameScore.toFixed(1)} est). Contest setup then disengage clean.`
      : 'Endgame focus: guarantee own climb/tower points and avoid last-second fouls.'
  ];

  return {
    primaryThreat: {
      teamNumber: primaryOpponent.teamNumber,
      threatLevel: primaryOpponent.threatLevel.toFixed(1),
      reason: `Primary threat from teleop pace ${primaryTeleopScore.toFixed(1)} and route consistency`,
      stats: {
        teleopScore: primaryTeleopScore.toFixed(1),
        endgameScore: primaryEndgameScore.toFixed(1),
        cycleSpeed: primaryOpponent.stat.spiderCycleSpeed?.toFixed(0),
        reliability: (primaryOpponent.stat.spiderReliability || 0).toFixed(0),
        statboticsEPA: Number(primaryOpponent.stat.statboticsEPA || 0).toFixed(2),
        exploitable: primaryOpponent.stat.disableRate >= 0.2 ? 'High disable risk' : 'Limited openings'
      },
      habits: primaryHabits
    },
    secondaryThreat: secondaryOpponent
      ? {
          teamNumber: secondaryOpponent.teamNumber,
          threatLevel: secondaryOpponent.threatLevel.toFixed(1),
          role: 'Rotation target and route denial'
        }
      : tertiaryOpponent
        ? {
            teamNumber: tertiaryOpponent.teamNumber,
            threatLevel: tertiaryOpponent.threatLevel.toFixed(1),
            role: 'Tertiary pressure watch'
          }
        : null,
    autoRecommendation,
    offensePlan,
    defensePlan,
    shiftStrategies,
    concisePlan,
    assignments: {
      primaryDefenderTeam,
      supportDefenderTeam,
      cycleLeadTeam,
      cycleSupportTeam
    },
    mode: team3749Ready ? 'balanced' : 'defense-heavy',
    summary: team3749Ready
      ? `Balanced plan: Team ${primaryDefenderTeam} contains ${primaryOpponent.teamNumber}, offense led by Team ${cycleLeadTeam}.`
      : `Defense-heavy plan: double pressure windows on ${primaryOpponent.teamNumber}, conservative shooting and clean endgame.`
  };
}

async function generateAiTacticalEnrichment(payload) {
  try {
    const result = await callSmolLM(REEFSCAPE_META_PROMPT, JSON.stringify(payload), true);
    if (!result || typeof result !== 'object') return null;

    return {
      shiftCalls: Array.isArray(result.shiftCalls) ? result.shiftCalls.slice(0, 3).map((value) => String(value)) : [],
      defendCalls: Array.isArray(result.defendCalls) ? result.defendCalls.slice(0, 4).map((value) => String(value)) : [],
      offenseCalls: Array.isArray(result.offenseCalls) ? result.offenseCalls.slice(0, 4).map((value) => String(value)) : [],
      habitCounters: Array.isArray(result.habitCounters) ? result.habitCounters.slice(0, 4).map((value) => String(value)) : [],
      summary: String(result.summary || '').trim()
    };
  } catch {
    return null;
  }
}

export async function fetchTeamStatboticsData(teamNumbers, year = 2026) {
  const results = await Promise.all(
    teamNumbers.map((num) => fetchStatboticsTeamData(num, year))
  );
  return new Map(results.filter(Boolean).map((r) => [r.teamNumber, r]));
}

export async function predictMatch(eventKey, matchKey, options = {}) {
  const focusTeam = Number.parseInt(String(options.focusTeam ?? options.teamNumber ?? '3749'), 10) || 3749;
  const team3749Ready = options.teamReady !== undefined
    ? options.teamReady !== false
    : options.team3749Ready !== false;
  const normalizedKey = buildNormalizedKey(eventKey, matchKey);

  let match = await prisma.match.findUnique({ where: { matchKey: normalizedKey } });

  if (!match) {
    const playoff = parsePlayoffInput(matchKey);
    if (playoff) {
      match = await prisma.match.findFirst({
        where: {
          eventKey,
          compLevel: playoff.compLevel,
          setNumber: playoff.setNumber,
          matchNumber: playoff.matchNumber
        }
      });
    }
  }

  if (!match) {
    const qmNumber = parseQualMatchNumber(matchKey);
    if (Number.isFinite(qmNumber) && qmNumber > 0) {
      match = await prisma.match.findFirst({
        where: { eventKey, compLevel: 'qm', matchNumber: qmNumber }
      });
    }
  }

  if (!match) {
    throw new Error(`Match not found: ${matchKey}. Import full schedule in Aggregator (AI Import Paste) for ${eventKey}.`);
  }

  const redTeams = [match.redTeam1, match.redTeam2, match.redTeam3].filter(Boolean);
  const blueTeams = [match.blueTeam1, match.blueTeam2, match.blueTeam3].filter(Boolean);

  const [redStats, blueStats] = await Promise.all([
    prisma.teamAggregatedStat.findMany({ where: { eventKey, teamNumber: { in: redTeams } } }),
    prisma.teamAggregatedStat.findMany({ where: { eventKey, teamNumber: { in: blueTeams } } })
  ]);

  const allTeams = [...new Set([...redTeams, ...blueTeams])];
  const [scoutingRowsForTeams, externalRowsForTeams] = await Promise.all([
    prisma.matchScoutingReport.findMany({
      where: { eventKey, teamNumber: { in: allTeams } },
      select: {
        teamNumber: true,
        autoFuelAuto: true,
        teleopFuelScored: true,
        endgameTowerPoints: true,
        robotDisabled: true,
        foulsCommitted: true,
        teleopDefenseRating: true,
        teleopSpeedRating: true,
        autoMobility: true,
        endgameResult: true
      }
    }),
    prisma.externalScoutImport.findMany({
      where: { eventKey, teamNumber: { in: allTeams } },
      select: {
        teamNumber: true,
        autoFuel: true,
        teleFuel: true,
        defenseRating: true,
        fouls: true,
        noShow: true
      }
    })
  ]);

  let statboticsByTeam = new Map();
  try {
    statboticsByTeam = await fetchTeamStatboticsData(allTeams);
  } catch {
    statboticsByTeam = new Map();
  }

  const scoutingByTeam = new Map();
  for (const row of scoutingRowsForTeams) {
    const teamNumber = Number(row.teamNumber);
    if (!teamNumber) continue;
    if (!scoutingByTeam.has(teamNumber)) scoutingByTeam.set(teamNumber, []);
    scoutingByTeam.get(teamNumber).push(row);
  }

  const externalByTeam = new Map();
  for (const row of externalRowsForTeams) {
    const teamNumber = Number(row.teamNumber);
    if (!teamNumber) continue;
    if (!externalByTeam.has(teamNumber)) externalByTeam.set(teamNumber, []);
    externalByTeam.get(teamNumber).push(row);
  }

  const existingByTeam = new Map([...redStats, ...blueStats].map((row) => [row.teamNumber, row]));
  const effectiveByTeam = new Map();
  const teamDataSource = new Map();

  for (const teamNumber of allTeams) {
    const existing = existingByTeam.get(teamNumber) || null;
    const statbotics = statboticsByTeam.get(teamNumber) || null;
    const derived = buildTeamDerivedStat(
      teamNumber,
      scoutingByTeam.get(teamNumber) || [],
      externalByTeam.get(teamNumber) || []
    );

    let merged = mergeStatWithDerived(existing, derived);
    if (!merged) {
      const statboticsOnly = buildStatFromStatbotics(teamNumber, statbotics);
      if (statboticsOnly) {
        effectiveByTeam.set(teamNumber, statboticsOnly);
        teamDataSource.set(teamNumber, 'statbotics_only');
      } else {
        teamDataSource.set(teamNumber, 'none');
      }
      continue;
    }

    if (statbotics) {
      merged = {
        ...merged,
        statboticsEPA: Number(statbotics.epa || 0),
        statboticsAutoEPA: Number(statbotics.autoEPA || 0),
        statboticsTeleopEPA: Number(statbotics.teleopEPA || 0),
        statboticsEndgameEPA: Number(statbotics.endgameEPA || 0),
        statboticsPercentile: Number(statbotics.percentile || 0)
      };
    }

    if (!merged) {
      teamDataSource.set(teamNumber, 'none');
      continue;
    }

    if (hasPointAverages(merged) || hasScoringSignal(merged)) {
      effectiveByTeam.set(teamNumber, merged);
      teamDataSource.set(teamNumber, getTeamDataSource(existing, merged));
    } else {
      teamDataSource.set(teamNumber, 'none');
    }
  }

  const redEffectiveStats = redTeams.map((teamNumber) => effectiveByTeam.get(teamNumber)).filter(Boolean);
  const blueEffectiveStats = blueTeams.map((teamNumber) => effectiveByTeam.get(teamNumber)).filter(Boolean);

  const recentNotesRows = await prisma.matchScoutingReport.findMany({
    where: { eventKey, teamNumber: { in: allTeams } },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      teamNumber: true,
      generalNotes: true,
      teleopSpeedRating: true,
      teleopDefenseRating: true,
      foulsCommitted: true
    }
  });
  const scoutNotesByTeam = buildNotesByTeam(recentNotesRows);

  const redSet = new Set(redTeams);
  const blueSet = new Set(blueTeams);
  const team3749Playing = redSet.has(focusTeam) || blueSet.has(focusTeam);
  const ourAlliance = redSet.has(focusTeam) ? 'red' : blueSet.has(focusTeam) ? 'blue' : null;
  const opponentTeams = ourAlliance === 'red' ? blueTeams : ourAlliance === 'blue' ? redTeams : [];
  const allyTeams = ourAlliance === 'red' ? redTeams : ourAlliance === 'blue' ? blueTeams : [];

  const statMap = new Map([...redEffectiveStats, ...blueEffectiveStats].map((row) => [row.teamNumber, row]));
  const opponentWeaknesses = team3749Playing
    ? computeWeaknesses(opponentTeams, statMap, scoutNotesByTeam)
    : [];
  const opponentStrengths = team3749Playing
    ? computeStrengths(opponentTeams, statMap, scoutNotesByTeam)
    : [];

  // Merge Statbotics EPA into stat map for tactical + scoring blend
  for (const [teamNumber, sbData] of statboticsByTeam) {
    const existing = statMap.get(teamNumber);
    if (existing) {
      existing.statboticsEPA = Number(sbData.epa || 0);
      existing.statboticsAutoEPA = Number(sbData.autoEPA || 0);
      existing.statboticsTeleopEPA = Number(sbData.teleopEPA || 0);
      existing.statboticsEndgameEPA = Number(sbData.endgameEPA || 0);
      existing.statboticsOPR = Number(sbData.opr || 0);
    }
  }

  const score = (rows) => rows.reduce((sum, row) => {
    const localExpected = expectedPointsFromRow(row);
    const dataSource = teamDataSource.get(row.teamNumber) || 'none';
    const { autoPoints, teleopPoints, endgamePoints } = blendExpectedPointsWithStatbotics(localExpected, row, dataSource);
    const disablePenalty = 1 - Number(row.disableRate || 0);
    const foulPenalty = 1 - Math.min(0.18, Number(row.foulRate || 0) * 0.06);
    return sum + (autoPoints + teleopPoints + endgamePoints) * disablePenalty * foulPenalty;
  }, 0);

  const redPredicted = Number(score(redEffectiveStats).toFixed(2));
  const bluePredicted = Number(score(blueEffectiveStats).toFixed(2));

  const coverage = (teams) => {
    const total = teams.length || 1;
    const pointsTeams = teams.filter((teamNumber) => {
      const source = teamDataSource.get(teamNumber);
      return source === 'points' || source === 'derived_points';
    }).length;
    const ratingsOnlyTeams = teams.filter((teamNumber) => teamDataSource.get(teamNumber) === 'ratings_only').length;
    const statboticsTeams = teams.filter((teamNumber) => teamDataSource.get(teamNumber) === 'statbotics_only').length;

    return {
      totalTeams: teams.length,
      pointsTeams,
      ratingsOnlyTeams,
      statboticsTeams,
      pointsCoveragePct: Number(((pointsTeams / total) * 100).toFixed(1))
    };
  };

  const redCoverage = coverage(redTeams);
  const blueCoverage = coverage(blueTeams);

  const dataQuality = {
    red: redCoverage,
    blue: blueCoverage,
    byTeam: allTeams.map((teamNumber) => ({
      teamNumber,
      source: teamDataSource.get(teamNumber) || 'none'
    }))
  };

  let narrative = 'Prediction generated from available scouting data.';
  if (!team3749Playing) {
    narrative = `${focusTeam} is not playing.`;
  } else {
    try {
      narrative = await callSmolLM(
        'You are a concise FRC strategy analyst for Team 3749. Give 2-3 short tactical sentences focused on how 3749\'s alliance gets ahead by attacking opponent weaknesses. Treat unknown/idk as N/A.',
        JSON.stringify({
          matchKey,
          ourAlliance,
          redPredicted,
          bluePredicted,
          redTeams,
          blueTeams,
          opponentTeams,
          opponentWeaknesses,
          opponentStrengths,
          scoutNotesByTeam
        }),
        false
      );
    } catch {
      if (opponentWeaknesses.length) {
        const strengthsText = opponentStrengths.length
          ? ` Respect: ${opponentStrengths.slice(0, 2).join('; ')}.`
          : '';
        narrative = `${focusTeam} focus: target opponent weaknesses — ${opponentWeaknesses.slice(0, 3).join('; ')}.${strengthsText}`;
      } else if (redPredicted > bluePredicted) {
        narrative = `${focusTeam} focus: keep cycles clean and protect your lead with low-foul defense.`;
      } else {
        narrative = `${focusTeam} focus: speed up fuel cycle handoff and force opponent errors in transition.`;
      }
    }
  }

  // Generate tactical strategy for drive team
  let tacticalPlan = null;
  const allyTeamStats = allyTeams
    .map((teamNumber) => effectiveByTeam.get(teamNumber))
    .filter(Boolean);
  const ourTeamNotes = scoutNotesByTeam[String(focusTeam)] || [];
  const ourDriveProfile = buildOurDriveProfile(ourTeamNotes, effectiveByTeam.get(focusTeam));
  if (team3749Playing && opponentTeams.length > 0) {
    tacticalPlan = generateTacticalStrategy(
      opponentTeams,
      statMap,
      allyTeamStats,
      scoutNotesByTeam,
      effectiveByTeam.get(focusTeam),
      {
        team3749Ready,
        ourDriveProfile
      }
    );

    if (tacticalPlan) {
      const aiTactical = await generateAiTacticalEnrichment({
        eventKey,
        matchKey,
        focusTeam,
        team3749Ready,
        ourAlliance,
        redPredicted,
        bluePredicted,
        allyTeams,
        opponentTeams,
        primaryThreat: tacticalPlan.primaryThreat,
        secondaryThreat: tacticalPlan.secondaryThreat,
        assignments: tacticalPlan.assignments,
        opponentWeaknesses,
        opponentStrengths,
        scoutNotesByTeam
      });

      if (aiTactical) {
        tacticalPlan = {
          ...tacticalPlan,
          aiEnhanced: true,
          shiftCalls: aiTactical.shiftCalls,
          defendCalls: aiTactical.defendCalls,
          offenseCalls: aiTactical.offenseCalls,
          habitCounters: aiTactical.habitCounters,
          summary: aiTactical.summary || tacticalPlan.summary
        };
      }
    }
  }

  return {
    matchKey: match.matchKey || normalizedKey,
    redPredicted,
    bluePredicted,
    confidence: redEffectiveStats.length + blueEffectiveStats.length >= 4 ? 'medium' : 'low',
    focusTeam,
    focusTeamPlaying: team3749Playing,
    focusTeamReady: team3749Ready,
    team3749Playing,
    ourAlliance,
    opponentWeaknesses,
    opponentStrengths,
    dataQuality,
    narrative,
    team3749Ready,
    tacticalPlan
  };
}
