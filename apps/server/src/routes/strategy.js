import { Router } from 'express';
import { prisma } from '@3749/db/src/client.js';
import { predictMatch } from '@3749/prediction/src/predict-match.js';
import { recomputeExternalTeamStats } from '../stats.js';

const router = Router();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function computePickLeaderboard(statsRows, ourTeam) {
  const byTeam = new Map(statsRows.map((row) => [row.teamNumber, row]));
  const our = byTeam.get(ourTeam) || null;

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

      const capability = (
        auto * 0.17 +
        teleop * 0.31 +
        defense * 0.12 +
        cycle * 0.18 +
        reliability * 0.14 +
        endgame * 0.08
      );

      const durability = clamp(
        reliability - disableRate * 60 - foulRate * 10 + Math.min(12, matches * 0.8),
        0,
        100
      );

      const defaultFit = (defense * 0.35 + endgame * 0.35 + cycle * 0.3);
      const ourTeleop = our ? Number(our.spiderTeleop || 0) : 60;
      const ourDefense = our ? Number(our.spiderDefense || 0) : 60;
      const needDefense = clamp((65 - ourDefense) / 65, 0, 1);
      const needScoring = clamp((80 - ourTeleop) / 80, 0, 1);
      const fit = clamp(
        defaultFit * 0.5 +
          (defense * needDefense * 0.25) +
          ((teleop + cycle) / 2 * needScoring * 0.25),
        0,
        100
      );

      const pickScore = capability * 0.5 + durability * 0.3 + fit * 0.2;

      const tags = [];
      if (teleop >= 75 && cycle >= 70) tags.push('high-cycle offense');
      if (defense >= 70) tags.push('strong defender');
      if (endgame >= 65) tags.push('reliable climb/endgame');
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
        spiderAuto: auto,
        spiderTeleop: teleop,
        spiderDefense: defense,
        spiderCycleSpeed: cycle,
        spiderReliability: reliability,
        spiderEndgame: endgame,
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

  const schedule = rows.map((row) => {
    const contains3749 = [row.redTeam1, row.redTeam2, row.redTeam3, row.blueTeam1, row.blueTeam2, row.blueTeam3].includes(3749);
    const alliance3749 = [row.redTeam1, row.redTeam2, row.redTeam3].includes(3749)
      ? 'red'
      : [row.blueTeam1, row.blueTeam2, row.blueTeam3].includes(3749)
        ? 'blue'
        : null;

    return {
      matchKey: row.matchKey,
      compLevel: row.compLevel,
      setNumber: row.setNumber,
      matchNumber: row.matchNumber,
      redTeams: [row.redTeam1, row.redTeam2, row.redTeam3].filter(Boolean),
      blueTeams: [row.blueTeam1, row.blueTeam2, row.blueTeam3].filter(Boolean),
      redScore: row.redScore,
      blueScore: row.blueScore,
      status: row.redScore !== null || row.blueScore !== null ? 'completed' : 'scheduled',
      contains3749,
      alliance3749,
      predictedTime: row.predictedTime
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

  const ranked = computePickLeaderboard(rows, ourTeam);
  res.json({
    eventKey,
    ourTeam,
    count: ranked.length,
    leaderboard: ranked.slice(0, limit)
  });
});

export default router;
