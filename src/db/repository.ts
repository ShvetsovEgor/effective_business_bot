import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BusinessProfile, Status, Task, TaskRule } from '../domain/checklist/types.js';
import { deadline } from '../domain/deadlines/index.js';
import type { TaxInput, TaxResult } from '../domain/tax/types.js';
import type { Screen } from '../bot/messages/types.js';

export interface Session {
  screen?: Screen;
  nonce: string;
  actions: string[];
  form?: 'profile' | 'tax' | 'transition';
  step?: number;
  draft?: Record<string, string | number | boolean | null>;
  transitionId?: string;
  taxDate?: string;
}
type JsonRow = { data: string };
type TaskRow = { data: string; status: Status; completion_date: string | null; deadline: string | null };

export class Repository {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, session TEXT NOT NULL DEFAULT '{"nonce":"","actions":[]}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS business_profiles (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('TODO','IN_PROGRESS','DONE','NOT_APPLICABLE')),
        deadline TEXT, deadline_type TEXT NOT NULL, official_source_url TEXT NOT NULL,
        why_it_matters TEXT NOT NULL, completion_date TEXT, source_url TEXT NOT NULL, verified_at TEXT NOT NULL,
        task_group TEXT NOT NULL, position INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        data TEXT NOT NULL, PRIMARY KEY(user_id,id)
      );
      CREATE TABLE IF NOT EXISTS tax_calculations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        year INTEGER NOT NULL, input TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS tasks_user_active ON tasks(user_id,active);
      CREATE TABLE IF NOT EXISTS processed_events (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(user_id,event_id)
      );
      CREATE TABLE IF NOT EXISTS bot_screens (
        user_id TEXT PRIMARY KEY, data TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  ensureUser(id: string) { this.db.prepare('INSERT OR IGNORE INTO users(id) VALUES (?)').run(id); }
  session(id: string): Session {
    const row = this.db.prepare('SELECT session AS data FROM users WHERE id=?').get(id) as JsonRow | undefined;
    return row ? JSON.parse(row.data) as Session : { nonce: '', actions: [] };
  }
  saveSession(id: string, session: Session) {
    this.db.prepare('UPDATE users SET session=? WHERE id=?').run(JSON.stringify(session), id);
  }
  botScreen(id: string): { messageId?: string; inputMessageId?: string; pending: string[] } {
    const row = this.db.prepare('SELECT data FROM bot_screens WHERE user_id=?').get(id) as JsonRow | undefined;
    return row ? JSON.parse(row.data) : { pending: [] };
  }
  saveBotScreen(id: string, state: { messageId?: string; inputMessageId?: string; pending: string[] }) {
    this.db.prepare('INSERT INTO bot_screens(user_id,data) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(state));
  }
  event(id: string, eventId: string): Screen | null {
    const row = this.db.prepare('SELECT response AS data FROM processed_events WHERE user_id=? AND event_id=?').get(id, eventId) as JsonRow | undefined;
    return row ? JSON.parse(row.data) as Screen : null;
  }
  saveEvent(id: string, eventId: string, screen: Screen) {
    this.db.prepare('INSERT OR REPLACE INTO processed_events(user_id,event_id,response) VALUES (?,?,?)').run(id, eventId, JSON.stringify(screen));
    this.db.prepare('DELETE FROM processed_events WHERE user_id=? AND rowid NOT IN (SELECT rowid FROM processed_events WHERE user_id=? ORDER BY rowid DESC LIMIT 500)').run(id, id);
  }
  profile(id: string): BusinessProfile | null {
    const row = this.db.prepare('SELECT data FROM business_profiles WHERE user_id=?').get(id) as JsonRow | undefined;
    return row ? JSON.parse(row.data) as BusinessProfile : null;
  }
  saveProfile(id: string, profile: BusinessProfile) {
    this.db.prepare('INSERT INTO business_profiles(user_id,data) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(profile));
  }
  syncTasks(id: string, rules: TaskRule[], date?: string, replaceAfter = false) {
    if (replaceAfter) this.db.prepare("UPDATE tasks SET active=0 WHERE user_id=? AND task_group IN ('after','hr')").run(id);
    const stmt = this.db.prepare(`INSERT INTO tasks
      (user_id,id,title,description,status,deadline,deadline_type,official_source_url,why_it_matters,completion_date,source_url,verified_at,task_group,position,data)
      VALUES (?,?,?,?,'TODO',?,?,?,?,NULL,?,?,?,?,?)
      ON CONFLICT(user_id,id) DO UPDATE SET title=excluded.title,description=excluded.description,
      deadline=excluded.deadline,deadline_type=excluded.deadline_type,official_source_url=excluded.official_source_url,
      why_it_matters=excluded.why_it_matters,source_url=excluded.source_url,verified_at=excluded.verified_at,
      data=excluded.data,active=1,position=excluded.position`);
    rules.forEach((rule, index) => stmt.run(id, rule.id, rule.title, rule.description,
      deadline(rule.deadline_rule, date), rule.deadline_rule.type, rule.source_url, rule.why_it_matters,
      rule.source_url, rule.verified_at, rule.group, index, JSON.stringify(rule)));
  }
  tasks(id: string): Task[] {
    const rows = this.db.prepare('SELECT data,status,completion_date,deadline FROM tasks WHERE user_id=? AND active=1 ORDER BY task_group,position,id').all(id) as TaskRow[];
    return rows.map(row => {
      const rule = JSON.parse(row.data) as TaskRule;
      return { ...rule, status: row.status, completion_date: row.completion_date, deadline: row.deadline,
        deadline_type: rule.deadline_rule.type, official_source_url: rule.source_url };
    });
  }
  setStatus(id: string, taskId: string, status: Status) {
    this.db.prepare('UPDATE tasks SET status=?,completion_date=? WHERE user_id=? AND id=? AND active=1 AND status<>?')
      .run(status, status === 'DONE' ? new Date().toISOString() : null, id, taskId, status);
  }
  saveCalculation(id: string, input: TaxInput, result: TaxResult[]) {
    this.db.prepare('INSERT INTO tax_calculations(user_id,year,input,result) VALUES (?,2026,?,?)').run(id, JSON.stringify(input), JSON.stringify(result));
  }
  calculation(id: string): { input: TaxInput; result: TaxResult[] } | null {
    const row = this.db.prepare('SELECT input,result FROM tax_calculations WHERE user_id=? ORDER BY id DESC LIMIT 1').get(id) as { input: string; result: string } | undefined;
    return row ? { input: JSON.parse(row.input) as TaxInput, result: JSON.parse(row.result) as TaxResult[] } : null;
  }
  reset(id: string) {
    this.db.prepare('DELETE FROM users WHERE id=?').run(id);
    this.ensureUser(id);
  }
}
