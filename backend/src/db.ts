import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

/** A single local file — no external service, no migration framework needed
 * at this size. Gitignored; created on first run.
 *
 * Path resolution:
 *   - DATABASE_PATH env var, if set — point this at a mounted persistent
 *     volume in production (e.g. /data/data.db) so the file survives
 *     redeploys and restarts.
 *   - otherwise backend/data.db, next to the compiled source (local dev).
 * The containing directory is created if it doesn't exist. */
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

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

  -- user_id is nullable: booking an appointment, like booking a flight,
  -- doesn't require signing in — only retrieving it later would.
  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    doctor_id TEXT NOT NULL,
    doctor_name TEXT NOT NULL,
    hospital_name TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    patient_age TEXT,
    patient_gender TEXT,
    patient_phone TEXT NOT NULL,
    patient_email TEXT,
    reason TEXT,
    preferred_date TEXT NOT NULL,
    preferred_time TEXT NOT NULL,
    appointment_ref TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Finance agent — unlike plans/appointments, every row here requires a
  -- signed-in user_id: this data is entirely personal (someone's income and
  -- spending), with no "guest" version that makes sense to keep around.
  CREATE TABLE IF NOT EXISTS finance_profile (
    user_id TEXT PRIMARY KEY,
    monthly_income REAL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- One row per user per category — re-stating "budget 8000 for food"
  -- updates the existing row (see the ON CONFLICT upsert in server.ts)
  -- rather than creating duplicates.
  CREATE TABLE IF NOT EXISTS budget_categories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    monthly_limit REAL NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, category),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT,
    spent_on TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- One row per user per goal name — "add 5000 to my car fund" updates
  -- saved_amount on the existing row rather than creating a new goal.
  CREATE TABLE IF NOT EXISTS savings_goals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    target_amount REAL NOT NULL,
    target_date TEXT,
    saved_amount REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, name),
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

export interface AppointmentRow {
  id: string;
  user_id: string | null;
  doctor_id: string;
  doctor_name: string;
  hospital_name: string;
  patient_name: string;
  patient_age: string | null;
  patient_gender: string | null;
  patient_phone: string;
  patient_email: string | null;
  reason: string | null;
  preferred_date: string;
  preferred_time: string;
  appointment_ref: string;
  created_at: string;
}

export interface FinanceProfileRow {
  user_id: string;
  monthly_income: number | null;
  updated_at: string;
}

export interface BudgetCategoryRow {
  id: string;
  user_id: string;
  category: string;
  monthly_limit: number;
  created_at: string;
}

export interface ExpenseRow {
  id: string;
  user_id: string;
  category: string;
  amount: number;
  note: string | null;
  spent_on: string;
  created_at: string;
}

export interface SavingsGoalRow {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  target_date: string | null;
  saved_amount: number;
  created_at: string;
}
