const path = require('path');
require('dotenv').config({ path: process.env.ENV_FILE || path.resolve(__dirname, '../.env') });
const os = require('os');
const pino = require('pino');
const { postToHec } = require('./hec');

// The API and the worker share this logger; SERVICE_NAME tells their events apart in Splunk.
const SERVICE = process.env.SERVICE_NAME || 'docuflow-api';
const stream = {
  write(line) {
    process.stdout.write(line);
    if (process.env.NODE_ENV === 'test' || !process.env.SPLUNK_HEC_TOKEN) return;
    try {
      const event = JSON.parse(line);
      void postToHec({ event, time: Date.parse(event.timestamp) / 1000, token: process.env.SPLUNK_HEC_TOKEN, index: 'container_logs', sourcetype: 'docuflow:application', source: SERVICE });
    } catch (_) { /* Logging must never interrupt a request. */ }
  }
};
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: SERVICE, host: os.hostname(), version: process.env.APP_VERSION || '1.0.0' },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: { level: label => ({ level: label }) }
}, stream);
module.exports = logger;
