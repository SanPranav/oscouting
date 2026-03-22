import { Router } from 'express';
import { prisma } from '@3749/db/src/client.js';
import { predictMatch } from '@3749/prediction/src/predict-match.js';
import { recomputeExternalTeamStats } from '../stats.js';

const router = Router();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function computePickLeaderboard(statsRows, ourTeam, context) {
  const byTeam = new Map(statsRows.map((row) => [row.teamNumber, row]));
  const our = byTeam.get(ourTeam) || null;
  const rankingByTeam = context?.rankingByTeam || new Map();
  const epaByTeam = context?.epaByTeam || new Map();
  const reportByTeam = context?.reportByTeam || new Map();

  const allEpaValues = [...epaByTeam.values()].filter((value) => Number.isFinite(value));
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
      const epaScore = maxEpa > 0 ? clamp((epaRaw / maxEpa) * 100, 0, 100) : 0;

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

  res.json(data);
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

  res.json({ stat, recent });
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
    const result = await predictMatch(req.params.eventKey, req.params.matchKey);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/schedule/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
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
    where: { eventKey, compLevel: 'qm', matchNumber: { not: null } },
    select: { matchNumber: true }
  });

  const latestReportedQual = reportProgressRows.reduce((max, row) => {
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

    const scoreCompleted = row.redScore !== null || row.blueScore !== null;
    const reportCompleted = row.compLevel === 'qm' && latestReportedQual > 0 && row.matchNumber <= latestReportedQual;

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

  const [rankRows, externalRows, reportRows] = await Promise.all([
    prisma.ranking.findMany({ where: { eventKey } }),
    prisma.externalScoutImport.findMany({
      where: { eventKey, teamNumber: { not: null } },
      select: { teamNumber: true, epaScore: true }
    }),
    prisma.matchScoutingReport.findMany({
      where: { eventKey },
      select: { teamNumber: true, autoFuelAuto: true, teleopFuelScored: true, endgameTowerPoints: true }
    })
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
    reportByTeam
  });
  res.json({
    eventKey,
    ourTeam,
    count: ranked.length,
    leaderboard: ranked.slice(0, limit)
  });
});

export default router;
