const path = require('path');
require('dotenv').config({ path: process.env.ENV_FILE || path.resolve(__dirname, '../.env') });
const pino = require('pino');
const { postToHec } = require('./hec');

const stream = {
  write(line) {
    process.stdout.write(line);
    if (process.env.NODE_ENV === 'test' || !process.env.SPLUNK_HEC_TOKEN) return;
    try {
      const event = JSON.parse(line);
      void postToHec({ event, token: process.env.SPLUNK_HEC_TOKEN, index: 'container_logs', sourcetype: 'eventpulse:application', source: 'eventpulse' });
    } catch (_) { /* Logging must never interrupt a request. */ }
  }
};
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'eventpulse', version: process.env.APP_VERSION || '1.0.0' },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: { level: label => ({ level: label }) }
}, stream);
module.exports = logger;
