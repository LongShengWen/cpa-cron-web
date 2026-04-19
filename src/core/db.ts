/**
 * D1 database access layer — mirrors the Python SQLite operations.
 */

const AUTH_ACCOUNT_COLUMNS = [
  'name', 'disabled', 'id_token_json', 'email', 'provider', 'source',
  'unavailable', 'auth_index', 'account', 'type', 'runtime_only',
  'status', 'status_message', 'chatgpt_account_id', 'id_token_plan_type',
  'auth_updated_at', 'auth_modtime', 'auth_last_refresh',
  'api_http_status', 'api_status_code', 'usage_allowed', 'usage_limit_reached',
  'usage_plan_type', 'usage_email', 'usage_remaining_ratio', 'usage_total', 'usage_used', 'usage_remaining', 'usage_limit_window_seconds',
  'usage_reset_at', 'usage_reset_after_seconds',
  'usage_spark_source', 'usage_spark_allowed', 'usage_spark_limit_reached', 'usage_spark_remaining_ratio',
  'usage_spark_total', 'usage_spark_used', 'usage_spark_remaining', 'usage_spark_limit_window_seconds',
  'usage_spark_reset_at', 'usage_spark_reset_after_seconds',
  'quota_signal_source', 'is_invalid_401', 'is_quota_limited', 'is_recovered',
  'probe_error_kind', 'probe_error_text', 'managed_reason',
  'last_action', 'last_action_status', 'last_action_error',
  'last_seen_at', 'last_probed_at', 'updated_at',
];

// D1 对单条 SQL 可绑定变量数量更敏感，历史清理使用更保守的分批大小，
// 避免 `DELETE ... IN (?, ?, ...)` 在数据量较大时触发 `too many SQL variables`。
const DELETE_CHUNK_SIZE = 50;
const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'cancelled'];
const HISTORY_RETENTION_DAYS = 1;
const ACTIVITY_LOG_RETENTION_DAYS = 1;
const HISTORY_RETENTION_PURGE_INTERVAL_MS = 10 * 60 * 1000;
let lastHistoricalPurgeAt = 0;

function parseStoredTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? raw.replace(' ', 'T') + 'Z'
    : raw;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function deleteRowsByIds(
  db: D1Database,
  table: string,
  idColumn: string,
  ids: number[]
): Promise<number> {
  if (ids.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += DELETE_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + DELETE_CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db
      .prepare(`DELETE FROM ${table} WHERE ${idColumn} IN (${placeholders})`)
      .bind(...chunk)
      .run();
    deleted += Number(result.meta.changes || 0);
  }
  return deleted;
}

function getCutoffTimestamp(keepDays: number): number {
  const dayMillis = 24 * 60 * 60 * 1000;
  const chinaOffsetMillis = 8 * 60 * 60 * 1000;
  const nowUtcMillis = Date.now();
  const chinaNowMillis = nowUtcMillis + chinaOffsetMillis;
  const chinaTodayStartMillis = Math.floor(chinaNowMillis / dayMillis) * dayMillis;
  const retainedWindowStartMillis = chinaTodayStartMillis - (keepDays - 1) * dayMillis;
  return retainedWindowStartMillis - chinaOffsetMillis;
}

async function purgeHistoricalRetention(db: D1Database): Promise<void> {
  await Promise.all([
    clearScanRunsOlderThanDays(db, HISTORY_RETENTION_DAYS),
    clearFinishedTasksOlderThanDays(db, HISTORY_RETENTION_DAYS),
    clearActivityLogOlderThanDays(db, ACTIVITY_LOG_RETENTION_DAYS),
  ]);
}

async function maybePurgeHistoricalRetention(
  db: D1Database,
  opts: { force?: boolean } = {}
): Promise<void> {
  const now = Date.now();
  if (!opts.force && now - lastHistoricalPurgeAt < HISTORY_RETENTION_PURGE_INTERVAL_MS) {
    return;
  }
  lastHistoricalPurgeAt = now;
  try {
    await purgeHistoricalRetention(db);
  } catch {
    // 历史清理是尽力而为，不能影响主流程
  }
}

export async function upsertAuthAccounts(
  db: D1Database,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;

  // D1 batch limit: process in chunks of 50
  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const stmts = chunk.map((row) => {
      const cols = AUTH_ACCOUNT_COLUMNS;
      const placeholders = cols.map(() => '?').join(', ');
      const updates = cols
        .filter((c) => c !== 'name')
        .map((c) => `${c} = excluded.${c}`)
        .join(', ');
      const values = cols.map((c) => row[c] ?? null);
      return db
        .prepare(
          `INSERT INTO auth_accounts (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(name) DO UPDATE SET ${updates}`
        )
        .bind(...values);
    });
    await db.batch(stmts);
  }
}

export async function loadExistingState(
  db: D1Database
): Promise<Map<string, Record<string, unknown>>> {
  const result = await db.prepare('SELECT * FROM auth_accounts').all();
  const map = new Map<string, Record<string, unknown>>();
  for (const row of result.results) {
    const r = row as Record<string, unknown>;
    map.set(String(r.name), r);
  }
  return map;
}

export async function startScanRun(
  db: D1Database,
  mode: string,
  settings: Record<string, unknown>
): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO scan_runs (mode, started_at, status, total_files, filtered_files, probed_files, invalid_401_count, quota_limited_count, recovered_count, delete_401, quota_action, probe_workers, action_workers, timeout_seconds, retries) VALUES (?, ?, 'running', 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      mode,
      now,
      settings.delete_401 ? 1 : 0,
      String(settings.quota_action ?? 'disable'),
      Number(settings.probe_workers ?? 100),
      Number(settings.action_workers ?? 100),
      Number(settings.timeout ?? 15),
      Number(settings.retries ?? 3)
    )
    .run();
  return result.meta.last_row_id as number;
}

export async function finishScanRun(
  db: D1Database,
  runId: number,
  data: {
    status: string;
    total_files: number;
    filtered_files: number;
    probed_files: number;
    invalid_401_count: number;
    quota_limited_count: number;
    recovered_count: number;
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE scan_runs SET finished_at = ?, status = ?, total_files = ?, filtered_files = ?, probed_files = ?, invalid_401_count = ?, quota_limited_count = ?, recovered_count = ? WHERE run_id = ?`
    )
    .bind(
      new Date().toISOString(),
      data.status,
      data.total_files,
      data.filtered_files,
      data.probed_files,
      data.invalid_401_count,
      data.quota_limited_count,
      data.recovered_count,
      runId
    )
    .run();
  await maybePurgeHistoricalRetention(db);
}

export async function getLastScanRun(db: D1Database): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare('SELECT * FROM scan_runs ORDER BY run_id DESC LIMIT 1')
    .first();
  return row as Record<string, unknown> | null;
}

export async function getScanRuns(
  db: D1Database,
  limit = 20,
  offset = 0
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const countRow = await db.prepare('SELECT COUNT(*) as cnt FROM scan_runs').first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;
  const result = await db
    .prepare('SELECT * FROM scan_runs ORDER BY run_id DESC LIMIT ? OFFSET ?')
    .bind(limit, offset)
    .all();
  return { rows: result.results as Record<string, unknown>[], total };
}

export async function clearScanRuns(db: D1Database): Promise<number> {
  const result = await db.prepare('DELETE FROM scan_runs').run();
  return Number(result.meta.changes || 0);
}

export async function clearScanRunsOlderThanDays(
  db: D1Database,
  keepDays: number
): Promise<number> {
  const cutoff = getCutoffTimestamp(keepDays);
  const rows = await db
    .prepare('SELECT run_id, finished_at, started_at FROM scan_runs')
    .all<{ run_id: number; finished_at: string | null; started_at: string | null }>();
  const ids = rows.results
    .filter((row) => {
      const timestamp = parseStoredTime(row.finished_at) ?? parseStoredTime(row.started_at);
      return timestamp != null && timestamp < cutoff;
    })
    .map((row) => Number(row.run_id))
    .filter((id) => Number.isFinite(id));
  return deleteRowsByIds(db, 'scan_runs', 'run_id', ids);
}

export async function getAccounts(
  db: D1Database,
  opts: {
    limit?: number;
    offset?: number;
    filter?: string;
    sort?: string;
    order?: 'asc' | 'desc';
    type?: string;
    provider?: string;
    status_filter?: string;
  } = {}
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.type) {
    conditions.push('type = ?');
    params.push(opts.type);
  }
  if (opts.provider) {
    conditions.push('provider = ?');
    params.push(opts.provider);
  }
  if (opts.filter) {
    conditions.push('(name LIKE ? OR email LIKE ? OR account LIKE ?)');
    const like = `%${opts.filter}%`;
    params.push(like, like, like);
  }
  if (opts.status_filter) {
    switch (opts.status_filter) {
      case 'active':
        conditions.push("disabled = 0 AND is_invalid_401 = 0 AND is_quota_limited = 0 AND (probe_error_kind IS NULL OR probe_error_kind = '')");
        break;
      case 'disabled':
        conditions.push('disabled = 1');
        break;
      case 'invalid_401':
        conditions.push('is_invalid_401 = 1');
        break;
      case 'quota_limited':
        conditions.push('is_quota_limited = 1');
        break;
      case 'recovered':
        conditions.push('is_recovered = 1');
        break;
      case 'probe_error':
        conditions.push("probe_error_kind IS NOT NULL AND probe_error_kind != ''");
        break;
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortCol = opts.sort || 'updated_at';
  const sortOrder = opts.order || 'desc';
  const sortExprMap: Record<string, string> = {
    updated_at: 'updated_at',
    name: 'name',
    email: 'email',
    provider: 'provider',
    api_status_code: 'api_status_code',
    last_probed_at: 'last_probed_at',
    status_sort: `
      CASE
        WHEN disabled = 1 AND is_invalid_401 = 1 THEN 70
        WHEN is_invalid_401 = 1 THEN 60
        WHEN disabled = 1 AND is_quota_limited = 1 THEN 50
        WHEN is_quota_limited = 1 THEN 40
        WHEN disabled = 1 AND is_recovered = 1 THEN 35
        WHEN is_recovered = 1 THEN 30
        WHEN disabled = 1 THEN 20
        WHEN probe_error_kind IS NOT NULL AND probe_error_kind != '' THEN 10
        ELSE 0
      END
    `,
    quota_sort: 'COALESCE(usage_remaining_ratio, -1)',
    quota_reset_sort: 'COALESCE(usage_reset_at, -1)',
    code_review_quota_sort: 'COALESCE(usage_spark_remaining_ratio, -1)',
    code_review_quota_reset_sort: 'COALESCE(usage_spark_reset_at, -1)',
  };
  const safeSort = sortExprMap[sortCol] || 'updated_at';
  const safeOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

  const countResult = await db
    .prepare(`SELECT COUNT(*) as cnt FROM auth_accounts ${where}`)
    .bind(...params)
    .first<{ cnt: number }>();
  const total = countResult?.cnt ?? 0;

  const limit = Math.min(opts.limit || 50, 500);
  const offset = opts.offset || 0;

  const result = await db
    .prepare(
      `SELECT * FROM auth_accounts ${where} ORDER BY ${safeSort} ${safeOrder}, updated_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, limit, offset)
    .all();

  return { rows: result.results as Record<string, unknown>[], total };
}

export async function getAccountByName(
  db: D1Database,
  name: string
): Promise<Record<string, unknown> | null> {
  const row = await db.prepare('SELECT * FROM auth_accounts WHERE name = ?').bind(name).first();
  return row as Record<string, unknown> | null;
}

export async function deleteAccountFromDB(db: D1Database, name: string): Promise<void> {
  await db.prepare('DELETE FROM auth_accounts WHERE name = ?').bind(name).run();
}

export async function deleteAccountsFromDB(
  db: D1Database,
  names: string[]
): Promise<number> {
  if (names.length === 0) return 0;

  const CHUNK = 200;
  let deleted = 0;
  for (let i = 0; i < names.length; i += CHUNK) {
    const chunk = names.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db
      .prepare(`DELETE FROM auth_accounts WHERE name IN (${placeholders})`)
      .bind(...chunk)
      .run();
    deleted += Number(result.meta.changes || 0);
  }

  return deleted;
}

export async function deleteAccountsNotInSet(
  db: D1Database,
  keepNames: string[]
): Promise<number> {
  if (keepNames.length === 0) {
    const result = await db.prepare('DELETE FROM auth_accounts').run();
    return Number(result.meta.changes || 0);
  }

  const CHUNK = 200;
  let deleted = 0;
  for (let i = 0; i < keepNames.length; i += CHUNK) {
    const chunk = keepNames.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    if (i === 0) {
      // delete all not in first chunk, then insert remaining chunks into temp keep set is overkill for local D1.
      // Simpler: rebuild by deleting stale names via separate query below.
    }
  }

  const existing = await db.prepare('SELECT name FROM auth_accounts').all<{ name: string }>();
  const keepSet = new Set(keepNames);
  const staleNames = existing.results.map((r) => r.name).filter((n) => !keepSet.has(n));
  if (staleNames.length === 0) return 0;

  for (let i = 0; i < staleNames.length; i += CHUNK) {
    const chunk = staleNames.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db.prepare(`DELETE FROM auth_accounts WHERE name IN (${placeholders})`).bind(...chunk).run();
    deleted += Number(result.meta.changes || 0);
  }
  return deleted;
}

export async function updateAccountDisabledState(
  db: D1Database,
  name: string,
  disabled: boolean
): Promise<void> {
  await db
    .prepare("UPDATE auth_accounts SET disabled = ?, updated_at = ?, managed_reason = ?, last_action = ?, last_action_status = 'success', last_action_error = NULL WHERE name = ?")
    .bind(
      disabled ? 1 : 0,
      new Date().toISOString(),
      disabled ? 'manual_disabled' : null,
      disabled ? 'manual_disable' : 'manual_enable',
      name
    )
    .run();
}

export async function getDashboardStats(db: D1Database): Promise<Record<string, unknown>> {
  const stats = await db.batch([
    db.prepare(`
      SELECT
        COUNT(*) AS total_accounts,
        SUM(CASE WHEN disabled = 0 AND is_invalid_401 = 0 AND is_quota_limited = 0 AND (probe_error_kind IS NULL OR probe_error_kind = '') THEN 1 ELSE 0 END) AS active_accounts,
        SUM(CASE WHEN disabled = 1 THEN 1 ELSE 0 END) AS disabled_accounts,
        SUM(CASE WHEN is_invalid_401 = 1 THEN 1 ELSE 0 END) AS invalid_401,
        SUM(CASE WHEN is_quota_limited = 1 THEN 1 ELSE 0 END) AS quota_limited,
        SUM(CASE WHEN is_recovered = 1 THEN 1 ELSE 0 END) AS recovered,
        SUM(CASE WHEN probe_error_kind IS NOT NULL AND probe_error_kind != '' THEN 1 ELSE 0 END) AS probe_errors
      FROM auth_accounts
    `),
    db.prepare('SELECT * FROM scan_runs ORDER BY run_id DESC LIMIT 1'),
    db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 10'),
    db.prepare(`
      SELECT
        MAX(CASE WHEN action = 'cron_maintain_started' THEN created_at END) AS cron_started,
        MAX(CASE WHEN action = 'cron_maintain_completed' THEN created_at END) AS cron_completed,
        MAX(CASE WHEN action = 'cron_maintain_failed' THEN created_at END) AS cron_failed
      FROM activity_log
    `),
  ]);

  const aggregateRow = ((stats[0].results as Record<string, unknown>[])[0] ?? {}) as Record<string, unknown>;

  const cronRow = ((stats[3].results as Record<string, unknown>[])[0] ?? {}) as Record<string, unknown>;
  const cronStarted = (cronRow.cron_started as string | undefined) ?? null;
  const cronCompleted = (cronRow.cron_completed as string | undefined) ?? null;
  const cronFailed = (cronRow.cron_failed as string | undefined) ?? null;

  const parseDbTime = (value: string | null): number | null => {
    if (!value) return null;
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? value.replace(' ', 'T') + 'Z'
      : value;
    const timestamp = Date.parse(normalized);
    return Number.isFinite(timestamp) ? timestamp : null;
  };

  const cronStartedMs = parseDbTime(cronStarted);
  const cronCompletedMs = parseDbTime(cronCompleted);
  const cronFailedMs = parseDbTime(cronFailed);

  let cronDurationSeconds: number | null = null;
  if (cronStartedMs != null && cronCompletedMs != null && cronCompletedMs >= cronStartedMs) {
    cronDurationSeconds = Math.round((cronCompletedMs - cronStartedMs) / 1000);
  }

  let cronStatus: 'success' | 'failed' | 'running' | 'never' = 'never';
  const latestCronEvent = Math.max(
    cronStartedMs ?? Number.NEGATIVE_INFINITY,
    cronCompletedMs ?? Number.NEGATIVE_INFINITY,
    cronFailedMs ?? Number.NEGATIVE_INFINITY
  );
  if (latestCronEvent !== Number.NEGATIVE_INFINITY) {
    if (cronCompletedMs != null && latestCronEvent === cronCompletedMs) {
      cronStatus = 'success';
    } else if (cronFailedMs != null && latestCronEvent === cronFailedMs) {
      cronStatus = 'failed';
    } else if (cronStartedMs != null) {
      cronStatus = 'running';
    }
  }

  return {
    total_accounts: Number(aggregateRow.total_accounts ?? 0),
    active_accounts: Number(aggregateRow.active_accounts ?? 0),
    disabled_accounts: Number(aggregateRow.disabled_accounts ?? 0),
    invalid_401: Number(aggregateRow.invalid_401 ?? 0),
    quota_limited: Number(aggregateRow.quota_limited ?? 0),
    recovered: Number(aggregateRow.recovered ?? 0),
    probe_errors: Number(aggregateRow.probe_errors ?? 0),
    last_scan: (stats[1].results as Record<string, unknown>[])[0] ?? null,
    recent_activity: stats[2].results as Record<string, unknown>[],
    cron_summary: {
      last_started_at: cronStarted,
      last_completed_at: cronCompleted,
      last_duration_seconds: cronDurationSeconds,
      last_status: cronStatus,
    },
  };
}

export async function logActivity(
  db: D1Database,
  action: string,
  detail: string,
  username?: string
): Promise<void> {
  await db
    .prepare('INSERT INTO activity_log (action, detail, username) VALUES (?, ?, ?)')
    .bind(action, detail, username ?? null)
    .run();
  await maybePurgeHistoricalRetention(db);
}

export async function getAccountsMetaSummary(
  db: D1Database
): Promise<{ latest_probed_at: string; latest_updated_at: string }> {
  const row = await db
    .prepare(`
      SELECT
        COALESCE(MAX(last_probed_at), '') AS latest_probed_at,
        COALESCE(MAX(updated_at), '') AS latest_updated_at
      FROM auth_accounts
    `)
    .first<{ latest_probed_at: string; latest_updated_at: string }>();

  return {
    latest_probed_at: String(row?.latest_probed_at || '').trim(),
    latest_updated_at: String(row?.latest_updated_at || '').trim(),
  };
}

export async function getActivityLog(
  db: D1Database,
  limit = 50,
  offset = 0
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const countRow = await db.prepare('SELECT COUNT(*) as cnt FROM activity_log').first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;
  const result = await db
    .prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ? OFFSET ?')
    .bind(limit, offset)
    .all();
  return { rows: result.results as Record<string, unknown>[], total };
}

export async function clearActivityLog(db: D1Database): Promise<number> {
  const result = await db.prepare('DELETE FROM activity_log').run();
  return Number(result.meta.changes || 0);
}

export async function clearActivityLogOlderThanDays(
  db: D1Database,
  keepDays: number
): Promise<number> {
  const cutoff = getCutoffTimestamp(keepDays);
  const rows = await db
    .prepare('SELECT id, created_at FROM activity_log')
    .all<{ id: number; created_at: string | null }>();
  const ids = rows.results
    .filter((row) => {
      const timestamp = parseStoredTime(row.created_at);
      return timestamp != null && timestamp < cutoff;
    })
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id));
  return deleteRowsByIds(db, 'activity_log', 'id', ids);
}

export async function getTaskById(db: D1Database, id: number): Promise<Record<string, unknown> | null> {
  return (await db.prepare('SELECT * FROM task_queue WHERE id = ?').bind(id).first()) as Record<string, unknown> | null;
}

export async function getTaskControlState(
  db: D1Database,
  id: number
): Promise<{ id: number; type: string; status: string; cancel_requested: number; cancel_reason: string | null } | null> {
  return (await db
    .prepare('SELECT id, type, status, cancel_requested, cancel_reason FROM task_queue WHERE id = ?')
    .bind(id)
    .first()) as {
      id: number;
      type: string;
      status: string;
      cancel_requested: number;
      cancel_reason: string | null;
    } | null;
}

export async function createTask(
  db: D1Database,
  type: string,
  params: Record<string, unknown> = {}
): Promise<number> {
  const result = await db
    .prepare("INSERT INTO task_queue (type, status, params) VALUES (?, 'pending', ?)")
    .bind(type, JSON.stringify(params))
    .run();
  return result.meta.last_row_id as number;
}

export async function updateTask(
  db: D1Database,
  id: number,
  data: Record<string, unknown>
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(data)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return;
  vals.push(id);
  await db.prepare(`UPDATE task_queue SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  await maybePurgeHistoricalRetention(db);
}

export async function getRecentTasks(
  db: D1Database,
  limit = 20
): Promise<Record<string, unknown>[]> {
  const result = await db
    .prepare('SELECT * FROM task_queue ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all();
  return result.results as Record<string, unknown>[];
}

export async function clearFinishedTasks(db: D1Database): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM task_queue WHERE status IN (${TERMINAL_TASK_STATUSES.map((status) => `'${status}'`).join(', ')})`)
    .run();
  return Number(result.meta.changes || 0);
}

export async function clearFinishedTasksOlderThanDays(
  db: D1Database,
  keepDays: number
): Promise<number> {
  const cutoff = getCutoffTimestamp(keepDays);
  const rows = await db
    .prepare(`SELECT id, finished_at, created_at FROM task_queue WHERE status IN (${TERMINAL_TASK_STATUSES.map((status) => `'${status}'`).join(', ')})`)
    .all<{ id: number; finished_at: string | null; created_at: string | null }>();
  const ids = rows.results
    .filter((row) => {
      const timestamp = parseStoredTime(row.finished_at) ?? parseStoredTime(row.created_at);
      return timestamp != null && timestamp < cutoff;
    })
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id));
  return deleteRowsByIds(db, 'task_queue', 'id', ids);
}

export async function requestTaskCancellation(
  db: D1Database,
  id: number,
  reason: string
): Promise<{
  found: boolean;
  status: string | null;
  type: string | null;
  cancel_requested: boolean;
  cancelled_immediately: boolean;
}> {
  const task = await getTaskControlState(db, id);
  if (!task) {
    return {
      found: false,
      status: null,
      type: null,
      cancel_requested: false,
      cancelled_immediately: false,
    };
  }

  const status = String(task.status || '').trim().toLowerCase();
  if (status === 'cancelled') {
    return {
      found: true,
      status: 'cancelled',
      type: String(task.type || ''),
      cancel_requested: true,
      cancelled_immediately: false,
    };
  }

  if (status === 'completed' || status === 'failed') {
    return {
      found: true,
      status,
      type: String(task.type || ''),
      cancel_requested: false,
      cancelled_immediately: false,
    };
  }

  const now = new Date().toISOString();
  if (status === 'pending') {
    await updateTask(db, id, {
      status: 'cancelled',
      cancel_requested: 1,
      cancel_requested_at: now,
      cancel_reason: reason,
      error: reason,
      finished_at: now,
    });
    return {
      found: true,
      status: 'cancelled',
      type: String(task.type || ''),
      cancel_requested: true,
      cancelled_immediately: true,
    };
  }

  await updateTask(db, id, {
    cancel_requested: 1,
    cancel_requested_at: now,
    cancel_reason: reason,
  });
  return {
    found: true,
    status,
    type: String(task.type || ''),
    cancel_requested: true,
    cancelled_immediately: false,
  };
}

export async function markTaskCancelled(
  db: D1Database,
  id: number,
  reason: string,
  result?: string | null
): Promise<void> {
  const now = new Date().toISOString();
  await updateTask(db, id, {
    status: 'cancelled',
    cancel_requested: 1,
    cancel_requested_at: now,
    cancel_reason: reason,
    error: reason,
    finished_at: now,
    ...(result !== undefined ? { result } : {}),
  });
}
