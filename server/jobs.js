// Data access for processing jobs. Public IDs look like JOB-1042; the row ID is offset so the first job is JOB-1001.
const ID_OFFSET = 1000;
const STATUSES = ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'];
const HEARTBEAT_STALE_MS = 15000;

const publicId = id => `JOB-${id + ID_OFFSET}`;
function parseJobId(value) {
  const match = /^(?:JOB-)?(\d{1,12})$/i.exec(String(value || ''));
  const id = match ? Number(match[1]) - ID_OFFSET : 0;
  return id > 0 ? id : null;
}

function toResponse(row) {
  const result = row.result_json ? JSON.parse(row.result_json) : {};
  return {
    jobId: publicId(row.id), status: row.status, fileName: row.file_name, fileType: row.file_type, fileSizeBytes: row.file_size_bytes,
    ...result,
    queuedAt: row.queued_at, startedAt: row.started_at, completedAt: row.completed_at,
    queueTimeMs: row.queue_time_ms, processingDurationMs: row.processing_duration_ms,
    failureStage: row.failure_stage, failureReason: row.failure_reason, failureMessage: row.failure_message,
    demo: row.demo, worker: row.worker_id
  };
}

const round = value => Number(value.toFixed(2));
const getRow = (db, id) => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);

function createJob(db, { fileName, fileType, fileSizeBytes, storedPath, demo = null, requestId = null, now = new Date() }) {
  const info = db.prepare('INSERT INTO jobs (file_name,file_type,file_size_bytes,stored_path,status,demo,request_id,queued_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(fileName, fileType, fileSizeBytes, storedPath, 'QUEUED', demo, requestId, now.toISOString());
  return getRow(db, info.lastInsertRowid);
}

// Uploads rejected by the API still become FAILED jobs so failure reasons are visible in the job list and in Splunk.
function createRejectedJob(db, { fileName, fileType, fileSizeBytes, reason, message, requestId = null, now = new Date() }) {
  const at = now.toISOString();
  const info = db.prepare(`INSERT INTO jobs (file_name,file_type,file_size_bytes,status,failure_stage,failure_reason,failure_message,request_id,queued_at,completed_at)
    VALUES (?,?,?,'FAILED','validation',?,?,?,?,?)`).run(fileName, fileType, fileSizeBytes, reason, message, requestId, at, at);
  return getRow(db, info.lastInsertRowid);
}

// Claim the oldest queued job atomically, so several workers can never pick the same job.
function claimNextJob(db, workerId, now = new Date()) {
  return db.transaction(() => {
    const next = db.prepare("SELECT * FROM jobs WHERE status = 'QUEUED' ORDER BY id LIMIT 1").get();
    if (!next) return null;
    const queueTime = round(Math.max(0, now.getTime() - new Date(next.queued_at).getTime()));
    db.prepare("UPDATE jobs SET status='PROCESSING', started_at=?, worker_id=?, queue_time_ms=? WHERE id=? AND status='QUEUED'").run(now.toISOString(), workerId, queueTime, next.id);
    return getRow(db, next.id);
  }).immediate();
}

function completeJob(db, id, result, durationMs, now = new Date()) {
  db.prepare("UPDATE jobs SET status='COMPLETED', result_json=?, completed_at=?, processing_duration_ms=? WHERE id=?").run(JSON.stringify(result), now.toISOString(), round(durationMs), id);
  return getRow(db, id);
}
function failJob(db, id, { reason, message, stage = 'processing', durationMs = null }, now = new Date()) {
  db.prepare("UPDATE jobs SET status='FAILED', failure_stage=?, failure_reason=?, failure_message=?, completed_at=?, processing_duration_ms=? WHERE id=?")
    .run(stage, reason, message, now.toISOString(), durationMs === null ? null : round(durationMs), id);
  return getRow(db, id);
}

// A job left PROCESSING by this worker means the container stopped mid-job; it can't be trusted, so fail it.
function recoverInterrupted(db, workerId, now = new Date()) {
  const rows = db.prepare("SELECT * FROM jobs WHERE status='PROCESSING' AND worker_id=?").all(workerId);
  return rows.map(row => failJob(db, row.id, { reason: 'WORKER_RESTARTED', message: 'The worker restarted while this job was processing.', stage: 'processing' }, now));
}

function getJob(db, id) { return getRow(db, id) || null; }
function listJobs(db, { status, limit = 20, offset = 0 } = {}) {
  return status
    ? db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY id DESC LIMIT ? OFFSET ?').all(status, limit, offset)
    : db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
}
function jobStats(db) {
  const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
  db.prepare('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status').all().forEach(row => { counts[row.status] = row.count; });
  const timing = db.prepare("SELECT AVG(processing_duration_ms) AS avgProcessingMs, AVG(queue_time_ms) AS avgQueueMs FROM jobs WHERE status='COMPLETED'").get();
  return { total: Object.values(counts).reduce((sum, count) => sum + count, 0), byStatus: counts,
    avgProcessingMs: timing.avgProcessingMs === null ? null : round(timing.avgProcessingMs), avgQueueMs: timing.avgQueueMs === null ? null : round(timing.avgQueueMs) };
}

function heartbeat(db, workerId, now = new Date()) {
  db.prepare('INSERT INTO workers (id, started_at, last_heartbeat_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET last_heartbeat_at=excluded.last_heartbeat_at').run(workerId, now.toISOString(), now.toISOString());
}
function recordWorkerStart(db, workerId, recovered, now = new Date()) {
  db.prepare(`INSERT INTO workers (id, started_at, last_heartbeat_at, recovered_jobs) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at, last_heartbeat_at=excluded.last_heartbeat_at, recovered_jobs=recovered_jobs+excluded.recovered_jobs`)
    .run(workerId, now.toISOString(), now.toISOString(), recovered);
}
function recordOutcome(db, workerId, completed) {
  db.prepare(`UPDATE workers SET ${completed ? 'jobs_completed=jobs_completed+1' : 'jobs_failed=jobs_failed+1'} WHERE id=?`).run(workerId);
}
function workerStatus(db, now = new Date()) {
  const row = db.prepare('SELECT * FROM workers ORDER BY last_heartbeat_at DESC LIMIT 1').get();
  if (!row) return { status: 'unknown', id: null, lastHeartbeatAt: null };
  const age = now.getTime() - new Date(row.last_heartbeat_at).getTime();
  return { status: age <= HEARTBEAT_STALE_MS ? 'online' : 'offline', id: row.id, startedAt: row.started_at, lastHeartbeatAt: row.last_heartbeat_at,
    jobsCompleted: row.jobs_completed, jobsFailed: row.jobs_failed, recoveredJobs: row.recovered_jobs };
}

module.exports = { STATUSES, publicId, parseJobId, toResponse, createJob, createRejectedJob, claimNextJob, completeJob, failJob, recoverInterrupted,
  getJob, listJobs, jobStats, heartbeat, recordWorkerStart, recordOutcome, workerStatus };
