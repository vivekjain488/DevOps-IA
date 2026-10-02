const https = require('https');
const http = require('http');

function postToHec({ event, token, index, sourcetype, source }) {
  const endpoint = process.env.SPLUNK_HEC_URL;
  if (!endpoint || !token) return Promise.resolve(false);
  const url = new URL(endpoint);
  const payload = JSON.stringify({ event, index, sourcetype, source });
  const transport = url.protocol === 'https:' ? https : http;
  const options = {
    hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: `${url.pathname}${url.search}`,
    method: 'POST', headers: { Authorization: `Splunk ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 5000
  };
  if (url.protocol === 'https:' && process.env.SPLUNK_HEC_INSECURE_TLS === 'true') options.rejectUnauthorized = false;
  return new Promise(resolve => {
    const request = transport.request(options, response => { response.resume(); resolve(response.statusCode >= 200 && response.statusCode < 300); });
    request.on('error', () => resolve(false)); request.on('timeout', () => request.destroy()); request.write(payload); request.end();
  });
}
module.exports = { postToHec };
