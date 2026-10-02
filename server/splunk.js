const https = require('https');
const http = require('http');

function executeSearch(search) {
  const baseUrl = process.env.SPLUNK_REST_URL;
  const token = process.env.SPLUNK_REST_TOKEN;
  if (!baseUrl || !token) return Promise.reject(Object.assign(new Error('Splunk REST API is not configured.'), { code: 'SPLUNK_NOT_CONFIGURED' }));
  const base = new URL(baseUrl);
  const payload = new URLSearchParams({ search, output_mode: 'json', preview: 'false' }).toString();
  const transport = base.protocol === 'https:' ? https : http;
  const options = { hostname: base.hostname, port: base.port || (base.protocol === 'https:' ? 443 : 80), path: '/services/search/v2/jobs/export', method: 'POST', timeout: 10000,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) } };
  if (base.protocol === 'https:' && process.env.SPLUNK_REST_INSECURE_TLS === 'true') options.rejectUnauthorized = false;
  return new Promise((resolve, reject) => {
    const request = transport.request(options, response => { let raw = ''; response.setEncoding('utf8'); response.on('data', part => { raw += part; }); response.on('end', () => {
      if (response.statusCode < 200 || response.statusCode >= 300) return reject(Object.assign(new Error('Splunk search request failed.'), { status: response.statusCode }));
      try {
        const entries = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        const completed = entries.filter(entry => entry.preview === false && entry.result);
        resolve((completed.length ? completed : entries.filter(entry => entry.result)).map(entry => entry.result));
      } catch (_) { reject(new Error('Splunk returned an unreadable search response.')); }
    }); });
    request.on('error', reject); request.on('timeout', () => request.destroy(new Error('Splunk search request timed out.'))); request.write(payload); request.end();
  });
}

const searches = {
  summary: 'search index=container_logs earliest=-24h | spath | stats count AS requests count(eval(status>=400)) AS errors count(eval(status>=500)) AS serverErrors count(eval(duration_ms>1000)) AS slowRequests avg(duration_ms) AS averageDurationMs perc95(duration_ms) AS p95DurationMs | eval averageDurationMs=round(averageDurationMs,2), p95DurationMs=round(p95DurationMs,2)',
  routes: 'search index=container_logs earliest=-24h | spath | where isnotnull(status) | stats count AS requests count(eval(status>=400)) AS errors avg(duration_ms) AS averageDurationMs BY path | eval averageDurationMs=round(averageDurationMs,2) | sort - requests | head 8',
  timeline: 'search index=container_logs earliest=-24h | spath | where isnotnull(status) | timechart span=5m count AS requests count(eval(status>=400)) AS errors',
  metrics: 'search index=container_metrics earliest=-24h | spath | where metric_type="application_process_stats" | stats latest(cpu_percent) AS cpuPercent latest(memory_rss_mb) AS memoryRssMb latest(heap_used_mb) AS heapUsedMb latest(uptime_seconds) AS uptimeSeconds'
};
async function getDashboardData() {
  const [summaryRows, routes, timeline, metricRows] = await Promise.all(Object.values(searches).map(executeSearch));
  return { summary: summaryRows[0] || {}, routes, timeline, metrics: metricRows[0] || {}, generatedAt: new Date().toISOString() };
}
module.exports = { executeSearch, getDashboardData };
