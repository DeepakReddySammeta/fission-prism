import Database from 'better-sqlite3';
import path from 'node:path';

/** A single local file — no external service, no migration framework needed
 * at this size. Gitignored; created on first run. */
export const db = new Database(path.join(__dirname, '..', 'data.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    google_sub TEXT UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    destination TEXT NOT NULL,
    image_url TEXT,
    trip_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

export interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  google_sub: string | null;
  created_at: string;
}

export interface PlanRow {
  id: string;
  user_id: string;
  title: string;
  destination: string;
  image_url: string | null;
  trip_json: string;
  created_at: string;
}
