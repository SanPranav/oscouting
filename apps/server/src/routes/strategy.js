import { Router } from 'express';
import { prisma } from '@3749/db/src/client.js';
import { predictMatch } from '@3749/prediction/src/predict-match.js';
import { recomputeExternalTeamStats } from '../stats.js';

const router = Router();

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

export default router;
