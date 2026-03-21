import 'dotenv/config';
import { scrapeAndImport } from '@3749/scraper/src/scrape-2485.js';

const eventKey = process.argv[2] || process.env.EVENT_KEY;
scrapeAndImport(eventKey)
  .then((rows) => {
    console.log(`[scrape] imported ${rows.length} rows${eventKey ? ` for ${eventKey}` : ' (global mode)'}`);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
