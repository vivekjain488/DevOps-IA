const logger = require('../logger');
module.exports = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500, code = err.code || 'INTERNAL_SERVER_ERROR';
  logger.error({ err, request_id: req.requestId, method: req.method, path: req.logPath, status, error_code: code }, 'Unhandled request error');
  res.locals.logMessage = err.publicMessage || 'Request failed';
  res.status(status).json({ success: false, error: { code, message: err.publicMessage || 'An unexpected server error occurred.' }, requestId: req.requestId });
};
