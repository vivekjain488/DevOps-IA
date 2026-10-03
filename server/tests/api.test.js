const fs = require('fs'); const os = require('os'); const path = require('path');
const request = require('supertest'); const Database = require('better-sqlite3');
const { initialise } = require('../db'); const createApp = require('../app'); const jobs = require('../jobs');
let db, app, uploadDir;
beforeEach(() => { db = initialise(new Database(':memory:')); uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-')); app = createApp(db, { uploadDir }); process.env.DEMO_MODE = 'false'; });
afterEach(() => { db.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });
const upload = (name, content) => request(app).post('/api/jobs').attach('file', Buffer.from(content), name);

test('health reports the database, queue and worker state', async () => {
  const r = await request(app).get('/api/health');
  expect(r.status).toBe(200); expect(r.body.data).toMatchObject({ status: 'ok', service: 'docuflow-api', queuedJobs: 0, demoMode: false, worker: { status: 'unknown' } });
});
test('a CSV upload is stored and queued', async () => {
  const r = await upload('attendance.csv', 'name,roll\nAditi,1\n');
  expect(r.status).toBe(201); expect(r.body.data).toMatchObject({ jobId: 'JOB-1001', status: 'QUEUED', fileName: 'attendance.csv', fileType: 'csv', fileSizeBytes: 18 });
  const stored = db.prepare('SELECT stored_path FROM jobs').get().stored_path;
  expect(fs.readFileSync(path.join(uploadDir, stored), 'utf8')).toBe('name,roll\nAditi,1\n');
  expect((await request(app).get('/api/jobs/JOB-1001')).body.data.status).toBe('QUEUED');
  expect((await request(app).get('/api/jobs/1001')).body.data.jobId).toBe('JOB-1001');
});
test('file names are reduced to a safe base name', async () => expect((await upload('../../etc/notes.TXT', 'hello')).body.data).toMatchObject({ fileName: 'notes.TXT', fileType: 'txt' }));
test('unsupported types are rejected and recorded as failed jobs', async () => {
  const r = await upload('report.pdf', '%PDF');
  expect(r.status).toBe(415); expect(r.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  expect(r.body.data).toMatchObject({ status: 'FAILED', failureStage: 'validation', failureReason: 'UNSUPPORTED_FILE_TYPE', fileType: 'pdf' });
  expect(fs.readdirSync(uploadDir)).toEqual([]);
});
test('files over 5 MB are rejected', async () => {
  const r = await upload('big.csv', Buffer.alloc(5 * 1024 * 1024 + 1, 'a'));
  expect(r.status).toBe(413); expect(r.body.data.failureReason).toBe('FILE_TOO_LARGE'); expect(r.body.data.fileSizeBytes).toBeGreaterThan(5 * 1024 * 1024);
});
test('exactly 5 MB is accepted', async () => expect((await upload('edge.txt', Buffer.alloc(5 * 1024 * 1024, 'a'))).status).toBe(201));
test('declared bodies far above the limit are refused before reading', async () => {
  const r = await request(app).post('/api/jobs').set('Content-Type', 'multipart/form-data; boundary=x').set('Content-Length', String(60 * 1024 * 1024)).send('');
  expect(r.status).toBe(413);
});
test('requests without a file are rejected without creating a job', async () => {
  expect((await request(app).post('/api/jobs').send({ file: 'x' })).body.error.code).toBe('NO_FILE');
  expect((await request(app).post('/api/jobs').field('note', 'x')).body.error.code).toBe('NO_FILE');
  expect((await request(app).post('/api/jobs').set('Content-Type', 'multipart/form-data').send('broken')).body.error.code).toBe('INVALID_UPLOAD');
  expect(jobs.jobStats(db).total).toBe(0);
});
test('jobs list newest first, filter by status and validate parameters', async () => {
  await upload('a.csv', 'a\n1'); await upload('b.pdf', 'x');
  expect((await request(app).get('/api/jobs')).body.data.map(job => job.fileName)).toEqual(['b.pdf', 'a.csv']);
  expect((await request(app).get('/api/jobs?status=failed')).body.data).toHaveLength(1);
  expect((await request(app).get('/api/jobs?status=DONE')).status).toBe(400);
  expect((await request(app).get('/api/jobs?limit=500')).status).toBe(400);
  const stats = (await request(app).get('/api/jobs/stats')).body.data;
  expect(stats).toMatchObject({ total: 2, byStatus: { QUEUED: 1, FAILED: 1, PROCESSING: 0, COMPLETED: 0 } });
});
test('unknown and malformed job IDs', async () => {
  expect((await request(app).get('/api/jobs/JOB-9999')).status).toBe(404);
  expect((await request(app).get('/api/jobs/abc')).status).toBe(400);
});
test('demo routes are absent unless DEMO_MODE is enabled', async () => expect((await request(app).post('/api/demo/fail-job')).status).toBe(404));
test.each([['fail-job', 'fail'], ['slow-job', 'slow'], ['crash-worker', 'crash']])('demo %s queues a %s job', async (route, demo) => {
  process.env.DEMO_MODE = 'true';
  const r = await request(app).post(`/api/demo/${route}`);
  expect(r.status).toBe(201); expect(r.body.data).toMatchObject({ status: 'QUEUED', demo, fileType: 'csv' });
});
test('unknown demo names fall through to 404', async () => { process.env.DEMO_MODE = 'true'; expect((await request(app).post('/api/demo/explode')).status).toBe(404); });
test('unknown API routes return a JSON 404', async () => expect((await request(app).get('/api/nope')).body.error.code).toBe('ROUTE_NOT_FOUND'));
test('log search rejects unsafe filters', async () => {
  const r = await request(app).get('/api/observability/logs?level=root&service=db'); expect(r.status).toBe(400); expect(r.body.error.details).toEqual(['level', 'service']);
});
test('observability endpoints report Splunk as unavailable when unconfigured', async () => {
  const url = process.env.SPLUNK_REST_URL; delete process.env.SPLUNK_REST_URL;
  const summary = await request(app).get('/api/observability/summary?range=1h'); expect(summary.status).toBe(503); expect(summary.body.error.code).toBe('SPLUNK_NOT_CONFIGURED');
  expect((await request(app).get('/api/observability/logs')).status).toBe(503); if (url) process.env.SPLUNK_REST_URL = url;
});
