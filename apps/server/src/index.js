import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import express from 'express';
import cors from 'cors';
import scoutingRoutes from './routes/scouting.js';
import strategyRoutes from './routes/strategy.js';
import importRoutes from './routes/import.js';
import { syncTbaEvent } from '@3749/tba/src/sync.js';
import { scrapeAndImport } from '@3749/scraper/src/scrape-2485.js';
import { recomputeExternalTeamStats } from './stats.js';
import {
  createScrapeJob,
  failScrapeJob,
  finishScrapeJob,
  getScrapeJob,
  updateScrapeJob
} from './services/scrape-jobs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config();

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
    const data = await scrapeAndImport(req.params.eventKey, { returnRows: false });
    const aggregatedTeams = await recomputeExternalTeamStats(req.params.eventKey);
    res.json({ count: data.importedCount, aggregatedTeams });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/sync/scrape-all', async (_req, res) => {
  try {
    const data = await scrapeAndImport(undefined, { returnRows: false });
    const eventKey = '2485_all';
    const aggregatedTeams = await recomputeExternalTeamStats(eventKey);
    res.json({ count: data.importedCount, eventKey, aggregatedTeams });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/sync/scrape/:eventKey/job', async (req, res) => {
  const eventKey = req.params.eventKey;
  const job = createScrapeJob({ kind: 'event', eventKey });

  void (async () => {
    try {
      const imported = await scrapeAndImport(eventKey, {
        returnRows: false,
        onProgress: (progress) => {
          updateScrapeJob(job.id, {
            stage: progress.phase || 'importing',
            message: progress.message || 'Scraping 2485...',
            totalRows: Number(progress.totalRows || 0),
            processedRows: Number(progress.processedRows || 0),
            importedRows: Number(progress.importedRows || 0)
          });
        }
      });

      updateScrapeJob(job.id, {
        stage: 'aggregating',
        message: 'Recomputing aggregated team stats...'
      });

      const aggregatedTeams = await recomputeExternalTeamStats(eventKey);
      finishScrapeJob(job.id, {
        stage: 'done',
        message: `Imported ${imported.importedCount} rows`,
        totalRows: Math.max(imported.totalRows || imported.importedCount, getScrapeJob(job.id)?.totalRows || 0),
        processedRows: getScrapeJob(job.id)?.processedRows || imported.totalRows || imported.importedCount,
        importedRows: imported.importedCount,
        aggregatedTeams
      });
    } catch (error) {
      failScrapeJob(job.id, error);
    }
  })();

  res.status(202).json({ jobId: job.id, status: job.status, eventKey: job.eventKey });
});

app.post('/api/sync/scrape-all/job', async (_req, res) => {
  const eventKey = '2485_all';
  const job = createScrapeJob({ kind: 'global', eventKey });

  void (async () => {
    try {
      const imported = await scrapeAndImport(undefined, {
        returnRows: false,
        onProgress: (progress) => {
          updateScrapeJob(job.id, {
            stage: progress.phase || 'importing',
            message: progress.message || 'Scraping all 2485 rows...',
            totalRows: Number(progress.totalRows || 0),
            processedRows: Number(progress.processedRows || 0),
            importedRows: Number(progress.importedRows || 0)
          });
        }
      });

      updateScrapeJob(job.id, {
        stage: 'aggregating',
        message: 'Recomputing aggregated team stats...'
      });

      const aggregatedTeams = await recomputeExternalTeamStats(eventKey);
      finishScrapeJob(job.id, {
        stage: 'done',
        message: `Global scrape imported ${imported.importedCount} rows`,
        totalRows: Math.max(imported.totalRows || imported.importedCount, getScrapeJob(job.id)?.totalRows || 0),
        processedRows: getScrapeJob(job.id)?.processedRows || imported.totalRows || imported.importedCount,
        importedRows: imported.importedCount,
        aggregatedTeams
      });
    } catch (error) {
      failScrapeJob(job.id, error);
    }
  })();

  res.status(202).json({ jobId: job.id, status: job.status, eventKey: job.eventKey });
});

app.get('/api/sync/scrape/job/:jobId', (req, res) => {
  const job = getScrapeJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Scrape job not found' });
    return;
  }

  res.json(job);
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
