import 'dotenv/config';
import { syncTbaEvent } from '@3749/tba/src/sync.js';

const eventKey = process.argv[2] || process.env.EVENT_KEY;
if (!eventKey) {
  console.error('Usage: node scripts/sync-tba.js <event_key>');
  process.exit(1);
}

syncTbaEvent(eventKey)
  .then((result) => {
    console.log(`[sync-tba] synced ${result.eventKey} teams=${result.teams} matches=${result.matches}`);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
