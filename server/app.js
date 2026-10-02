const express = require('express');
const helmet = require('helmet');
const path = require('path');
const requestContext = require('./middleware/requestContext');
const errorHandler = require('./middleware/errorHandler');
const eventRoutes = require('./routes/events');
function createApp(db) {
  const app = express(); app.disable('x-powered-by'); app.use(requestContext); app.use(helmet()); app.use(express.json({ limit: '50kb' }));
  app.get('/api/health', (req, res) => { try { db.prepare('SELECT 1').get(); res.json({ success: true, data: { status: 'ok', service: 'eventpulse', version: process.env.APP_VERSION || '1.0.0', timestamp: new Date().toISOString(), database: 'connected' }, requestId: req.requestId }); } catch (_) { res.status(503).json({ success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable.' }, data: { status: 'degraded' }, requestId: req.requestId }); } });
  app.use('/api/events', eventRoutes(db));
  app.get('/api/demo/slow', async (req, res, next) => { if (process.env.DEMO_MODE !== 'true') return next(); await new Promise(resolve => setTimeout(resolve, 3000)); res.locals.logMessage = 'Controlled slow request completed'; res.json({ success: true, data: { simulatedDelayMs: 3000 }, requestId: req.requestId }); });
  app.get('/api/demo/error', (req, res, next) => { if (process.env.DEMO_MODE !== 'true') return next(); const error = new Error('DEMO_CONTROLLED_ERROR'); error.code = 'DEMO_CONTROLLED_ERROR'; error.publicMessage = 'Controlled demonstration error'; next(error); });
  app.use('/api', (req, res) => res.status(404).json({ success: false, error: { code: 'ROUTE_NOT_FOUND', message: 'Requested resource was not found.' }, requestId: req.requestId }));
  const frontendDirectory = process.env.NODE_ENV === 'production' ? path.join(__dirname, 'public') : path.join(__dirname, '../client/dist');
  app.use(express.static(frontendDirectory)); app.get('*', (req, res) => res.sendFile(path.join(frontendDirectory, 'index.html')));
  app.use(errorHandler); return app;
}
module.exports = createApp;
