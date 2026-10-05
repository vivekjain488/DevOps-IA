const https = require('https');
const http = require('http');

// Posts still in flight, so a process can deliver its last events (e.g. job_started before a crash) before exiting.
const pending = new Set();

function postToHec({ event, token, index, sourcetype, source, time }) {
  const endpoint = process.env.SPLUNK_HEC_URL;
  if (!endpoint || !token) return Promise.resolve(false);
  const url = new URL(endpoint);
  // An explicit epoch time keeps millisecond ordering; without it Splunk stamps events to the second on arrival.
  const payload = JSON.stringify({ ...(Number.isFinite(time) ? { time } : {}), event, index, sourcetype, source });
  const transport = url.protocol === 'https:' ? https : http;
  const options = {
    hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: `${url.pathname}${url.search}`,
    method: 'POST', headers: { Authorization: `Splunk ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 5000
  };
  if (url.protocol === 'https:' && process.env.SPLUNK_HEC_INSECURE_TLS === 'true') options.rejectUnauthorized = false;
  const sent = new Promise(resolve => {
    const request = transport.request(options, response => { response.resume(); resolve(response.statusCode >= 200 && response.statusCode < 300); });
    request.on('error', () => resolve(false)); request.on('timeout', () => request.destroy()); request.write(payload); request.end();
  });
  pending.add(sent); sent.finally(() => pending.delete(sent));
  return sent;
}
// Resolves once every in-flight post has settled, or after timeoutMs so an unreachable Splunk cannot block an exit.
function flushHec(timeoutMs = 3000) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); timer.unref(); });
  return Promise.race([Promise.allSettled([...pending]), timeout]).finally(() => clearTimeout(timer));
}
module.exports = { postToHec, flushHec };
