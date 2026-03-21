import 'dotenv/config';
import fs from 'node:fs/promises';

const eventKey = process.argv[2] || process.env.EVENT_KEY || '2026casnd';
const csvPath = process.argv[3];

if (!csvPath) {
  console.error('Usage: node scripts/import-csv.js <event_key> <csv_file_path>');
  process.exit(1);
}

const csvText = await fs.readFile(csvPath, 'utf8');
const response = await fetch(`http://localhost:${process.env.PORT || 2540}/api/import/csv`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ eventKey, csvText })
});

const data = await response.json();
if (!response.ok) {
  console.error(data.error || 'Import failed');
  process.exit(1);
}

console.log(`[import-csv] imported=${data.imported} errors=${data.errors.length}`);
if (data.errors.length) {
  console.log(data.errors.slice(0, 10));
}
