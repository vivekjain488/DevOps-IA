const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// The API and worker containers open the same file on a shared volume, so WAL mode and a busy timeout let them write concurrently.
const schema = `
CREATE TABLE IF NOT EXISTS jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 file_name TEXT NOT NULL, file_type TEXT NOT NULL, file_size_bytes INTEGER NOT NULL DEFAULT 0, stored_path TEXT,
 status TEXT NOT NULL CHECK(status IN ('QUEUED','PROCESSING','COMPLETED','FAILED')),
 failure_stage TEXT, failure_reason TEXT, failure_message TEXT, demo TEXT, result_json TEXT, worker_id TEXT, request_id TEXT,
 queued_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, queue_time_ms REAL, processing_duration_ms REAL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, id);
CREATE TABLE IF NOT EXISTS workers (
 id TEXT PRIMARY KEY, started_at TEXT NOT NULL, last_heartbeat_at TEXT NOT NULL,
 jobs_completed INTEGER NOT NULL DEFAULT 0, jobs_failed INTEGER NOT NULL DEFAULT 0, recovered_jobs INTEGER NOT NULL DEFAULT 0
);`;

function initialise(db, busyTimeoutMs = 5000) {
  db.pragma(`busy_timeout = ${busyTimeoutMs}`);
  if (db.name !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(schema);
  return db;
}
const defaultPath = () => process.env.DATABASE_PATH || (process.env.NODE_ENV === 'production' ? '/app/data/docuflow.db' : path.join(__dirname, 'data', 'docuflow.db'));
// When the API and worker start together, switching to WAL can hit a lock the busy timeout does not cover, so retry briefly.
function createDb(filename = defaultPath(), { attempts = 10, busyTimeoutMs = 5000 } = {}) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  for (let attempt = 1; ; attempt += 1) {
    const db = new Database(filename);
    try { return initialise(db, busyTimeoutMs); } catch (error) {
      db.close();
      if (error.code !== 'SQLITE_BUSY' || attempt >= attempts) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * attempt);
    }
  }
}
const uploadDirectory = () => process.env.UPLOAD_DIR || (process.env.NODE_ENV === 'production' ? '/app/data/uploads' : path.join(__dirname, 'data', 'uploads'));
module.exports = { createDb, initialise, uploadDirectory };
