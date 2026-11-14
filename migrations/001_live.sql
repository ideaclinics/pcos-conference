-- Live questions for the 15 Nov 2026 stream. Run once on D1 pmos-registrations.
CREATE TABLE IF NOT EXISTS questions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  hall       TEXT NOT NULL,                 -- 'pmos' | 'diabetes'
  name       TEXT,
  question   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new',   -- new | approved | rejected | asked
  source     TEXT NOT NULL DEFAULT 'viewer',-- viewer | operator
  ip_hash    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions (status, id);
CREATE INDEX IF NOT EXISTS idx_questions_ip ON questions (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS live_state (
  hall        TEXT PRIMARY KEY,
  session_key TEXT,
  updated_at  TEXT
);
