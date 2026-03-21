import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@3749/db/src/client.js';

const args = process.argv.slice(2);
const eventFlagIndex = args.indexOf('--event');
const eventKey = eventFlagIndex >= 0 ? args[eventFlagIndex + 1] : process.env.EVENT_KEY;

if (!eventKey) {
  console.error('Usage: node scripts/export-csv.js --event <event_key>');
  process.exit(1);
}

const rows = await prisma.teamAggregatedStat.findMany({
  where: { eventKey },
  orderBy: { teamNumber: 'asc' }
});

const headers = [
  'team_number','matches_scouted','spider_auto','spider_teleop','spider_defense','spider_cycle_speed','spider_reliability','spider_endgame'
];

const lines = [headers.join(',')];
for (const row of rows) {
  lines.push([
    row.teamNumber,
    row.matchesScouted,
    row.spiderAuto ?? 0,
    row.spiderTeleop ?? 0,
    row.spiderDefense ?? 0,
    row.spiderCycleSpeed ?? 0,
    row.spiderReliability ?? 0,
    row.spiderEndgame ?? 0
  ].join(','));
}

const outDir = path.resolve('exports');
await fs.mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `${eventKey}-team-stats.csv`);
await fs.writeFile(outPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`[export-csv] wrote ${outPath}`);
