import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATABASE_PATH
  ? path.dirname(process.env.DATABASE_PATH)
  : path.join(__dirname, '..', 'data')

mkdirSync(dataDir, { recursive: true })

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'obsisync.db')
export const db = new DatabaseSync(dbPath)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    two_fa        INTEGER NOT NULL DEFAULT 0,
    two_fa_secret TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    bio     TEXT NOT NULL DEFAULT '',
    avatar  TEXT,
    banner  TEXT,
    theme   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token      TEXT NOT NULL UNIQUE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT NOT NULL DEFAULT '',
    ip         TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activity (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind    TEXT NOT NULL,
    path    TEXT NOT NULL DEFAULT '',
    at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS files (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path       TEXT NOT NULL,
    size       INTEGER NOT NULL DEFAULT 0,
    hash       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, path)
  );

  -- история файла: одна строка на каждое изменение (операция).
  -- содержимое версии лежит отдельно в data/blobs/<hash> — одинаковые
  -- байты хранятся один раз, а не копией на каждую правку.
  CREATE TABLE IF NOT EXISTS revisions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path       TEXT NOT NULL,
    op         TEXT NOT NULL,
    size       INTEGER NOT NULL DEFAULT 0,
    hash       TEXT NOT NULL DEFAULT '',
    prev_hash  TEXT NOT NULL DEFAULT '',
    device     TEXT NOT NULL DEFAULT '',
    at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_activity_user_at ON activity(user_id, at);
  CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
  CREATE INDEX IF NOT EXISTS idx_revisions_user_path ON revisions(user_id, path, at);
`)

// миграции старой базы: колонки, которых могло не быть.
// Важно: в ALTER TABLE DEFAULT должен быть константой — функции типа
// datetime('now') SQLite там не принимает, поэтому пустая строка + UPDATE ниже.
const migrations = [
  'ALTER TABLE users ADD COLUMN two_fa INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN two_fa_secret TEXT',
  "ALTER TABLE sessions ADD COLUMN label TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE sessions ADD COLUMN ip TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE sessions ADD COLUMN last_seen TEXT NOT NULL DEFAULT ''"
]
for (const sql of migrations) {
  try {
    db.exec(sql)
  } catch {
    // колонка уже есть — ок
  }
}
db.exec("UPDATE sessions SET last_seen = datetime('now') WHERE last_seen = ''")

// Файлы, загруженные до появления истории, получают первую версию задним
// числом — иначе у них не будет ни одной записи в revisions.
db.exec(`
  INSERT INTO revisions (user_id, path, op, size, hash, device, at)
  SELECT user_id, path, 'created', size, hash, '', created_at
  FROM files
  WHERE NOT EXISTS (
    SELECT 1 FROM revisions r WHERE r.user_id = files.user_id AND r.path = files.path
  )
`)

export const DATA_DIR = dataDir
