const fs = require('fs/promises');
const path = require('path');
const jobs = require('./jobs');
const { processFile, ProcessingError } = require('./processor');
const { flushHec } = require('./hec');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const elapsedMs = started => Number(process.hrtime.bigint() - started) / 1e6;
const round = value => Number(value.toFixed(2));
// Splunk fields are snake_case, matching the request logs.
const RESULT_FIELDS = { rowCount: 'row_count', columnCount: 'column_count', missingValues: 'missing_values', duplicateRows: 'duplicate_rows', lineCount: 'line_count', wordCount: 'word_count', characterCount: 'character_count' };

/**
 * Polls the shared database for QUEUED jobs and processes them one at a time.
 * sleep and exit are injectable so tests can run the slow and crash demos instantly.
 */
function createWorker({ db, uploadDir, logger, workerId, pollMs = 1000, heartbeatMs = 5000, slowJobMs = 8000, sleep = delay, exit = code => process.exit(code), flushLogs = flushHec }) {
  let running = false, current = Promise.resolve(), heartbeatTimer = null;
  const jobFields = row => ({ job_id: jobs.publicId(row.id), job_status: row.status, file_name: row.file_name, file_type: row.file_type, file_size_bytes: row.file_size_bytes, worker: workerId, ...(row.demo ? { demo: row.demo } : {}) });
  const removeUpload = row => (row.stored_path ? fs.rm(path.join(uploadDir, row.stored_path), { force: true }).catch(() => {}) : Promise.resolve());

  async function processJob(row) {
    const queueDepth = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status='QUEUED'").get().count;
    logger.info({ event: 'job_started', ...jobFields(row), queue_time_ms: row.queue_time_ms, queue_depth: queueDepth }, 'Job started');
    const started = process.hrtime.bigint();
    try {
      if (row.demo === 'crash') {
        logger.fatal({ event: 'worker_crash_simulated', ...jobFields(row) }, 'Simulated worker crash requested by a demo job');
        // Deliver job_started and the crash event to Splunk first; process.exit would drop posts still in flight.
        await flushLogs();
        exit(1);
        return jobs.getJob(db, row.id);
      }
      if (row.demo === 'slow') await sleep(slowJobMs);
      let buffer;
      try { buffer = await fs.readFile(path.join(uploadDir, row.stored_path || '')); } catch (_) { throw new ProcessingError('FILE_MISSING', 'The uploaded file could not be found on the shared volume.'); }
      if (row.demo === 'fail') throw new ProcessingError('DEMO_INTENTIONAL_FAILURE', 'Intentional failure requested through /api/demo/fail-job.');
      const result = processFile(row.file_type, buffer), duration = elapsedMs(started);
      const done = jobs.completeJob(db, row.id, result, duration);
      jobs.recordOutcome(db, workerId, true);
      const metrics = Object.fromEntries(Object.entries(RESULT_FIELDS).filter(([key]) => result[key] !== undefined).map(([key, field]) => [field, result[key]]));
      logger.info({ event: 'job_completed', ...jobFields(done), ...metrics, queue_time_ms: done.queue_time_ms, processing_duration_ms: round(duration) }, 'Job completed');
      return done;
    } catch (error) {
      const known = error instanceof ProcessingError, duration = elapsedMs(started);
      const reason = known ? error.code : 'PROCESSING_ERROR', message = known ? error.message : 'The worker hit an unexpected error while processing the file.';
      const failed = jobs.failJob(db, row.id, { reason, message, durationMs: duration });
      jobs.recordOutcome(db, workerId, false);
      logger.error({ event: 'job_failed', ...jobFields(failed), failure_stage: 'processing', failure_reason: reason, failure_message: message, queue_time_ms: failed.queue_time_ms,
        processing_duration_ms: round(duration), ...(known ? {} : { err: error }) }, 'Job failed');
      return failed;
    } finally {
      if (row.demo !== 'crash') await removeUpload(row);
    }
  }

  async function runOnce() {
    const row = jobs.claimNextJob(db, workerId);
    return row ? processJob(row) : null;
  }

  function beat() {
    try { jobs.heartbeat(db, workerId); } catch (error) { logger.warn({ event: 'worker_heartbeat_failed', worker: workerId, err: error }, 'Worker heartbeat failed'); }
  }

  async function start() {
    const recovered = jobs.recoverInterrupted(db, workerId);
    for (const row of recovered) {
      await removeUpload(row);
      logger.error({ event: 'job_failed', ...jobFields(row), failure_stage: 'processing', failure_reason: row.failure_reason, failure_message: row.failure_message, queue_time_ms: row.queue_time_ms }, 'Job failed');
    }
    jobs.recordWorkerStart(db, workerId, recovered.length);
    logger.info({ event: 'worker_started', worker: workerId, recovered_jobs: recovered.length, poll_ms: pollMs }, 'Worker started');
    running = true;
    heartbeatTimer = setInterval(beat, heartbeatMs);
    while (running) {
      current = runOnce().catch(error => { logger.error({ event: 'worker_loop_error', worker: workerId, err: error }, 'Worker loop error'); return null; });
      if (!(await current) && running) await sleep(pollMs);
    }
  }

  // Let the job in progress finish so a deploy or restart doesn't strand it.
  async function stop() {
    running = false; clearInterval(heartbeatTimer);
    await current;
    logger.info({ event: 'worker_stopped', worker: workerId }, 'Worker stopped');
  }

  return { start, stop, runOnce, processJob };
}

module.exports = { createWorker };
