import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import Database from 'better-sqlite3';
import type { Env } from '../types';

type SqliteDatabase = Database.Database;

type BatchMeta = {
  changes: number;
  last_row_id: number;
};

function asMeta(changes = 0, lastRowId = 0): BatchMeta {
  return {
    changes,
    last_row_id: lastRowId,
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/^\s+/, '').toUpperCase();
}

function isSelectLike(sql: string): boolean {
  const normalized = normalizeSql(sql);
  return normalized.startsWith('SELECT') || normalized.startsWith('PRAGMA') || normalized.startsWith('WITH');
}

class LocalD1PreparedStatement {
  private readonly parameters: unknown[];

  constructor(
    private readonly sqlite: SqliteDatabase,
    private readonly sql: string,
    params: unknown[] = [],
  ) {
    this.parameters = params;
  }

  bind(...params: unknown[]): LocalD1PreparedStatement {
    return new LocalD1PreparedStatement(this.sqlite, this.sql, params);
  }

  private statement(): Database.Statement {
    return this.sqlite.prepare(this.sql);
  }

  private runSync(): D1Result {
    const info = this.statement().run(...this.parameters);
    return {
      success: true,
      results: [],
      meta: asMeta(Number(info.changes || 0), Number(info.lastInsertRowid || 0)),
    } as unknown as D1Result;
  }

  private allSync<T>(): D1Result<T> {
    const rows = this.statement().all(...this.parameters) as T[];
    return {
      success: true,
      results: rows,
      meta: asMeta(0, 0),
    } as unknown as D1Result<T>;
  }

  executeForBatch(): D1Result {
    return isSelectLike(this.sql) ? this.allSync() : this.runSync();
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.statement().get(...this.parameters) as T | undefined;
    return row ?? null;
  }

  async run(): Promise<D1Result> {
    return this.runSync();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.allSync<T>();
  }
}

class LocalD1Database {
  constructor(private readonly sqlite: SqliteDatabase) {}

  prepare(sql: string): D1PreparedStatement {
    return new LocalD1PreparedStatement(this.sqlite, sql) as unknown as D1PreparedStatement;
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const localStatements = statements as unknown as LocalD1PreparedStatement[];
    const tx = this.sqlite.transaction(() => localStatements.map((statement) => statement.executeForBatch()));
    return tx() as D1Result[];
  }
}

class LocalKVNamespace {
  constructor(private readonly sqlite: SqliteDatabase) {}

  private purgeExpired(key?: string): void {
    const now = Date.now();
    if (key) {
      this.sqlite.prepare('DELETE FROM kv_store WHERE key = ? AND expires_at IS NOT NULL AND expires_at <= ?').run(key, now);
      return;
    }
    this.sqlite.prepare('DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now);
  }

  async get(key: string): Promise<string | null> {
    this.purgeExpired(key);
    const row = this.sqlite
      .prepare('SELECT value FROM kv_store WHERE key = ? LIMIT 1')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const ttl = Number(options?.expirationTtl ?? 0);
    const expiresAt = Number.isFinite(ttl) && ttl > 0 ? Date.now() + ttl * 1000 : null;
    this.sqlite
      .prepare(
        `INSERT INTO kv_store (key, value, expires_at, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at, updated_at = excluded.updated_at`
      )
      .run(key, value, expiresAt);
  }

  async delete(key: string): Promise<void> {
    this.sqlite.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
  }
}

function ensureWebPlatformPolyfills(): void {
  const globalWithCrypto = globalThis as typeof globalThis & { crypto?: Crypto };
  if (!globalWithCrypto.crypto) {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
      writable: true,
    });
  }
  if (!globalThis.btoa) {
    globalThis.btoa = (input: string) => Buffer.from(input, 'binary').toString('base64');
  }
  if (!globalThis.atob) {
    globalThis.atob = (input: string) => Buffer.from(input, 'base64').toString('binary');
  }
}

function ensureSqlitePragmas(sqlite: SqliteDatabase): void {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
}

function ensureLocalMetaTables(sqlite: SqliteDatabase): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __local_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kv_store_expires_at ON kv_store(expires_at);
  `);
}

function applyLocalMigrations(sqlite: SqliteDatabase): void {
  const currentFile = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(currentFile), '..', '..');
  const migrationsDir = path.join(projectRoot, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const exists = sqlite
      .prepare('SELECT 1 FROM __local_migrations WHERE name = ? LIMIT 1')
      .get(file);
    if (exists) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const tx = sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite.prepare('INSERT INTO __local_migrations (name) VALUES (?)').run(file);
    });
    tx();
  }
}

export function createSqliteDatabase(dbPath: string): SqliteDatabase {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  ensureSqlitePragmas(sqlite);
  ensureLocalMetaTables(sqlite);
  applyLocalMigrations(sqlite);
  return sqlite;
}

export function createLocalBindingsFromEnv(env: NodeJS.ProcessEnv = process.env): Env & { __sqlite: SqliteDatabase } {
  ensureWebPlatformPolyfills();

  const dbPath = (env.SQLITE_PATH || '/data/cpa-cron-web.db').trim();
  const sqlite = createSqliteDatabase(dbPath);

  return {
    DB: new LocalD1Database(sqlite) as unknown as D1Database,
    KV: new LocalKVNamespace(sqlite) as unknown as KVNamespace,
    CPA_BASE_URL: env.CPA_BASE_URL,
    CPA_TOKEN: env.CPA_TOKEN,
    ADMIN_USERNAME: env.ADMIN_USERNAME,
    ADMIN_PASSWORD: env.ADMIN_PASSWORD,
    ADMIN_PASSWORD_HASH: env.ADMIN_PASSWORD_HASH,
    JWT_SECRET: env.JWT_SECRET,
    __sqlite: sqlite,
  };
}
