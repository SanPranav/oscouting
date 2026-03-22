import { Router } from 'express';
import { prisma } from '@3749/db/src/client.js';
import { predictMatch } from '@3749/prediction/src/predict-match.js';
import { callSmolLM } from '@3749/ai/src/lemonade-client.js';
import { syncTbaEvent } from '@3749/tba/src/sync.js';
import { recomputeExternalTeamStats } from '../stats.js';
import { fetchStatboticsByTeams, fetchStatboticsTeamYear } from '../services/statbotics.js';

const router = Router();
const tbaScheduleSyncState = new Map();
const TBA_SCHEDULE_SYNC_TTL_MS = 90 * 1000;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

async function maybeRefreshScheduleFromTba(eventKey, force = false) {
  const now = Date.now();
  const state = tbaScheduleSyncState.get(eventKey);

  if (!force && state && state.inFlight) return state.inFlight;
  if (!force && state && now - state.at < TBA_SCHEDULE_SYNC_TTL_MS) return state.lastResult || null;

  const inFlight = syncTbaEvent(eventKey)
    .then((result) => {
      tbaScheduleSyncState.set(eventKey, { at: Date.now(), inFlight: null, lastResult: result });
      return result;
    })
    .catch((error) => {
      tbaScheduleSyncState.set(eventKey, { at: Date.now(), inFlight: null, lastResult: null, lastError: error?.message || String(error) });
      return null;
    });

  tbaScheduleSyncState.set(eventKey, { at: now, inFlight, lastResult: state?.lastResult || null, lastError: state?.lastError || null });
  return inFlight;
}

function computePickLeaderboard(statsRows, ourTeam, context) {
  const byTeam = new Map(statsRows.map((row) => [row.teamNumber, row]));
  const our = byTeam.get(ourTeam) || null;
  const rankingByTeam = context?.rankingByTeam || new Map();
  const epaByTeam = context?.epaByTeam || new Map();
  const statboticsByTeam = context?.statboticsByTeam || new Map();
  const reportByTeam = context?.reportByTeam || new Map();

  const allEpaValues = [
    ...epaByTeam.values(),
    ...[...statboticsByTeam.values()].map((row) => Number(row?.epa || 0))
  ].filter((value) => Number.isFinite(value) && value > 0);
  const maxEpa = allEpaValues.length ? Math.max(...allEpaValues) : 0;

  const rankValues = [...rankingByTeam.values()]
    .map((row) => Number(row.rank || 0))
    .filter((value) => value > 0);
  const maxRank = rankValues.length ? Math.max(...rankValues) : 1;

  const scored = statsRows
    .filter((row) => row.teamNumber !== ourTeam)
    .map((row) => {
      const auto = Number(row.spiderAuto || 0);
      const teleop = Number(row.spiderTeleop || 0);
      const defense = Number(row.spiderDefense || 0);
      const cycle = Number(row.spiderCycleSpeed || 0);
      const reliability = Number(row.spiderReliability || 0);
      const endgame = Number(row.spiderEndgame || 0);
      const disableRate = Number(row.disableRate || 0);
      const foulRate = Number(row.foulRate || 0);
      const matches = Number(row.matchesScouted || 0);
      const climbSuccess = Number(row.climbSuccessRate || 0);

      const rankRow = rankingByTeam.get(row.teamNumber) || null;
      const rank = Number(rankRow?.rank || 0);
      const rankingPoints = Number(rankRow?.rankingPoints || 0);
      const rankScore = rank > 0 ? clamp(((maxRank - rank + 1) / maxRank) * 100, 0, 100) : 50;
      const rpScore = clamp(rankingPoints * 18, 0, 100);

      const epaRaw = Number(epaByTeam.get(row.teamNumber) || 0);
      const statbotics = statboticsByTeam.get(row.teamNumber) || null;
      const statboticsEpa = Number(statbotics?.epa || 0);
      const effectiveEpa = statboticsEpa > 0 ? statboticsEpa : epaRaw;
      const epaScore = maxEpa > 0 ? clamp((effectiveEpa / maxEpa) * 100, 0, 100) : 0;

      const reportStats = reportByTeam.get(row.teamNumber) || {
        autoFuelAvg: 0,
        teleFuelAvg: 0,
        endgamePointsAvg: 0,
        count: 0
      };
      const reportScore = clamp(
        reportStats.autoFuelAvg * 4 + reportStats.teleFuelAvg * 2.5 + reportStats.endgamePointsAvg * 2,
        0,
        100
      );

      const capability = (
        auto * 0.13 +
        teleop * 0.23 +
        defense * 0.10 +
        cycle * 0.14 +
        reliability * 0.12 +
        endgame * 0.10 +
        rpScore * 0.06 +
        rankScore * 0.04 +
        epaScore * 0.08
      );

      const durability = clamp(
        reliability - disableRate * 65 - foulRate * 10 + Math.min(12, matches * 0.9),
        0,
        100
      );

      const defaultFit = (defense * 0.35 + endgame * 0.35 + cycle * 0.3);
      const ourTeleop = our ? Number(our.spiderTeleop || 0) : 60;
      const ourDefense = our ? Number(our.spiderDefense || 0) : 60;
      const needDefense = clamp((65 - ourDefense) / 65, 0, 1);
      const needScoring = clamp((80 - ourTeleop) / 80, 0, 1);
      const fit = clamp(
        defaultFit * 0.45 +
          (defense * needDefense * 0.20) +
          ((teleop + cycle) / 2 * needScoring * 0.20) +
          (clamp(climbSuccess * 100, 0, 100) * 0.15),
        0,
        100
      );

      const pickScore = capability * 0.42 + durability * 0.22 + fit * 0.20 + reportScore * 0.16;

      const valueMap = [
        { label: 'Elite teleop scoring', value: teleop },
        { label: 'Fast cycle pace', value: cycle },
        { label: 'Defense anchor', value: defense },
        { label: 'Reliable execution', value: reliability },
        { label: 'Endgame impact', value: endgame },
        { label: 'High EPA ceiling', value: epaScore },
        { label: 'Top event rank', value: rankScore },
        { label: 'Recent fuel output', value: reportScore }
      ];
      valueMap.sort((a, b) => b.value - a.value);
      const strongestValue = valueMap[0]?.label || 'Balanced profile';

      const tags = [];
      if (teleop >= 75 && cycle >= 70) tags.push('high-cycle offense');
      if (defense >= 70) tags.push('strong defender');
      if (endgame >= 65) tags.push('reliable climb/endgame');
      if (rank > 0 && rank <= 8) tags.push('top event rank');
      if (epaScore >= 80) tags.push('high EPA');
      if (disableRate >= 0.2) tags.push('risk: disable rate');
      if (foulRate >= 1) tags.push('risk: foul heavy');
      if (matches < 3) tags.push('low sample size');

      return {
        teamNumber: row.teamNumber,
        matchesScouted: matches,
        capabilityScore: Number(capability.toFixed(2)),
        durabilityScore: Number(durability.toFixed(2)),
        fitScore: Number(fit.toFixed(2)),
        pickScore: Number(pickScore.toFixed(2)),
        strongestValue,
        spiderAuto: auto,
        spiderTeleop: teleop,
        spiderDefense: defense,
        spiderCycleSpeed: cycle,
        spiderReliability: reliability,
        spiderEndgame: endgame,
        rank,
        rankingPoints,
        epa: Number(epaRaw.toFixed(2)),
        statboticsEPA: Number(statboticsEpa.toFixed(2)),
        statboticsAutoEPA: Number((statbotics?.autoEPA || 0).toFixed(2)),
        statboticsTeleopEPA: Number((statbotics?.teleopEPA || 0).toFixed(2)),
        statboticsEndgameEPA: Number((statbotics?.endgameEPA || 0).toFixed(2)),
        reportFuelScore: Number(reportScore.toFixed(2)),
        disableRate,
        foulRate,
        tags
      };
    })
    .sort((a, b) => b.pickScore - a.pickScore || b.capabilityScore - a.capabilityScore || a.teamNumber - b.teamNumber)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return scored;
}

router.get('/stats/:eventKey', async (req, res) => {
  let data = await prisma.teamAggregatedStat.findMany({
    where: { eventKey: req.params.eventKey },
    orderBy: [{ spiderReliability: 'desc' }, { teamNumber: 'asc' }]
  });

  if (!data.length) {
    await recomputeExternalTeamStats(req.params.eventKey);
    data = await prisma.teamAggregatedStat.findMany({
      where: { eventKey: req.params.eventKey },
      orderBy: [{ spiderReliability: 'desc' }, { teamNumber: 'asc' }]
    });
  }

  const teams = data.map((row) => row.teamNumber);
  const statboticsByTeam = await fetchStatboticsByTeams(teams);

  const enriched = data.map((row) => {
    const sb = statboticsByTeam.get(row.teamNumber);
    return {
      ...row,
      statbotics: sb
        ? {
            epa: Number(sb.epa.toFixed(2)),
            autoEPA: Number(sb.autoEPA.toFixed(2)),
            teleopEPA: Number(sb.teleopEPA.toFixed(2)),
            endgameEPA: Number(sb.endgameEPA.toFixed(2)),
            normEPA: Number(sb.normEPA.toFixed(2)),
            rank: sb.rank,
            wins: sb.wins,
            losses: sb.losses,
            ties: sb.ties,
            percentile: Number(sb.percentile.toFixed(2))
          }
        : null
    };
  });

  res.json(enriched);
});

router.get('/stats/:eventKey/:teamNumber', async (req, res) => {
  const eventKey = req.params.eventKey;
  const teamNumber = Number(req.params.teamNumber);

  const stat = await prisma.teamAggregatedStat.findUnique({
    where: { eventKey_teamNumber: { eventKey, teamNumber } }
  });

  const recent = await prisma.matchScoutingReport.findMany({
    where: { eventKey, teamNumber },
    orderBy: { createdAt: 'desc' },
    take: 8
  });

  const statbotics = await fetchStatboticsTeamYear(teamNumber);

  res.json({
    stat,
    recent,
    statbotics: statbotics
      ? {
          epa: Number(statbotics.epa.toFixed(2)),
          autoEPA: Number(statbotics.autoEPA.toFixed(2)),
          teleopEPA: Number(statbotics.teleopEPA.toFixed(2)),
          endgameEPA: Number(statbotics.endgameEPA.toFixed(2)),
          normEPA: Number(statbotics.normEPA.toFixed(2)),
          rank: statbotics.rank,
          wins: statbotics.wins,
          losses: statbotics.losses,
          ties: statbotics.ties,
          percentile: Number(statbotics.percentile.toFixed(2))
        }
      : null
  });
});

router.get('/statbotics/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  const rows = await prisma.teamAggregatedStat.findMany({
    where: { eventKey },
    select: { teamNumber: true }
  });

  const teams = rows.map((row) => row.teamNumber);
  const statboticsByTeam = await fetchStatboticsByTeams(teams);

  const data = teams.map((teamNumber) => {
    const sb = statboticsByTeam.get(teamNumber);
    return {
      teamNumber,
      statbotics: sb
        ? {
            epa: Number(sb.epa.toFixed(2)),
            autoEPA: Number(sb.autoEPA.toFixed(2)),
            teleopEPA: Number(sb.teleopEPA.toFixed(2)),
            endgameEPA: Number(sb.endgameEPA.toFixed(2)),
            normEPA: Number(sb.normEPA.toFixed(2)),
            rank: sb.rank,
            wins: sb.wins,
            losses: sb.losses,
            ties: sb.ties,
            percentile: Number(sb.percentile.toFixed(2))
          }
        : null
    };
  });

  res.json({ eventKey, count: data.length, teams: data });
});

router.get('/robot-status/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  const rows = await prisma.matchScoutingReport.findMany({ where: { eventKey } });

  const byTeam = new Map();
  for (const row of rows) {
    if (!byTeam.has(row.teamNumber)) {
      byTeam.set(row.teamNumber, {
        teamNumber: row.teamNumber,
        reports: 0,
        disabled: 0,
        tipped: 0,
        fouls: 0,
        lastEndgame: 'none'
      });
    }

    const t = byTeam.get(row.teamNumber);
    t.reports += 1;
    if (row.robotDisabled) t.disabled += 1;
    if (row.robotTipped) t.tipped += 1;
    t.fouls += row.foulsCommitted || 0;
    if (row.endgameResult) t.lastEndgame = row.endgameResult;
  }

  const status = [...byTeam.values()].map((row) => ({
    ...row,
    disableRate: row.reports ? row.disabled / row.reports : 0,
    tipRate: row.reports ? row.tipped / row.reports : 0,
    avgFouls: row.reports ? row.fouls / row.reports : 0
  })).sort((a, b) => a.teamNumber - b.teamNumber);

  res.json(status);
});

router.get('/predict/:eventKey/:matchKey', async (req, res) => {
  try {
    const team3749Ready = String(req.query.team3749Ready ?? 'true').toLowerCase() !== 'false';
    const result = await predictMatch(req.params.eventKey, req.params.matchKey, { team3749Ready });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/schedule/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  const forceTbaRefresh = String(req.query.refreshTba || '').toLowerCase() === 'true';
  await maybeRefreshScheduleFromTba(eventKey, forceTbaRefresh);

  const teamFilter = Number.parseInt(String(req.query.team || ''), 10);

  const where = Number.isFinite(teamFilter)
    ? {
        eventKey,
        OR: [
          { redTeam1: teamFilter },
          { redTeam2: teamFilter },
          { redTeam3: teamFilter },
          { blueTeam1: teamFilter },
          { blueTeam2: teamFilter },
          { blueTeam3: teamFilter }
        ]
      }
    : { eventKey };

  const rows = await prisma.match.findMany({
    where,
    orderBy: [{ compLevel: 'asc' }, { setNumber: 'asc' }, { matchNumber: 'asc' }]
  });

  const reportProgressRows = await prisma.matchScoutingReport.findMany({
    where: { eventKey, matchNumber: { not: null } },
    select: { compLevel: true, matchNumber: true }
  });

  const scoutedMatchKeys = new Set(
    reportProgressRows
      .map((row) => `${String(row.compLevel || '').toLowerCase()}:${Number(row.matchNumber || 0)}`)
      .filter((key) => !key.endsWith(':0'))
  );

  const latestReportedQual = reportProgressRows.reduce((max, row) => {
    if (String(row.compLevel || '').toLowerCase() !== 'qm') return max;
    const value = Number(row.matchNumber || 0);
    return value > max ? value : max;
  }, 0);

  const schedule = rows.map((row) => {
    const contains3749 = [row.redTeam1, row.redTeam2, row.redTeam3, row.blueTeam1, row.blueTeam2, row.blueTeam3].includes(3749);
    const alliance3749 = [row.redTeam1, row.redTeam2, row.redTeam3].includes(3749)
      ? 'red'
      : [row.blueTeam1, row.blueTeam2, row.blueTeam3].includes(3749)
        ? 'blue'
        : null;

    const redScore = Number(row.redScore);
    const blueScore = Number(row.blueScore);
    const scoreCompleted = Number.isFinite(redScore) && Number.isFinite(blueScore) && redScore >= 0 && blueScore >= 0;
    const reportCompleted = scoutedMatchKeys.has(`${String(row.compLevel || '').toLowerCase()}:${Number(row.matchNumber || 0)}`);

    return {
      matchKey: row.matchKey,
      compLevel: row.compLevel,
      setNumber: row.setNumber,
      matchNumber: row.matchNumber,
      redTeams: [row.redTeam1, row.redTeam2, row.redTeam3].filter(Boolean),
      blueTeams: [row.blueTeam1, row.blueTeam2, row.blueTeam3].filter(Boolean),
      redScore: row.redScore,
      blueScore: row.blueScore,
      status: scoreCompleted || reportCompleted ? 'completed' : 'scheduled',
      statusSource: scoreCompleted ? 'score' : reportCompleted ? 'scouting_reports' : 'schedule',
      contains3749,
      alliance3749,
      predictedTime: row.predictedTime,
      latestReportedQual
    };
  });

  res.json(schedule);
});

router.get('/leaderboard/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  const ourTeam = Number.parseInt(String(req.query.ourTeam || '3749'), 10) || 3749;
  const limit = Math.max(1, Math.min(50, Number.parseInt(String(req.query.limit || '15'), 10) || 15));

  let rows = await prisma.teamAggregatedStat.findMany({
    where: { eventKey }
  });

  if (!rows.length) {
    await recomputeExternalTeamStats(eventKey);
    rows = await prisma.teamAggregatedStat.findMany({
      where: { eventKey }
    });
  }

  const [rankRows, externalRows, reportRows, statboticsByTeam] = await Promise.all([
    prisma.ranking.findMany({ where: { eventKey } }),
    prisma.externalScoutImport.findMany({
      where: { eventKey, teamNumber: { not: null } },
      select: { teamNumber: true, epaScore: true }
    }),
    prisma.matchScoutingReport.findMany({
      where: { eventKey },
      select: { teamNumber: true, autoFuelAuto: true, teleopFuelScored: true, endgameTowerPoints: true }
    }),
    fetchStatboticsByTeams(rows.map((row) => row.teamNumber))
  ]);

  const rankingByTeam = new Map(rankRows.map((row) => [row.teamNumber, row]));

  const epaByTeam = new Map();
  const epaCountByTeam = new Map();
  for (const row of externalRows) {
    const teamNumber = Number(row.teamNumber);
    const epa = Number(row.epaScore);
    if (!teamNumber || !Number.isFinite(epa)) continue;
    epaByTeam.set(teamNumber, (epaByTeam.get(teamNumber) || 0) + epa);
    epaCountByTeam.set(teamNumber, (epaCountByTeam.get(teamNumber) || 0) + 1);
  }
  for (const [teamNumber, total] of epaByTeam.entries()) {
    const count = epaCountByTeam.get(teamNumber) || 1;
    epaByTeam.set(teamNumber, total / count);
  }

  const reportByTeam = new Map();
  for (const row of reportRows) {
    const teamNumber = Number(row.teamNumber);
    if (!teamNumber) continue;
    if (!reportByTeam.has(teamNumber)) {
      reportByTeam.set(teamNumber, {
        autoFuelAvg: 0,
        teleFuelAvg: 0,
        endgamePointsAvg: 0,
        count: 0
      });
    }

    const agg = reportByTeam.get(teamNumber);
    agg.count += 1;
    agg.autoFuelAvg += Number(row.autoFuelAuto || 0);
    agg.teleFuelAvg += Number(row.teleopFuelScored || 0);
    agg.endgamePointsAvg += Number(row.endgameTowerPoints || 0);
  }
  for (const agg of reportByTeam.values()) {
    const denom = Math.max(1, agg.count);
    agg.autoFuelAvg /= denom;
    agg.teleFuelAvg /= denom;
    agg.endgamePointsAvg /= denom;
  }

  const ranked = computePickLeaderboard(rows, ourTeam, {
    rankingByTeam,
    epaByTeam,
    reportByTeam,
    statboticsByTeam
  });
  res.json({
    eventKey,
    ourTeam,
    count: ranked.length,
    leaderboard: ranked.slice(0, limit)
  });
});

router.post('/brick-ai/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  const question = String(req.body?.question || '').trim();
  const selectedTeam = Number.parseInt(String(req.body?.teamNumber || ''), 10);

  if (!question) {
    res.status(400).json({ error: 'Question is required.' });
    return;
  }

  const explicitMentionedTeams = [
    ...new Set(
      (question.match(/\b\d{3,5}\b/g) || [])
        .map((entry) => Number.parseInt(entry, 10))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  ];

  const mentionedTeams = [...explicitMentionedTeams];
  if (Number.isFinite(selectedTeam) && selectedTeam > 0 && !mentionedTeams.includes(selectedTeam)) mentionedTeams.push(selectedTeam);

  const [eventStatsRows, globalStatsRows] = await Promise.all([
    prisma.teamAggregatedStat.findMany({
      where: { eventKey },
      orderBy: [{ spiderReliability: 'desc' }, { teamNumber: 'asc' }],
      take: 60
    }),
    prisma.teamAggregatedStat.findMany({
      orderBy: [{ matchesScouted: 'desc' }, { spiderReliability: 'desc' }, { teamNumber: 'asc' }],
      take: 260
    })
  ]);

  const preferredByTeam = new Map();
  for (const row of globalStatsRows) {
    if (!preferredByTeam.has(row.teamNumber)) preferredByTeam.set(row.teamNumber, row);
  }
  for (const row of eventStatsRows) {
    preferredByTeam.set(row.teamNumber, row);
  }

  if (mentionedTeams.length) {
    const missingMentioned = mentionedTeams.filter((teamNumber) => !preferredByTeam.has(teamNumber));
    if (missingMentioned.length) {
      const mentionedRows = await prisma.teamAggregatedStat.findMany({
        where: { teamNumber: { in: missingMentioned } },
        orderBy: [{ matchesScouted: 'desc' }, { spiderReliability: 'desc' }],
        take: Math.max(15, missingMentioned.length * 2)
      });
      for (const row of mentionedRows) {
        if (!preferredByTeam.has(row.teamNumber)) preferredByTeam.set(row.teamNumber, row);
      }
    }
  }

  const statsRows = [...preferredByTeam.values()];
  const baseTeams = explicitMentionedTeams.length
    ? mentionedTeams
    : statsRows.slice(0, 30).map((row) => row.teamNumber);

  const statusRows = await prisma.matchScoutingReport.findMany({
    where: baseTeams.length
      ? { teamNumber: { in: baseTeams } }
      : undefined,
    orderBy: { createdAt: 'desc' },
    take: 320,
    select: {
      eventKey: true,
      teamNumber: true,
      robotDisabled: true,
      robotTipped: true,
      foulsCommitted: true,
      endgameResult: true,
      generalNotes: true,
      createdAt: true
    }
  });

  const statusByTeam = new Map();
  for (const row of statusRows) {
    if (!statusByTeam.has(row.teamNumber)) {
      statusByTeam.set(row.teamNumber, {
        reports: 0,
        disabled: 0,
        tipped: 0,
        fouls: 0,
        latestNotes: [],
        events: new Set()
      });
    }

    const status = statusByTeam.get(row.teamNumber);
    status.reports += 1;
    if (row.robotDisabled) status.disabled += 1;
    if (row.robotTipped) status.tipped += 1;
    status.fouls += Number(row.foulsCommitted || 0);
    if (row.eventKey) status.events.add(row.eventKey);
    if (row.generalNotes && status.latestNotes.length < 3) {
      status.latestNotes.push(String(row.generalNotes).slice(0, 180));
    }
  }

  const teamsToInclude = explicitMentionedTeams.length
    ? statsRows.filter((row) => mentionedTeams.includes(row.teamNumber))
    : (() => {
        const top = statsRows.slice(0, 18);
        if (!Number.isFinite(selectedTeam) || selectedTeam <= 0) return top;
        if (top.some((row) => row.teamNumber === selectedTeam)) return top;
        const selectedRow = statsRows.find((row) => row.teamNumber === selectedTeam);
        return selectedRow ? [selectedRow, ...top.slice(0, 17)] : top;
      })();

  const context = teamsToInclude.map((row) => {
    const status = statusByTeam.get(row.teamNumber) || {
      reports: 0,
      disabled: 0,
      tipped: 0,
      fouls: 0,
      latestNotes: [],
      events: new Set()
    };

    const reports = Math.max(1, status.reports);
    return {
      teamNumber: row.teamNumber,
      spiderAuto: Number(row.spiderAuto || 0),
      spiderTeleop: Number(row.spiderTeleop || 0),
      spiderDefense: Number(row.spiderDefense || 0),
      spiderCycleSpeed: Number(row.spiderCycleSpeed || 0),
      spiderReliability: Number(row.spiderReliability || 0),
      spiderEndgame: Number(row.spiderEndgame || 0),
      matchesScouted: Number(row.matchesScouted || 0),
      sourceEventKey: row.eventKey,
      observedEvents: [...status.events].slice(0, 8),
      disableRate: Number((status.disabled / reports).toFixed(3)),
      tipRate: Number((status.tipped / reports).toFixed(3)),
      avgFouls: Number((status.fouls / reports).toFixed(3)),
      notes: status.latestNotes
    };
  });

  const fallbackBrickAnswer = () => {
    if (!context.length) {
      return [
        `No scouting context found yet for ${eventKey}.`,
        'Import match scouting or aggregator stats, then ask again.',
        'You can still ask by team number once data exists in the database.'
      ].join('\n');
    }

    const byReliability = [...context].sort((a, b) => b.spiderReliability - a.spiderReliability);
    const byTeleop = [...context].sort((a, b) => b.spiderTeleop - a.spiderTeleop);
    const byDefense = [...context].sort((a, b) => b.spiderDefense - a.spiderDefense);
    const focusTeams = explicitMentionedTeams.length
      ? context.filter((entry) => mentionedTeams.includes(entry.teamNumber)).map((entry) => entry.teamNumber)
      : byTeleop.slice(0, 3).map((entry) => entry.teamNumber);

    return [
      'Brick AI is running in fallback mode (LLM runtime unavailable), using database scouting only.',
      `Question: ${question}`,
      `Focus teams: ${focusTeams.length ? focusTeams.join(', ') : 'none identified'}`,
      `Top teleop: ${byTeleop.slice(0, 3).map((entry) => `${entry.teamNumber} (${entry.spiderTeleop.toFixed(1)})`).join(' | ')}`,
      `Top defense: ${byDefense.slice(0, 3).map((entry) => `${entry.teamNumber} (${entry.spiderDefense.toFixed(1)})`).join(' | ')}`,
      `Most reliable: ${byReliability.slice(0, 3).map((entry) => `${entry.teamNumber} (${entry.spiderReliability.toFixed(1)})`).join(' | ')}`,
      'Callouts: prioritize denying highest teleop team cycle lanes; avoid foul-heavy contact against high reliability teams.'
    ].join('\n');
  };

  try {
    const answer = await callSmolLM(
      'You are Brick AI, an FRC scouting assistant for Team 3749. Answer using ONLY provided context. Be concise, tactical, and specific. If context is missing, say what is missing. Avoid markdown tables. Use short bullets. Return plain text only (never JSON, never braces).',
      JSON.stringify({
        eventKey,
        dataScope: 'all-available-with-event-priority',
        question,
        mentionedTeams,
        context
      }),
      false
    );

    let normalizedAnswer = String(answer || '').trim();
    if (!normalizedAnswer || normalizedAnswer === '{}' || normalizedAnswer === '[]') {
      const compactContext = context.slice(0, 10).map((entry) => ({
        team: entry.teamNumber,
        teleop: entry.spiderTeleop,
        defense: entry.spiderDefense,
        reliability: entry.spiderReliability,
        avgFouls: entry.avgFouls,
        disableRate: entry.disableRate,
        notes: (entry.notes || []).slice(0, 2)
      }));

      const retryAnswer = await callSmolLM(
        'You are Brick AI. Return plain text only: 2-4 tactical bullet points, no JSON, no braces.',
        `Question: ${question}\nEvent: ${eventKey}\nTeams: ${JSON.stringify(compactContext)}`,
        false
      );

      normalizedAnswer = String(retryAnswer || '').trim();
    }

    if (!normalizedAnswer || normalizedAnswer === '{}' || normalizedAnswer === '[]') {
      res.json({
        eventKey,
        answer: fallbackBrickAnswer(),
        teamsUsed: context.map((entry) => entry.teamNumber),
        degraded: true,
        dataScope: 'all-available-with-event-priority',
        warning: 'Model returned empty or invalid tactical output'
      });
      return;
    }

    res.json({
      eventKey,
      answer: normalizedAnswer,
      teamsUsed: context.map((entry) => entry.teamNumber),
      degraded: false,
      dataScope: 'all-available-with-event-priority'
    });
  } catch (error) {
    res.json({
      eventKey,
      answer: fallbackBrickAnswer(),
      teamsUsed: context.map((entry) => entry.teamNumber),
      degraded: true,
      dataScope: 'all-available-with-event-priority',
      warning: error?.message || 'Brick AI model runtime unavailable'
    });
  }
});

export default router;
