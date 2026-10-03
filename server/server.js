const { createDb } = require('./db'); const createApp = require('./app'); const logger = require('./logger'); const { startProcessMetrics } = require('./metrics');
const db = createDb(); const server = createApp(db).listen(process.env.PORT || 3000, () => logger.info({ port: process.env.PORT || 3000 }, 'DocuFlow API started'));
const stopMetrics = startProcessMetrics();
let closing = false; const shutdown = signal => { if (closing) return; closing = true; stopMetrics(); logger.info({ signal }, 'Graceful shutdown started'); const timer = setTimeout(() => process.exit(1), 10000); server.close(() => { db.close(); clearTimeout(timer); process.exit(0); }); }; process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
