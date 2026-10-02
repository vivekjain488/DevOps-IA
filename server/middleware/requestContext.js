const crypto = require('crypto');
const logger = require('../logger');
module.exports = (req, res, next) => {
  req.requestId = crypto.randomUUID(); req.startedAt = process.hrtime.bigint(); req.logPath = req.originalUrl.split('?')[0];
  res.setHeader('X-Request-Id', req.requestId);
  res.on('finish', () => {
    const duration_ms = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
    const status = res.statusCode, level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    logger[level]({ request_id: req.requestId, method: req.method, path: req.logPath, status, duration_ms: Number(duration_ms.toFixed(2)) }, res.locals.logMessage || 'Request completed');
  });
  next();
};
