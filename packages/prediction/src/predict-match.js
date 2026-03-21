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
    matchKey: match.matchKey || normalizedKey,
    redPredicted,
    bluePredicted,
    confidence: redStats.length + blueStats.length >= 4 ? 'medium' : 'low',
    narrative
  };
}
