process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'docuflow-worker';
const os = require('os');
const { createDb, uploadDirectory } = require('./db'); const logger = require('./logger'); const { startProcessMetrics } = require('./metrics'); const { createWorker } = require('./workerLoop'); const { flushHec } = require('./hec');
// The container hostname survives a restart, so the worker can recover the jobs it was processing when it stopped.
const db = createDb(); const worker = createWorker({ db, uploadDir: uploadDirectory(), logger, workerId: process.env.WORKER_ID || os.hostname(), pollMs: Number(process.env.WORKER_POLL_MS) || 1000, slowJobMs: Number(process.env.DEMO_SLOW_JOB_MS) || 8000 });
const stopMetrics = startProcessMetrics();
worker.start().catch(error => { logger.fatal({ event: 'worker_start_failed', err: error }, 'Worker could not start'); flushHec().then(() => process.exit(1)); });
let closing = false; const shutdown = signal => { if (closing) return; closing = true; stopMetrics(); logger.info({ signal }, 'Graceful shutdown started'); const timer = setTimeout(() => process.exit(1), 20000); worker.stop().then(flushHec).then(() => { db.close(); clearTimeout(timer); process.exit(0); }); }; process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
