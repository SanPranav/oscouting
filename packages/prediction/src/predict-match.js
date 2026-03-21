import { prisma } from '@3749/db/src/client.js';
import { callSmolLM } from '@3749/ai/src/lemonade-client.js';

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

export async function predictMatch(eventKey, matchKey) {
  const normalizedKey = String(matchKey || '').includes('_')
    ? String(matchKey || '')
    : `${eventKey}_qm${parseQualMatchNumber(matchKey) || ''}`;

  let match = await prisma.match.findUnique({ where: { matchKey: normalizedKey } });

  if (!match) {
    const qmNumber = parseQualMatchNumber(matchKey);
    if (Number.isFinite(qmNumber) && qmNumber > 0) {
      match = await prisma.match.findFirst({
        where: { eventKey, compLevel: 'qm', matchNumber: qmNumber }
      });

      if (!match) {
        match = await prisma.match.findFirst({
          where: { eventKey, matchNumber: qmNumber },
          orderBy: [{ compLevel: 'asc' }, { setNumber: 'asc' }]
        });
      }
    }
  }

  let redTeams = [];
  let blueTeams = [];

  if (match) {
    redTeams = [match.redTeam1, match.redTeam2, match.redTeam3].filter(Boolean);
    blueTeams = [match.blueTeam1, match.blueTeam2, match.blueTeam3].filter(Boolean);
  } else {
    const qmNumber = parseQualMatchNumber(matchKey);
    if (Number.isFinite(qmNumber) && qmNumber > 0) {
      const external = await prisma.externalScoutImport.findMany({
        where: { eventKey, matchNumber: qmNumber },
        orderBy: { teamNumber: 'asc' }
      });

      const knownTeams = [...new Set(external.map((row) => row.teamNumber).filter(Boolean))];
      redTeams = knownTeams.slice(0, 3);

      const topTeams = await prisma.teamAggregatedStat.findMany({
        where: { eventKey },
        orderBy: [{ spiderReliability: 'desc' }, { teamNumber: 'asc' }],
        take: 12
      });

      blueTeams = topTeams
        .map((row) => row.teamNumber)
        .filter((teamNumber) => !redTeams.includes(teamNumber))
        .slice(0, 3);
    }

    if (!redTeams.length && !blueTeams.length) {
      throw new Error(`Match not found: ${matchKey}. Import schedule in Aggregator (AI Import Paste) or sync TBA for ${eventKey}.`);
    }
  }

  const [redStats, blueStats] = await Promise.all([
    prisma.teamAggregatedStat.findMany({ where: { eventKey, teamNumber: { in: redTeams } } }),
    prisma.teamAggregatedStat.findMany({ where: { eventKey, teamNumber: { in: blueTeams } } })
  ]);

  const score = (rows) => rows.reduce((sum, row) => sum +
    ((row.avgAutoTotalPoints || 0) + (row.avgTeleopTotalPoints || 0) + (row.avgEndgamePoints || 0)) * (1 - (row.disableRate || 0)),
  0);

  const redPredicted = Number(score(redStats).toFixed(2));
  const bluePredicted = Number(score(blueStats).toFixed(2));

  let narrative = 'Prediction generated from available scouting data.';
  try {
    narrative = await callSmolLM(
      'You are a concise FRC strategy analyst. Return two short tactical sentences.',
      JSON.stringify({ matchKey, redPredicted, bluePredicted, redTeams, blueTeams }),
      false
    );
  } catch {
    if (redPredicted > bluePredicted) narrative = 'Red alliance projects ahead; focus on reducing their scoring cycles early.';
    if (bluePredicted > redPredicted) narrative = 'Blue alliance projects ahead; prioritize reliability and endgame conversion to close the gap.';
  }

  return {
    matchKey: match?.matchKey || normalizedKey,
    redPredicted,
    bluePredicted,
    confidence: match ? (redStats.length + blueStats.length >= 4 ? 'medium' : 'low') : 'very-low',
    narrative
  };
}
