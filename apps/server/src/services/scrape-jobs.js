import { randomUUID } from 'crypto';

const JOB_TTL_MS = 10 * 60 * 1000;
const jobs = new Map();

function sanitizeJob(job) {
  return {
    id: job.id,
    kind: job.kind,
    eventKey: job.eventKey,
    status: job.status,
    stage: job.stage,
    message: job.message,
    totalRows: job.totalRows,
    processedRows: job.processedRows,
    importedRows: job.importedRows,
    aggregatedTeams: job.aggregatedTeams,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error || null
  };
}

function scheduleCleanup(jobId) {
  setTimeout(() => {
    jobs.delete(jobId);
  }, JOB_TTL_MS).unref?.();
}

export function createScrapeJob({ kind, eventKey }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const job = {
    id,
    kind,
    eventKey,
    status: 'running',
    stage: 'initializing',
    message: 'Starting scrape job...',
    totalRows: 0,
    processedRows: 0,
    importedRows: 0,
    aggregatedTeams: 0,
    startedAt: now,
    finishedAt: null,
    error: null
  };

  jobs.set(id, job);
  return sanitizeJob(job);
}

export function updateScrapeJob(jobId, patch = {}) {
  const existing = jobs.get(jobId);
  if (!existing) return null;

  const next = {
    ...existing,
    ...patch
  };

  jobs.set(jobId, next);
  return sanitizeJob(next);
}

export function finishScrapeJob(jobId, patch = {}) {
  const result = updateScrapeJob(jobId, {
    status: 'completed',
    finishedAt: new Date().toISOString(),
    ...patch
  });

  scheduleCleanup(jobId);
  return result;
}

export function failScrapeJob(jobId, error) {
  const result = updateScrapeJob(jobId, {
    status: 'failed',
    finishedAt: new Date().toISOString(),
    error: error?.message || String(error || 'Unknown scrape error')
  });

  scheduleCleanup(jobId);
  return result;
}

export function getScrapeJob(jobId) {
  const job = jobs.get(jobId);
  return job ? sanitizeJob(job) : null;
}
