const https = require('https');
const http = require('http');

// Share the search limit across summary and log requests to respect Splunk quotas.
let activeSearches = 0;
const searchWaiters = [];
async function executeSearch(search) {
  if (activeSearches >= 3) await new Promise(resolve => searchWaiters.push(resolve));
  else activeSearches += 1;
  try { return await performSearch(search); }
  finally {
    const next = searchWaiters.shift();
    if (next) next();
    else activeSearches -= 1;
  }
}

function performSearch(search) {
  const baseUrl = process.env.SPLUNK_REST_URL;
  const token = process.env.SPLUNK_REST_TOKEN;
  if (!baseUrl || !token) return Promise.reject(Object.assign(new Error('Splunk REST API is not configured.'), { code: 'SPLUNK_NOT_CONFIGURED' }));
  const base = new URL(baseUrl);
  const payload = new URLSearchParams({ search, output_mode: 'json', preview: 'false' }).toString();
  const transport = base.protocol === 'https:' ? https : http;
  const options = { hostname: base.hostname, port: base.port || (base.protocol === 'https:' ? 443 : 80), path: '/services/search/v2/jobs/export', method: 'POST', timeout: 30000,
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

// Time ranges are an allow-list so user input never reaches SPL directly.
const RANGES = { '1h': { earliest: '-1h', previous: '-2h', span: '1m' }, '6h': { earliest: '-6h', previous: '-12h', span: '5m' }, '24h': { earliest: '-24h', previous: '-48h', span: '30m' }, '7d': { earliest: '-7d', previous: '-14d', span: '4h' } };
const resolveRange = range => RANGES[range] ? range : '24h';

// HEC JSON can surface fields twice (indexed + spath), so collapse each to a single value.
const normalise = fields => `spath | foreach ${fields} [ eval <<FIELD>>=mvindex(<<FIELD>>,0) ]`;
const REQUEST_FIELDS = 'status duration_ms level msg method path request_id';
const JOB_FIELDS = 'event job_id job_status file_type demo failure_reason failure_stage processing_duration_ms queue_time_ms file_name';
// Sourcetype and raw-term filters let Splunk skip unrelated events before the costly spath step.
const LOGS = 'index=container_logs sourcetype="docuflow:application"';
// Request latency for the API itself; the observability endpoints only proxy Splunk searches, so their time is Splunk's.
const requests = earliest => `search ${LOGS} earliest=${earliest} duration_ms NOT observability | ${normalise(REQUEST_FIELDS)} | where isnotnull(status) AND isnotnull(duration_ms) AND NOT like(path,"/api/observability%")`;
const jobEvents = earliest => `search ${LOGS} earliest=${earliest} (upload_received OR upload_rejected OR job_queued OR job_started OR job_completed OR job_failed) | ${normalise(JOB_FIELDS)} | where isnotnull(event)`;
const METRIC_FIELDS = 'metric_type service container_name container_status restart_count online_cpus cpu_percent memory_percent memory_usage_mb memory_rss_mb network_rx_rate_bytes_per_second network_tx_rate_bytes_per_second uptime_seconds';
const SOURCETYPES = { container_stats: 'docuflow:container_metrics', application_process_stats: 'docuflow:application_metrics' };
// Container CPU is trusted only from samples that carry online_cpus: earlier agent versions derived CPU from Docker's
// precpu_stats, which is empty after a restart and produced impossible values (over 100% x cores).
const metrics = (earliest, type) => `search index=container_metrics sourcetype="${SOURCETYPES[type]}" earliest=${earliest} | ${normalise(METRIC_FIELDS)} | where metric_type="${type}"`
  + (type === 'container_stats' ? ' | eval cpu_percent=if(isnull(online_cpus),null(),cpu_percent)' : '');
// Processing time is measured on completed jobs; queue time once per job, when the worker starts it.
const JOB_STATS = 'count(eval(event="upload_received")) AS uploads count(eval(event="job_queued")) AS queued count(eval(event="job_completed")) AS completed count(eval(event="job_failed")) AS failed '
  + 'avg(eval(if(event="job_completed",processing_duration_ms,null()))) AS avgProcessingMs perc95(eval(if(event="job_completed",processing_duration_ms,null()))) AS p95ProcessingMs '
  + 'avg(eval(if(event="job_started",queue_time_ms,null()))) AS avgQueueMs perc95(eval(if(event="job_started",queue_time_ms,null()))) AS p95QueueMs';
const roundMs = '| foreach *Ms [ eval <<FIELD>>=round(<<FIELD>>,2) ]';
// Container names include "worker" for the worker; everything else monitored is the API.
const roleTimeline = (nameField, cpu, memory, span) => `eval role=if(like(${nameField},"%worker%"),"worker","api") | timechart span=${span} `
  + `avg(eval(if(role="api",${cpu},null()))) AS apiCpu avg(eval(if(role="worker",${cpu},null()))) AS workerCpu avg(eval(if(role="api",${memory},null()))) AS apiMemoryMb avg(eval(if(role="worker",${memory},null()))) AS workerMemoryMb`;

function dashboardSearches(range) {
  const { earliest, previous, span } = RANGES[resolveRange(range)];
  return {
    summary: `${jobEvents(earliest)} | stats ${JOB_STATS} ${roundMs}`,
    previous: `${jobEvents(`${previous} latest=${earliest}`)} | stats ${JOB_STATS} ${roundMs}`,
    timeline: `${jobEvents(earliest)} | timechart span=${span} ${JOB_STATS} ${roundMs}`,
    // Counted from lifecycle events rather than per job_id, because job IDs restart at JOB-1001 when the data volume is reset.
    // Queued = queued but not started; processing = started but not finished; failed includes uploads rejected by the API.
    statuses: `${jobEvents(earliest)} | stats count(eval(event="job_queued")) AS queued count(eval(event="job_started")) AS started count(eval(event="job_completed")) AS COMPLETED count(eval(event="job_failed")) AS FAILED count(eval(event="job_failed" AND failure_stage="processing")) AS failedInWorker `
      + '| eval QUEUED=max(0,queued-started), PROCESSING=max(0,started-COMPLETED-failedInWorker) | fields QUEUED PROCESSING COMPLETED FAILED | transpose column_name=job_status | rename "row 1" AS count | where count>0',
    failures: `${jobEvents(earliest)} | where event="job_failed" | stats count latest(failure_stage) AS stage BY failure_reason | sort - count | head 8`,
    fileTypes: `${jobEvents(earliest)} | where event="upload_received" OR (event="job_queued" AND isnotnull(demo)) | stats count BY file_type | sort - count`,
    slowest: `${jobEvents(earliest)} | where event="job_completed" | sort - processing_duration_ms | head 6 | eval timestamp=strftime(_time,"%Y-%m-%dT%H:%M:%S.%3QZ") | table timestamp job_id file_name file_type processing_duration_ms queue_time_ms`,
    api: `${requests(earliest)} | stats count AS requests count(eval(status>=400 AND status<500)) AS clientErrors count(eval(status>=500)) AS serverErrors avg(duration_ms) AS averageDurationMs perc95(duration_ms) AS p95DurationMs ${roundMs}`,
    containers: `${metrics(earliest, 'container_stats')} | stats latest(container_status) AS status latest(restart_count) AS restarts latest(cpu_percent) AS cpuPercent latest(memory_percent) AS memoryPercent latest(memory_usage_mb) AS memoryUsageMb latest(network_rx_rate_bytes_per_second) AS rxBytesPerSecond latest(network_tx_rate_bytes_per_second) AS txBytesPerSecond latest(_time) AS lastSeen BY container_name | eval lastSeen=strftime(lastSeen,"%Y-%m-%dT%H:%M:%SZ")`,
    // Same role split as CPU/memory, plus restart count (max, so a restart is never averaged away) and combined network throughput.
    containerTimeline: `${metrics(earliest, 'container_stats')} | eval netBytes=network_rx_rate_bytes_per_second+network_tx_rate_bytes_per_second | ${roleTimeline('container_name', 'cpu_percent', 'memory_usage_mb', span)} `
      + 'max(eval(if(role="api",restart_count,null()))) AS apiRestarts max(eval(if(role="worker",restart_count,null()))) AS workerRestarts '
      + 'avg(eval(if(role="api",netBytes,null()))) AS apiNetBytes avg(eval(if(role="worker",netBytes,null()))) AS workerNetBytes',
    apiTimeline: `${requests(earliest)} | timechart span=${span} count AS requests avg(duration_ms) AS averageDurationMs perc95(duration_ms) AS p95DurationMs ${roundMs}`,
    recentFailures: `${jobEvents(earliest)} | where event="job_failed" | sort - _time | head 20 | eval timestamp=strftime(_time,"%Y-%m-%dT%H:%M:%S.%3QZ") | table timestamp job_id file_name failure_stage failure_reason`,
    processTimeline: `${metrics(earliest, 'application_process_stats')} | ${roleTimeline('service', 'cpu_percent', 'memory_rss_mb', span)}`
  };
}

// Core panels must succeed; supporting panels degrade to empty so one slow search never blanks the dashboard.
const CORE = ['summary', 'timeline'];
// Several open dashboards or a quick auto-refresh share one in-flight result per range instead of queueing 13 more searches each.
const CACHE_MS = 15000;
const dashboardCache = new Map();
function getDashboardData(range = '24h') {
  const selected = resolveRange(range), cached = dashboardCache.get(selected);
  if (cached && (cached.pending || Date.now() - cached.at < CACHE_MS)) return cached.promise;
  const entry = { pending: true, at: 0 };
  entry.promise = loadDashboardData(selected).then(data => { entry.pending = false; entry.at = Date.now(); return data; }, error => { dashboardCache.delete(selected); throw error; });
  dashboardCache.set(selected, entry);
  return entry.promise;
}
async function loadDashboardData(range) {
  const selected = range, searches = dashboardSearches(selected), keys = Object.keys(searches);
  const settled = await Promise.allSettled(keys.map(key => executeSearch(searches[key])));
  const results = {}, unavailable = [];
  settled.forEach((outcome, index) => {
    const key = keys[index];
    if (outcome.status === 'fulfilled') results[key] = outcome.value;
    else { if (CORE.includes(key)) throw outcome.reason; results[key] = []; unavailable.push(key); }
  });
  // Docker stats are preferred; process stats cover a local run without containers.
  const resources = results.containerTimeline.length ? { source: 'containers', timeline: results.containerTimeline } : { source: 'processes', timeline: results.processTimeline };
  return { range: selected, summary: results.summary[0] || {}, previous: results.previous[0] || {}, timeline: results.timeline, statuses: results.statuses, failures: results.failures,
    fileTypes: results.fileTypes, slowest: results.slowest, recentFailures: results.recentFailures, api: results.api[0] || {}, apiTimeline: results.apiTimeline, containers: results.containers, resources, unavailable, generatedAt: new Date().toISOString() };
}

const LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];
const STATUS_CLASSES = { '2xx': [200, 300], '3xx': [300, 400], '4xx': [400, 500], '5xx': [500, 600] };
const SAFE_TEXT = /^[\w\s\-./:@]{1,80}$/;
const LOG_FIELDS = 'level msg service event job_id job_status failure_reason method path status duration_ms request_id error_code errorType errorMessage';
const SERVICES = ['docuflow-api', 'docuflow-worker'];
const EMAIL = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/g;
const mask = value => typeof value === 'string' ? value.replace(EMAIL, '[redacted-email]') : value;

// Every filter is validated against an allow-list or a strict pattern before it is placed in SPL.
function buildLogQuery({ range, level, status, q, path, service, limit } = {}) {
  const { earliest, span } = RANGES[resolveRange(range)];
  const errors = [];
  if (level && !LEVELS.includes(level)) errors.push('level');
  if (status && !STATUS_CLASSES[status]) errors.push('status');
  if (q && !SAFE_TEXT.test(q)) errors.push('q');
  if (path && !SAFE_TEXT.test(path)) errors.push('path');
  if (service && !SERVICES.includes(service)) errors.push('service');
  const size = limit === undefined ? 200 : Number(limit);
  if (!Number.isInteger(size) || size < 1 || size > 500) errors.push('limit');
  if (errors.length) return { errors };
  const terms = (q || '').trim().split(/\s+/).filter(Boolean).map(term => `"${term}"`).join(' ');
  const filters = [];
  if (level) filters.push(`level="${level}"`);
  if (status) filters.push(`status>=${STATUS_CLASSES[status][0]} AND status<${STATUS_CLASSES[status][1]}`);
  if (path) filters.push(`like(path,"${path.trim()}%")`);
  if (service) filters.push(`service="${service}"`);
  const base = `search index=container_logs sourcetype="docuflow:application" earliest=${earliest}${terms ? ` ${terms}` : ''} | spath | rename err.type AS errorType err.message AS errorMessage | ${normalise(LOG_FIELDS)}${filters.length ? ` | where ${filters.join(' AND ')}` : ''}`;
  return {
    errors,
    events: `${base} | sort - _time | head ${size} | eval timestamp=strftime(_time,"%Y-%m-%dT%H:%M:%S.%3QZ") | table timestamp level msg service event job_id job_status failure_reason method path status duration_ms request_id error_code errorType errorMessage`,
    levels: `${base} | eval level=coalesce(level,"unknown") | stats count BY level`,
    histogram: `${base} | eval level=coalesce(level,"unknown") | timechart span=${span} count BY level`,
    total: `${base} | stats count AS total`
  };
}

async function getLogs(params) {
  const query = buildLogQuery(params);
  if (query.errors.length) return { errors: query.errors };
  const [events, levels, histogram, total] = await Promise.all([query.events, query.levels, query.histogram, query.total].map(executeSearch));
  return { range: resolveRange(params.range), total: Number(total[0]?.total || 0),
    events: events.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, mask(value)]))),
    levels, histogram, generatedAt: new Date().toISOString() };
}

module.exports = { executeSearch, getDashboardData, clearDashboardCache: () => dashboardCache.clear(), getLogs, buildLogQuery, dashboardSearches, RANGES };
