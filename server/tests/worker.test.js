const fs = require('fs'); const os = require('os'); const path = require('path');
const Database = require('better-sqlite3'); const { initialise } = require('../db'); const jobs = require('../jobs'); const { createWorker } = require('../workerLoop');
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn() };
let db, uploadDir, worker, exit, sleep;
beforeEach(() => {
  db = initialise(new Database(':memory:')); uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-worker-'));
  exit = jest.fn(); sleep = jest.fn(() => Promise.resolve());
  worker = createWorker({ db, uploadDir, logger, workerId: 'worker-a', exit, sleep, slowJobMs: 8000, pollMs: 5 });
});
afterEach(() => { db.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); jest.clearAllMocks(); });
function queue(name, content, demo = null) {
  const storedPath = `${name}-${Math.random()}`; fs.writeFileSync(path.join(uploadDir, storedPath), content);
  return jobs.createJob(db, { fileName: name, fileType: path.extname(name).slice(1), fileSizeBytes: Buffer.byteLength(content), storedPath, demo, now: new Date(Date.now() - 250) });
}
// The polling loop needs a real delay so the test's own timers can run.
const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const logged = event => [...logger.info.mock.calls, ...logger.error.mock.calls, ...logger.fatal.mock.calls].map(call => call[0]).filter(fields => fields.event === event);

test('processes a queued CSV through PROCESSING to COMPLETED and logs timings', async () => {
  const row = queue('attendance.csv', 'name,roll\nAditi,1\nRahul,\n');
  const done = await worker.runOnce();
  expect(jobs.toResponse(done)).toMatchObject({ jobId: jobs.publicId(row.id), status: 'COMPLETED', rowCount: 2, columnCount: 2, missingValues: 1, duplicateRows: 0, worker: 'worker-a' });
  expect(done.queue_time_ms).toBeGreaterThanOrEqual(250); expect(done.processing_duration_ms).toBeGreaterThanOrEqual(0);
  expect(logged('job_started')[0]).toMatchObject({ job_id: jobs.publicId(row.id), queue_depth: 0 });
  expect(logged('job_completed')[0]).toMatchObject({ row_count: 2, column_count: 2, missing_values: 1, file_type: 'csv' });
  expect(fs.readdirSync(uploadDir)).toEqual([]);
  expect(await worker.runOnce()).toBeNull();
});
test('processes jobs oldest first', async () => {
  queue('first.txt', 'one'); queue('second.txt', 'two');
  expect((await worker.runOnce()).file_name).toBe('first.txt');
});
test.each([
  ['broken.csv', 'a,b\n1', null, 'MALFORMED_CSV'], ['empty.txt', '', null, 'EMPTY_FILE'], ['demo.csv', 'a\n1', 'fail', 'DEMO_INTENTIONAL_FAILURE']
])('%s fails with %s', async (name, content, demo, reason) => {
  queue(name, content, demo);
  const failed = await worker.runOnce();
  expect(failed).toMatchObject({ status: 'FAILED', failure_reason: reason, failure_stage: 'processing' });
  expect(logged('job_failed')[0]).toMatchObject({ failure_reason: reason, job_status: 'FAILED' });
  expect(jobs.workerStatus(db).status).toBe('unknown');
});
test('a missing upload fails the job', async () => {
  const row = queue('gone.csv', 'a\n1'); fs.rmSync(path.join(uploadDir, row.stored_path));
  expect((await worker.runOnce()).failure_reason).toBe('FILE_MISSING');
});
test('unexpected errors are reported as PROCESSING_ERROR', async () => {
  queue('odd.csv', 'a\n1'); jest.spyOn(jobs, 'completeJob').mockImplementationOnce(() => { throw new Error('disk full'); });
  expect((await worker.runOnce()).failure_reason).toBe('PROCESSING_ERROR');
  expect(logged('job_failed')[0].err.message).toBe('disk full');
});
test('the slow demo waits before processing', async () => {
  queue('slow.csv', 'a\n1', 'slow');
  expect((await worker.runOnce()).status).toBe('COMPLETED'); expect(sleep).toHaveBeenCalledWith(8000);
});
test('the crash demo exits the process and the restarted worker fails the interrupted job', async () => {
  const row = queue('crash.csv', 'a\n1', 'crash');
  expect((await worker.runOnce()).status).toBe('PROCESSING'); expect(exit).toHaveBeenCalledWith(1);
  expect(logged('worker_crash_simulated')).toHaveLength(1);
  const restarted = createWorker({ db, uploadDir, logger, workerId: 'worker-a', exit, sleep: realSleep, pollMs: 5 });
  const running = restarted.start(); await new Promise(resolve => setTimeout(resolve, 20)); await restarted.stop(); await running;
  expect(jobs.toResponse(jobs.getJob(db, row.id))).toMatchObject({ status: 'FAILED', failureReason: 'WORKER_RESTARTED' });
  expect(logged('worker_started')[0]).toMatchObject({ recovered_jobs: 1 });
  expect(jobs.workerStatus(db)).toMatchObject({ status: 'online', id: 'worker-a', recoveredJobs: 1 });
});
test('a worker only recovers its own interrupted jobs', () => {
  const row = queue('busy.csv', 'a\n1'); jobs.claimNextJob(db, 'worker-b');
  expect(jobs.recoverInterrupted(db, 'worker-a')).toEqual([]); expect(jobs.getJob(db, row.id).status).toBe('PROCESSING');
});
test('the loop keeps polling and records outcomes', async () => {
  worker = createWorker({ db, uploadDir, logger, workerId: 'worker-a', sleep: realSleep, pollMs: 5 });
  const running = worker.start();
  await realSleep(10); queue('late.txt', 'arrives after start');
  await new Promise(resolve => setTimeout(resolve, 30)); await worker.stop(); await running;
  expect(jobs.jobStats(db).byStatus.COMPLETED).toBe(1); expect(jobs.workerStatus(db).jobsCompleted).toBe(1);
  expect(logged('worker_stopped')).toHaveLength(1);
});
test('worker status goes offline when heartbeats stop', () => {
  jobs.heartbeat(db, 'worker-a', new Date(Date.now() - 60000));
  expect(jobs.workerStatus(db).status).toBe('offline');
});
test('database startup retries while another process holds the lock, then switches to WAL', () => {
  const { createDb } = require('../db');
  // A plain rollback-journal connection holding an exclusive lock blocks the switch to WAL, as a concurrent first start does.
  const file = path.join(uploadDir, 'shared.db'), holder = new Database(file);
  holder.exec('CREATE TABLE t (x INTEGER); BEGIN EXCLUSIVE; INSERT INTO t VALUES (1);');
  const started = Date.now();
  expect(() => createDb(file, { attempts: 2, busyTimeoutMs: 50 })).toThrow(/locked|busy/i);
  expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  holder.exec('COMMIT'); holder.close();
  const db = createDb(file); expect(db.pragma('journal_mode', { simple: true })).toBe('wal'); db.close();
});
