import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import scoutingRoutes from './routes/scouting.js';
import strategyRoutes from './routes/strategy.js';
import importRoutes from './routes/import.js';
import { syncTbaEvent } from '@3749/tba/src/sync.js';
import { scrapeAndImport } from '@3749/scraper/src/scrape-2485.js';
import { recomputeExternalTeamStats } from './stats.js';

const app = express();
const PORT = Number(process.env.PORT || 2540);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'team3749-server' });
});

app.use('/api/scouting', scoutingRoutes);
app.use('/api/strategy', strategyRoutes);
app.use('/api/import', importRoutes);

app.post('/api/sync/tba/:eventKey', async (req, res) => {
  try {
    const data = await syncTbaEvent(req.params.eventKey);
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/sync/scrape/:eventKey', async (req, res) => {
  try {
    const data = await scrapeAndImport(req.params.eventKey);
    const aggregatedTeams = await recomputeExternalTeamStats(req.params.eventKey);
    res.json({ count: data.length, aggregatedTeams });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/sync/scrape-all', async (_req, res) => {
  try {
    const data = await scrapeAndImport();
    const eventKey = '2485_all';
    const aggregatedTeams = await recomputeExternalTeamStats(eventKey);
    res.json({ count: data.length, eventKey, aggregatedTeams });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[server] running on http://localhost:${PORT}`);
});

const shutdown = (signal) => {
  console.log(`[server] received ${signal}, shutting down...`);
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`[server] port ${PORT} is already in use.`);
    console.error(`[server] stop the old process with: lsof -ti :${PORT} | xargs -r kill -9`);
    process.exit(1);
  }

  console.error('[server] startup error:', error.message);
  process.exit(1);
});
