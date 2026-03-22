import { prisma } from '@3749/db/src/client.js';
import { callSmolLM } from '@3749/ai/src/lemonade-client.js';

const UNKNOWN_VALUE = /^(idk|unknown|n\/?a|na|null|undefined|none)?$/i;

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

export async function predictMatch(eventKey, matchKey) {
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
    const derived = buildTeamDerivedStat(
      teamNumber,
      scoutingByTeam.get(teamNumber) || [],
      externalByTeam.get(teamNumber) || []
    );

    const merged = mergeStatWithDerived(existing, derived);
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
  const team3749Playing = redSet.has(3749) || blueSet.has(3749);
  const ourAlliance = redSet.has(3749) ? 'red' : blueSet.has(3749) ? 'blue' : null;
  const opponentTeams = ourAlliance === 'red' ? blueTeams : ourAlliance === 'blue' ? redTeams : [];

  const statMap = new Map([...redEffectiveStats, ...blueEffectiveStats].map((row) => [row.teamNumber, row]));
  const opponentWeaknesses = team3749Playing
    ? computeWeaknesses(opponentTeams, statMap, scoutNotesByTeam)
    : [];
  const opponentStrengths = team3749Playing
    ? computeStrengths(opponentTeams, statMap, scoutNotesByTeam)
    : [];

  const score = (rows) => rows.reduce((sum, row) => {
    const { autoPoints, teleopPoints, endgamePoints } = expectedPointsFromRow(row);
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

    return {
      totalTeams: teams.length,
      pointsTeams,
      ratingsOnlyTeams,
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
    narrative = '3749 is not playing.';
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
        narrative = `3749 focus: target opponent weaknesses — ${opponentWeaknesses.slice(0, 3).join('; ')}.${strengthsText}`;
      } else if (redPredicted > bluePredicted) {
        narrative = '3749 focus: keep cycles clean and protect your lead with low-foul defense.';
      } else {
        narrative = '3749 focus: speed up fuel cycle handoff and force opponent errors in transition.';
      }
    }
  }

  return {
    matchKey: match.matchKey || normalizedKey,
    redPredicted,
    bluePredicted,
    confidence: redEffectiveStats.length + blueEffectiveStats.length >= 4 ? 'medium' : 'low',
    team3749Playing,
    ourAlliance,
    opponentWeaknesses,
    opponentStrengths,
    dataQuality,
    narrative
  };
}
