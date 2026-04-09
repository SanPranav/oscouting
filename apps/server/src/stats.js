import { prisma } from '@3749/db/src/client.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export async function recomputeTeamStats(eventKey, teamNumber) {
  const reports = await prisma.matchScoutingReport.findMany({
    where: { eventKey, teamNumber }
  });

  if (!reports.length) return null;

  const matchesScouted = reports.length;
  const avg = (mapper) => reports.reduce((sum, row) => sum + mapper(row), 0) / matchesScouted;

  const autoAvg = avg((r) => r.autoFuelAuto || 0);
  const teleAvg = avg((r) => r.teleopFuelScored || 0);
  const endAvg = avg((r) => r.endgameTowerPoints || 0);
  const disableRate = avg((r) => (r.robotDisabled ? 1 : 0));
  const foulRate = avg((r) => r.foulsCommitted || 0);
  const defenseAvg = avg((r) => r.teleopDefenseRating || 0);
  const speedAvg = avg((r) => r.teleopSpeedRating || 0);
  const climbAttempt = avg((r) => (r.endgameAttemptedClimb ? 1 : 0));
  const climbSuccess = avg((r) => (['level1', 'level2', 'level3'].includes(r.endgameResult || '') ? 1 : 0));

  return prisma.teamAggregatedStat.upsert({
    where: { eventKey_teamNumber: { eventKey, teamNumber } },
    update: {
      matchesScouted,
      avgAutoTotalPoints: autoAvg,
      avgTeleopTotalPoints: teleAvg,
      avgEndgamePoints: endAvg,
      climbAttemptRate: climbAttempt,
      climbSuccessRate: climbSuccess,
      disableRate,
      foulRate,
      spiderAuto: Math.max(0, autoAvg * 5),
      spiderTeleop: Math.max(0, teleAvg * 3),
      spiderDefense: clamp((defenseAvg / 5) * 100, 0, 100),
      spiderCycleSpeed: clamp((speedAvg / 5) * 100, 0, 100),
      spiderReliability: clamp(((1 - disableRate) * 0.7 + (1 - clamp(foulRate / 3, 0, 1)) * 0.3) * 100, 0, 100),
      spiderEndgame: Math.max(0, (climbSuccess * 0.6 + clamp(endAvg / 30, 0, 1) * 0.4) * 100),
      lastComputed: new Date()
    },
    create: {
      eventKey,
      teamNumber,
      matchesScouted,
      avgAutoTotalPoints: autoAvg,
      avgTeleopTotalPoints: teleAvg,
      avgEndgamePoints: endAvg,
      climbAttemptRate: climbAttempt,
      climbSuccessRate: climbSuccess,
      disableRate,
      foulRate,
      spiderAuto: Math.max(0, autoAvg * 5),
      spiderTeleop: Math.max(0, teleAvg * 3),
      spiderDefense: clamp((defenseAvg / 5) * 100, 0, 100),
      spiderCycleSpeed: clamp((speedAvg / 5) * 100, 0, 100),
      spiderReliability: clamp(((1 - disableRate) * 0.7 + (1 - clamp(foulRate / 3, 0, 1)) * 0.3) * 100, 0, 100),
      spiderEndgame: Math.max(0, (climbSuccess * 0.6 + clamp(endAvg / 30, 0, 1) * 0.4) * 100),
      lastComputed: new Date()
    }
  });
}

export async function recomputeExternalTeamStats(eventKey) {
  const externalRows = await prisma.externalScoutImport.findMany({
    where: { eventKey }
  });

  if (!externalRows.length) return 0;

  const byTeam = new Map();
  for (const row of externalRows) {
    const teamNumber = Number(row.teamNumber);
    if (!teamNumber) continue;

    if (!byTeam.has(teamNumber)) byTeam.set(teamNumber, []);
    byTeam.get(teamNumber).push(row);
  }

  let updated = 0;
  for (const [teamNumber, rows] of byTeam.entries()) {
    const matchesScouted = rows.length;
    const avg = (mapper) => rows.reduce((sum, row) => sum + mapper(row), 0) / matchesScouted;

    const autoAvg = avg((r) => r.autoFuel || 0);
    const teleAvg = avg((r) => r.teleFuel || 0);
    const defenseAvg = avg((r) => r.defenseRating || 0);
    const foulRate = avg((r) => r.fouls || 0);
    const disableRate = avg((r) => (r.noShow ? 1 : 0));

    await prisma.teamAggregatedStat.upsert({
      where: { eventKey_teamNumber: { eventKey, teamNumber } },
      update: {
        matchesScouted,
        avgAutoTotalPoints: autoAvg,
        avgTeleopTotalPoints: teleAvg,
        avgEndgamePoints: 0,
        climbAttemptRate: 0,
        climbSuccessRate: 0,
        disableRate,
        foulRate,
        spiderAuto: clamp(autoAvg * 5, 0, 100),
        spiderTeleop: clamp(teleAvg * 3, 0, 100),
        spiderDefense: clamp((defenseAvg / 5) * 100, 0, 100),
        spiderCycleSpeed: clamp(50 + (teleAvg / 4), 0, 100),
        spiderReliability: clamp(((1 - disableRate) * 0.7 + (1 - clamp(foulRate / 3, 0, 1)) * 0.3) * 100, 0, 100),
        spiderEndgame: 0,
        lastComputed: new Date()
      },
      create: {
        eventKey,
        teamNumber,
        matchesScouted,
        avgAutoTotalPoints: autoAvg,
        avgTeleopTotalPoints: teleAvg,
        avgEndgamePoints: 0,
        climbAttemptRate: 0,
        climbSuccessRate: 0,
        disableRate,
        foulRate,
        spiderAuto: clamp(autoAvg * 5, 0, 100),
        spiderTeleop: clamp(teleAvg * 3, 0, 100),
        spiderDefense: clamp((defenseAvg / 5) * 100, 0, 100),
        spiderCycleSpeed: clamp(50 + (teleAvg / 4), 0, 100),
        spiderReliability: clamp(((1 - disableRate) * 0.7 + (1 - clamp(foulRate / 3, 0, 1)) * 0.3) * 100, 0, 100),
        spiderEndgame: 0,
        lastComputed: new Date()
      }
    });

    updated += 1;
  }

  return updated;
}
