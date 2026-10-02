const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, venue TEXT NOT NULL,
 event_date TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity >= 1 AND capacity <= 1000),
 registered_count INTEGER NOT NULL DEFAULT 0 CHECK(registered_count >= 0), description TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date);
CREATE TABLE IF NOT EXISTS registrations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
 created_at TEXT NOT NULL, FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
 UNIQUE(event_id, email)
);
CREATE INDEX IF NOT EXISTS idx_registrations_event_id ON registrations(event_id);`;

function initialise(db, seed = false) {
  db.exec(schema);
  if (seed && db.prepare('SELECT COUNT(*) AS count FROM events').get().count === 0) {
    const now = new Date();
    const rows = [
      ['Mumbai DevOps Meetup', 'Somaiya Vidyavihar, Ghatkopar', 14, 80, 'A practical evening on containers and observability.'],
      ['Cloud Native Mumbai', 'Bandra Kurla Complex, Bandra', 30, 150, 'Community sessions on reliable cloud delivery.'],
      ['Data & Signals Forum', 'The Leela Mumbai, Andheri', 45, 100, 'Monitoring and analytics for modern operations.']
    ];
    const insert = db.prepare('INSERT INTO events (title,venue,event_date,capacity,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
    const transaction = db.transaction(() => rows.forEach(([title, venue, days, capacity, description]) => {
      const date = new Date(now.getTime() + days * 86400000).toISOString();
      insert.run(title, venue, date, capacity, description, now.toISOString(), now.toISOString());
    }));
    transaction();
  }
  return db;
}
function createDb(filename = process.env.DATABASE_PATH || (process.env.NODE_ENV === 'production' ? '/app/data/eventpulse.db' : path.join(__dirname, 'data', 'eventpulse.db')), seed = true) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  return initialise(new Database(filename), seed);
}
module.exports = { createDb, initialise };
