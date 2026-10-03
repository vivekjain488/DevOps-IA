const express = require('express');
const helmet = require('helmet');
const path = require('path');
const requestContext = require('./middleware/requestContext');
const errorHandler = require('./middleware/errorHandler');
const jobRoutes = require('./routes/jobs');
const { queueUpload } = require('./routes/jobs');
const jobs = require('./jobs');
const { uploadDirectory } = require('./db');
const { getDashboardData, getLogs } = require('./splunk');

// Demo jobs give controlled Splunk evidence: an intentional failure, a slow job that builds a queue, and a worker crash that Docker restarts.
const DEMO_CSV = 'name,roll_no,attendance\nAditi,16010123020,Present\nRahul,16010123021,\nAditi,16010123020,Present\n';
const DEMOS = { 'fail-job': ['fail', 'demo-fail.csv', 'Intentional failure queued'], 'slow-job': ['slow', 'demo-slow.csv', 'Slow job queued'], 'crash-worker': ['crash', 'demo-crash.csv', 'Worker crash queued'] };

function createApp(db, { uploadDir = uploadDirectory() } = {}) {
  const app = express(); app.disable('x-powered-by'); app.use(requestContext); app.use(helmet()); app.use(express.json({ limit: '50kb' }));
  app.get('/api/health', (req, res) => {
    try {
      const queued = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status='QUEUED'").get().count;
      res.json({ success: true, data: { status: 'ok', service: 'docuflow-api', version: process.env.APP_VERSION || '1.0.0', timestamp: new Date().toISOString(), database: 'connected',
        worker: jobs.workerStatus(db), queuedJobs: queued, demoMode: process.env.DEMO_MODE === 'true' }, requestId: req.requestId });
    } catch (_) { res.status(503).json({ success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable.' }, data: { status: 'degraded' }, requestId: req.requestId }); }
  });
  // Classify the failure so the dashboard can say what to fix; secrets and raw Splunk responses are never echoed.
  const splunkUnavailable = (error, next) => {
    const reason = error.code === 'SPLUNK_NOT_CONFIGURED' ? ['SPLUNK_NOT_CONFIGURED', 'Splunk REST access is not configured. Set SPLUNK_REST_URL and SPLUNK_REST_TOKEN on the server.']
      : error.status === 401 || error.status === 403 ? ['SPLUNK_AUTH_FAILED', `Splunk rejected the REST token (HTTP ${error.status}). Create a new token in Splunk and update SPLUNK_REST_TOKEN.`]
        : ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(error.code) ? ['SPLUNK_UNREACHABLE', 'Splunk could not be reached at SPLUNK_REST_URL. Check that Splunk is running and the port (usually 8089) is correct.']
          : /timed out/i.test(error.message || '') ? ['SPLUNK_TIMEOUT', 'Splunk did not answer in time. Try a shorter time range or retry shortly.']
            : ['SPLUNK_UNAVAILABLE', 'Observability data is temporarily unavailable.'];
    error.status = 503; error.code = reason[0]; error.publicMessage = reason[1]; next(error);
  };
  const queryText = value => typeof value === 'string' && value.trim() ? value.trim() : undefined;
  app.get('/api/observability/summary', async (req, res, next) => { try { const data = await getDashboardData(queryText(req.query.range)); res.locals.logMessage = 'Observability dashboard data served'; res.json({ success: true, data, requestId: req.requestId }); } catch (error) { splunkUnavailable(error, next); } });
  app.get('/api/observability/logs', async (req, res, next) => {
    const params = { range: queryText(req.query.range), level: queryText(req.query.level), status: queryText(req.query.status), q: queryText(req.query.q), path: queryText(req.query.path), service: queryText(req.query.service), limit: queryText(req.query.limit) };
    try {
      const data = await getLogs(params);
      if (data.errors) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid log filter parameters.', details: data.errors }, requestId: req.requestId });
      res.locals.logMessage = 'Observability log search served'; res.json({ success: true, data, requestId: req.requestId });
    } catch (error) { splunkUnavailable(error, next); }
  });
  app.use('/api/jobs', jobRoutes(db, uploadDir));
  app.post('/api/demo/:kind', async (req, res, next) => {
    const demo = DEMOS[req.params.kind];
    if (process.env.DEMO_MODE !== 'true' || !demo) return next();
    try {
      const job = await queueUpload(db, uploadDir, { fileName: demo[1], fileType: 'csv', buffer: Buffer.from(DEMO_CSV), demo: demo[0], requestId: req.requestId });
      res.locals.logMessage = demo[2]; res.status(201).json({ success: true, data: jobs.toResponse(job), requestId: req.requestId });
    } catch (error) { next(error); }
  });
  app.use('/api', (req, res) => res.status(404).json({ success: false, error: { code: 'ROUTE_NOT_FOUND', message: 'Requested resource was not found.' }, requestId: req.requestId }));
  const frontendDirectory = process.env.NODE_ENV === 'production' ? path.join(__dirname, 'public') : path.join(__dirname, '../client/dist');
  app.use(express.static(frontendDirectory)); app.get('*', (req, res) => res.sendFile(path.join(frontendDirectory, 'index.html')));
  app.use(errorHandler); return app;
}
module.exports = createApp;
