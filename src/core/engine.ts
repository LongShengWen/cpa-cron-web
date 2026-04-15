/**
 * Async engine: scan / maintain / upload / refill.
 * Designed for CF Workers — all heavy work runs in batches,
 * each batch writes to D1 + updates task progress so the
 * frontend can poll in real-time.
 *
 * Batch size & concurrency are kept low to stay within
 * CF Workers CPU-time limits even for 500+ accounts.
 */

import type { AppConfig } from '../types';
import {
  fetchAuthFiles,
  probeWhamUsage,
  buildAuthRecord,
  matchesFilters,
  deleteAccount,
  setAccountDisabled,
  uploadAuthFile,
  runWithConcurrency,
  countValidAccounts,
} from './cpa-client';
import {
  upsertAuthAccounts,
  loadExistingState,
  startScanRun,
  finishScanRun,
  getTaskControlState,
  logActivity,
  markTaskCancelled,
  updateTask,
  deleteAccountsFromDB,
  deleteAccountsNotInSet,
} from './db';
import { loadProbeCursor, saveCacheMeta, saveProbeCursor } from './config';

// ── constants ────────────────────────────────────────────────────────

const PROBE_BATCH_SIZE = 15;   // accounts per batch
const DEFAULT_PROBE_CONCURRENCY = 5;   // parallel fetches inside a batch
const ACTION_BATCH_SIZE = 20;
const DEFAULT_ACTION_CONCURRENCY = 5;
const UPLOAD_BATCH_SIZE = 10;
const DEFAULT_UPLOAD_CONCURRENCY = 5;
const MAX_PROBE_CONCURRENCY = 12;
const MAX_ACTION_CONCURRENCY = 10;
const MAX_UPLOAD_CONCURRENCY = 8;
const MAX_SCAN_PROBE_RECORDS_PER_RUN = 25;
const MAX_MANUAL_MAINTAIN_PROBE_RECORDS_PER_RUN = 6;
const MAX_CRON_MAINTAIN_PROBE_RECORDS_PER_RUN = 10;
const DEFAULT_SCAN_PROBE_CURSOR_KEY = 'scan_probe_cursor';
const DEFAULT_MAINTAIN_PROBE_CURSOR_KEY = 'maintain_probe_cursor';

// ── helpers ──────────────────────────────────────────────────────────

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function boundedConcurrency(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.max(1, Math.floor(value)), max);
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.max(1, Math.floor(value));
}

function selectRotatingRecords<T>(
  records: T[],
  limit: number,
  cursor: number
): {
  selected: T[];
  start: number;
  nextCursor: number;
  partial: boolean;
} {
  const total = records.length;
  if (total === 0) {
    return { selected: [], start: 0, nextCursor: 0, partial: false };
  }

  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (total <= normalizedLimit) {
    return { selected: records.slice(), start: 0, nextCursor: 0, partial: false };
  }

  const start = cursor % total;
  const selected: T[] = [];
  for (let i = 0; i < normalizedLimit; i++) {
    selected.push(records[(start + i) % total]);
  }
  return {
    selected,
    start,
    nextCursor: (start + normalizedLimit) % total,
    partial: true,
  };
}

function summarizeActionResults(results: Array<{ name: string; ok: boolean; error: string | null }>): {
  total: number;
  success: number;
  failed: number;
  successNames: string[];
  failedItems: Array<{ name: string; error: string | null }>;
} {
  const successItems = results.filter((result) => result.ok);
  const failedItems = results
    .filter((result) => !result.ok)
    .map((result) => ({ name: result.name, error: result.error }));
  return {
    total: results.length,
    success: successItems.length,
    failed: failedItems.length,
    successNames: successItems.map((result) => result.name),
    failedItems,
  };
}

function formatActionSummaryDetail(
  label: string,
  summary: ReturnType<typeof summarizeActionResults>,
  extraParts: string[] = []
): string {
  const parts = [
    `${label}: 总计=${summary.total}`,
    `成功=${summary.success}`,
    `失败=${summary.failed}`,
    ...extraParts.filter(Boolean),
  ];

  if (summary.successNames.length > 0) {
    parts.push(`成功账号=${summary.successNames.slice(0, 20).join(', ')}`);
  }
  if (summary.failedItems.length > 0) {
    parts.push(
      `失败账号=${summary.failedItems
        .slice(0, 20)
        .map((item) => `${item.name}${item.error ? `(${item.error})` : ''}`)
        .join(', ')}`
    );
  }

  return parts.join(' | ');
}

async function logActionResults(
  db: D1Database,
  action: string,
  results: Array<{ name: string; ok: boolean; status_code?: number | null; error: string | null; attempts?: number; disabled?: boolean }>,
  username?: string,
  options?: { logSuccesses?: boolean }
): Promise<void> {
  const logSuccesses = options?.logSuccesses !== false;
  for (const result of results) {
    if (result.ok && !logSuccesses) continue;
    const detail = [
      result.ok ? '成功' : '失败',
      `账号=${result.name}`,
      result.status_code != null ? `HTTP=${result.status_code}` : '',
      result.attempts != null ? `尝试=${result.attempts}` : '',
      typeof result.disabled === 'boolean' ? `disabled=${result.disabled ? 1 : 0}` : '',
      result.error ? `错误=${result.error}` : '',
    ].filter(Boolean).join(' | ');
    await logActivity(db, action, detail, username);
  }
}

export interface EngineResult {
  success: boolean;
  total_files: number;
  filtered_count: number;
  probed_count: number;
  invalid_401_count: number;
  quota_limited_count: number;
  recovered_count: number;
  failure_count: number;
  actions?: {
    deleted_401: number;
    disabled_quota: number;
    deleted_quota: number;
    reenabled: number;
  };
  probe_scope?: {
    total_candidates: number;
    selected_count: number;
    partial: boolean;
    cursor_key?: string;
    next_cursor?: number;
  };
  probed_names?: string[];
  upload?: {
    uploaded: number;
    skipped: number;
    failed: number;
  };
  error?: string;
}

class TaskCancelledError extends Error {
  taskId: number;

  constructor(taskId: number, message = '用户手动停止任务') {
    super(message);
    this.name = 'TaskCancelledError';
    this.taskId = taskId;
  }
}

function buildCancelledResult(message: string): EngineResult {
  return {
    success: false,
    total_files: 0,
    filtered_count: 0,
    probed_count: 0,
    invalid_401_count: 0,
    quota_limited_count: 0,
    recovered_count: 0,
    failure_count: 0,
    error: message,
  };
}

async function ensureTaskNotCancelled(db: D1Database, taskId: number): Promise<void> {
  const task = await getTaskControlState(db, taskId);
  if (!task) {
    throw new TaskCancelledError(taskId, '任务不存在或已被移除');
  }

  const status = String(task.status || '').trim().toLowerCase();
  const cancelRequested = Number(task.cancel_requested || 0) === 1;
  if (status === 'cancelled' || cancelRequested) {
    throw new TaskCancelledError(taskId, String(task.cancel_reason || '用户手动停止任务'));
  }
}

async function finalizeTaskCancellation(
  db: D1Database,
  taskId: number,
  username: string | undefined,
  error: TaskCancelledError,
  result?: EngineResult
): Promise<EngineResult> {
  const current = await getTaskControlState(db, taskId);
  const type = String(current?.type || '');
  const message = error.message || '用户手动停止任务';
  const payload = JSON.stringify({
    ...(result || buildCancelledResult(message)),
    cancelled: true,
    success: false,
    error: message,
  });
  await markTaskCancelled(db, taskId, message, payload);
  await logActivity(
    db,
    'task_cancelled',
    `任务已停止: id=${taskId} type=${type || '-'} reason=${message}`,
    username
  );
  return result || buildCancelledResult(message);
}

// ── scan ─────────────────────────────────────────────────────────────

export async function runScan(
  db: D1Database,
  config: AppConfig,
  taskId: number,
  username?: string,
  options?: { finalizeTask?: boolean; maxProbeRecords?: number; cursorKey?: string }
): Promise<EngineResult> {
  const finalizeTask = options?.finalizeTask !== false;
  const cursorKey = (options?.cursorKey || DEFAULT_SCAN_PROBE_CURSOR_KEY).trim() || DEFAULT_SCAN_PROBE_CURSOR_KEY;
  const maxProbeRecords = normalizePositiveInt(options?.maxProbeRecords, MAX_SCAN_PROBE_RECORDS_PER_RUN);
  const runId = await startScanRun(db, 'scan', config as unknown as Record<string, unknown>);
  let totalFiles = 0;
  let filteredCount = 0;
  let probedFiles = 0;
  let invalidCount = 0;
  let quotaCount = 0;
  let recoveredCount = 0;
  let failureCount = 0;
  let probeNames: string[] = [];
  let probePartial = false;
  let nextProbeCursor = 0;

  try {
    await ensureTaskNotCancelled(db, taskId);

    // Phase 1 — fetch file list
    await updateTask(db, taskId, {
      status: 'running',
      started_at: new Date().toISOString(),
      result: JSON.stringify({ phase: 'fetching_files' }),
    });
    await ensureTaskNotCancelled(db, taskId);

    const nowIso = new Date().toISOString();
    const files = await fetchAuthFiles(config.base_url, config.token, config.timeout);
    totalFiles = files.length;
    const existingState = await loadExistingState(db);
    const probeConcurrency = boundedConcurrency(config.probe_workers, DEFAULT_PROBE_CONCURRENCY, MAX_PROBE_CONCURRENCY);

    const inventoryRecords: Record<string, unknown>[] = [];
    for (const item of files) {
      const r = item as Record<string, unknown>;
      const name = String(r.name ?? r.id ?? '').trim();
      if (!name) continue;
      inventoryRecords.push(buildAuthRecord(r, existingState.get(name) ?? null, nowIso));
    }
    const inventoryByName = new Map<string, Record<string, unknown>>();
    for (const record of inventoryRecords) {
      inventoryByName.set(String(record.name), record);
    }

    // Write inventory to DB immediately
    await upsertAuthAccounts(db, inventoryRecords);

    // Single-site cache mode: fully reconcile local cache with current remote inventory.
    // Any local accounts not present in the current remote auth-files list are stale and must be removed.
    const remoteNames = inventoryRecords.map((r) => String(r.name)).filter(Boolean);
    const deletedStaleCount = await deleteAccountsNotInSet(db, remoteNames);

    // Filter candidates
    const candidateRecords = inventoryRecords.filter((r) =>
      matchesFilters(r, config.target_type, config.provider)
    );

    const total = candidateRecords.length;
    filteredCount = total;
    const storedProbeCursor = (await loadProbeCursor(db, cursorKey)).cursor;
    const probeWindow = selectRotatingRecords(candidateRecords, maxProbeRecords, storedProbeCursor);
    const probeTargets = probeWindow.selected;
    probeNames = probeTargets.map((record) => String(record.name)).filter(Boolean);
    probePartial = probeWindow.partial;
    nextProbeCursor = probeWindow.nextCursor;
    await updateTask(db, taskId, {
      total,
      progress: 0,
      result: JSON.stringify({
        phase: 'probing',
        total_files: totalFiles,
        filtered: total,
        selected: probeTargets.length,
        partial: probePartial,
      }),
    });

    // Phase 2 — probe in batches
    let probed = 0;
    const batches = chunks(probeTargets, PROBE_BATCH_SIZE);

    for (const batch of batches) {
      await ensureTaskNotCancelled(db, taskId);
      const tasks = batch.map((record) => () =>
        probeWhamUsage(
          config.base_url,
          config.token,
          record,
          config.timeout,
          config.retries,
          config.user_agent,
          config.quota_disable_threshold
        )
      );
      const batchResults = await runWithConcurrency(tasks, probeConcurrency);

      // Merge results back and write this batch to DB immediately
      for (const probed_record of batchResults) {
        const name = String(probed_record.name);
        const original = inventoryByName.get(name);
        if (original) Object.assign(original, probed_record, { updated_at: new Date().toISOString() });
      }
      await upsertAuthAccounts(db, batchResults);

      probed += batch.length;
      probedFiles = probed;
      await updateTask(db, taskId, {
        progress: probed,
        result: JSON.stringify({
          phase: 'probing',
          probed,
          total_files: totalFiles,
          filtered: total,
          selected: probeTargets.length,
          partial: probePartial,
        }),
      });
    }

    // Phase 3 — classify
    const probeNameSet = new Set(probeNames);
    const currentCandidates = inventoryRecords.filter((r) =>
      probeNameSet.has(String(r.name))
    );
    const invalidRecords = currentCandidates.filter((r) => r.is_invalid_401 === 1);
    const quotaRecords = currentCandidates.filter((r) => r.is_quota_limited === 1);
    const recoveredRecords = currentCandidates.filter((r) => r.is_recovered === 1);
    const failureRecords = currentCandidates.filter((r) => r.probe_error_kind);
    probedFiles = currentCandidates.filter((r) => r.last_probed_at).length;
    invalidCount = invalidRecords.length;
    quotaCount = quotaRecords.length;
    recoveredCount = recoveredRecords.length;
    failureCount = failureRecords.length;

    await finishScanRun(db, runId, {
      status: 'success',
      total_files: totalFiles,
      filtered_files: total,
      probed_files: probedFiles,
      invalid_401_count: invalidRecords.length,
      quota_limited_count: quotaRecords.length,
      recovered_count: recoveredRecords.length,
    });

    await saveCacheMeta(db, {
      cache_base_url: config.base_url,
      cache_last_success_at: new Date().toISOString(),
      cache_last_status: 'success',
      cache_last_error: '',
    });
    await saveProbeCursor(db, cursorKey, nextProbeCursor);

    const engineResult: EngineResult = {
      success: true,
      total_files: totalFiles,
      filtered_count: total,
      probed_count: probedFiles,
      invalid_401_count: invalidRecords.length,
      quota_limited_count: quotaRecords.length,
      recovered_count: recoveredRecords.length,
      failure_count: failureCount,
      probe_scope: {
        total_candidates: total,
        selected_count: probeTargets.length,
        partial: probePartial,
        cursor_key: cursorKey,
        next_cursor: nextProbeCursor,
      },
      probed_names: probeNames,
    };

    if (finalizeTask) {
      await updateTask(db, taskId, {
        status: 'completed',
        progress: total,
        finished_at: new Date().toISOString(),
        result: JSON.stringify(engineResult),
      });
    }

    await logActivity(
      db,
      'scan',
      `扫描完成: 总计=${totalFiles} 候选=${total} 本次探测=${probeTargets.length} 401=${invalidRecords.length} 限额=${quotaRecords.length} 恢复=${recoveredRecords.length} 清理旧缓存=${deletedStaleCount}${probePartial ? ` | 已启用轮转探测 next_cursor=${nextProbeCursor}` : ''}`,
      username
    );

    return engineResult;
  } catch (e) {
    if (e instanceof TaskCancelledError) {
      await finishScanRun(db, runId, {
        status: 'cancelled',
        total_files: totalFiles,
        filtered_files: filteredCount,
        probed_files: probedFiles,
        invalid_401_count: invalidCount,
        quota_limited_count: quotaCount,
        recovered_count: recoveredCount,
      });
      if (finalizeTask) {
        return await finalizeTaskCancellation(db, taskId, username, e, {
          ...buildCancelledResult(e.message),
          total_files: totalFiles,
          filtered_count: filteredCount,
          probed_count: probedFiles,
          invalid_401_count: invalidCount,
          quota_limited_count: quotaCount,
          recovered_count: recoveredCount,
          failure_count: failureCount,
        });
      }
      throw e;
    }
    const errMsg = String(e);
    await finishScanRun(db, runId, {
      status: 'failed', total_files: 0, filtered_files: 0, probed_files: 0,
      invalid_401_count: 0, quota_limited_count: 0, recovered_count: 0,
    });
    await saveCacheMeta(db, {
      cache_last_status: 'failed',
      cache_last_error: errMsg,
    });
    if (finalizeTask) {
      await updateTask(db, taskId, {
        status: 'failed', finished_at: new Date().toISOString(), error: errMsg,
      });
    }
    return { success: false, total_files: 0, filtered_count: 0, probed_count: 0,
      invalid_401_count: 0, quota_limited_count: 0, recovered_count: 0, failure_count: 0, error: errMsg };
  }
}

// ── maintain ─────────────────────────────────────────────────────────

export async function runMaintain(
  db: D1Database,
  config: AppConfig,
  taskId: number,
  username?: string
): Promise<EngineResult> {
  try {
    await ensureTaskNotCancelled(db, taskId);

    // Phase 1: scan
    await updateTask(db, taskId, {
      status: 'running', started_at: new Date().toISOString(),
      result: JSON.stringify({ phase: 'scanning' }),
    });

    // Create a sub-task for scan progress tracking
    const maintainProbeLimit = username === 'system'
      ? MAX_CRON_MAINTAIN_PROBE_RECORDS_PER_RUN
      : MAX_MANUAL_MAINTAIN_PROBE_RECORDS_PER_RUN;
    const scanResult = await runScan(db, config, taskId, username, {
      finalizeTask: false,
      maxProbeRecords: maintainProbeLimit,
      cursorKey: DEFAULT_MAINTAIN_PROBE_CURSOR_KEY,
    });
    if (!scanResult.success) {
      await updateTask(db, taskId, {
        status: 'failed', finished_at: new Date().toISOString(), error: scanResult.error || 'scan failed',
      });
      return scanResult;
    }

    await ensureTaskNotCancelled(db, taskId);

    // Phase 2: actions
    await updateTask(db, taskId, {
      result: JSON.stringify({ phase: 'maintaining', scan: scanResult }),
    });

    const existingState = await loadExistingState(db);
    const probedNameSet = new Set((scanResult.probed_names || []).map((name) => String(name)).filter(Boolean));
    const candidateRecords = Array.from(existingState.values()).filter((r) =>
      matchesFilters(r, config.target_type, config.provider)
      && (probedNameSet.size === 0 || probedNameSet.has(String(r.name)))
    );
    const invalidRecords = candidateRecords.filter((r) => Number(r.is_invalid_401) === 1);
    const quotaRecords = candidateRecords.filter(
      (r) => Number(r.is_quota_limited) === 1 && Number(r.is_invalid_401) !== 1
    );
    const recoveredRecords = candidateRecords.filter((r) => Number(r.is_recovered) === 1);

    await logActivity(
      db,
      'maintain_started',
      `维护开始: 本次探测=${candidateRecords.length}/${scanResult.filtered_count} 401=${invalidRecords.length} 限额=${quotaRecords.length} 恢复候选=${recoveredRecords.length} quota_action=${config.quota_action} delete_401=${config.delete_401 ? 1 : 0} auto_reenable=${config.auto_reenable ? 1 : 0}${scanResult.probe_scope?.partial ? ` | 轮转探测 next_cursor=${scanResult.probe_scope.next_cursor ?? 0}` : ''}`,
      username
    );

    const deletedNames = new Set<string>();
    const nowIso = new Date().toISOString();
    const actionConcurrency = boundedConcurrency(config.action_workers, DEFAULT_ACTION_CONCURRENCY, MAX_ACTION_CONCURRENCY);
    const isCronRun = username === 'system';
    let deleted401 = 0, disabledQuota = 0, deletedQuota = 0, reenabled = 0;
    let deletedLocal = 0;

    // Delete 401 — in batches
    if (config.delete_401 && invalidRecords.length > 0) {
      const names = invalidRecords.map((r) => String(r.name)).filter(Boolean);
      for (const batch of chunks(names, ACTION_BATCH_SIZE)) {
        await ensureTaskNotCancelled(db, taskId);
        const tasks = batch.map((name) => () =>
          deleteAccount(config.base_url, config.token, name, config.timeout, config.delete_retries)
        );
        const results = await runWithConcurrency(tasks, actionConcurrency);
        await logActionResults(db, 'maintain_delete_401_account', results, username, { logSuccesses: !isCronRun });
        const updates: Record<string, unknown>[] = [];
        for (const result of results) {
          if (result.ok) { deletedNames.add(result.name); deleted401++; }
          const record = existingState.get(result.name);
          if (record) {
            record.last_action = 'delete_401';
            record.last_action_status = result.ok ? 'success' : 'failed';
            record.last_action_error = result.error;
            record.managed_reason = result.ok ? 'deleted_401' : (record.managed_reason ?? null);
            record.updated_at = nowIso;
            updates.push(record);
          }
        }
        await upsertAuthAccounts(db, updates);

        const deletedBatchNames = results.filter((result) => result.ok).map((result) => result.name);
        if (deletedBatchNames.length > 0) {
          deletedLocal += await deleteAccountsFromDB(db, deletedBatchNames);
          for (const name of deletedBatchNames) existingState.delete(name);
        }

        const summary = summarizeActionResults(results);
        await logActivity(
          db,
          'maintain_delete_401_batch',
          formatActionSummaryDetail('删除401批次', summary, [`本地删除=${deletedBatchNames.length}`]),
          username
        );
      }
    }

    // Quota action — in batches
    if (config.quota_action === 'disable') {
      const toDisable = quotaRecords.filter(
        (r) => !deletedNames.has(String(r.name)) && Number(r.disabled) !== 1
      );
      for (const batch of chunks(toDisable, ACTION_BATCH_SIZE)) {
        await ensureTaskNotCancelled(db, taskId);
        const tasks = batch.map((r) => () =>
          setAccountDisabled(config.base_url, config.token, String(r.name), true, config.timeout)
        );
        const results = await runWithConcurrency(tasks, actionConcurrency);
        await logActionResults(db, 'maintain_disable_quota_account', results, username, { logSuccesses: !isCronRun });
        const updates: Record<string, unknown>[] = [];
        for (const result of results) {
          if (result.ok) disabledQuota++;
          const record = existingState.get(result.name);
          if (record) {
            record.last_action = 'disable_quota';
            record.last_action_status = result.ok ? 'success' : 'failed';
            record.last_action_error = result.error;
            if (result.ok) {
              record.managed_reason = 'quota_disabled';
              record.disabled = 1;
              record.is_recovered = 0;
            }
            record.updated_at = nowIso;
            updates.push(record);
          }
        }
        await upsertAuthAccounts(db, updates);

        const summary = summarizeActionResults(results);
        await logActivity(
          db,
          'maintain_disable_quota_batch',
          formatActionSummaryDetail('禁用限额批次', summary),
          username
        );
      }
      // Mark already-disabled
      const alreadyDisabled = quotaRecords.filter(
        (r) => !deletedNames.has(String(r.name)) && Number(r.disabled) === 1
      );
      if (alreadyDisabled.length > 0) {
        await ensureTaskNotCancelled(db, taskId);
        const updates = alreadyDisabled.map((r) => ({
          ...r, managed_reason: 'quota_disabled', last_action: 'mark_quota_disabled',
          last_action_status: 'success', last_action_error: null, updated_at: nowIso,
        }));
        await upsertAuthAccounts(db, updates);
        await logActivity(
          db,
          'maintain_mark_quota_disabled',
          `标记已禁用限额账号: ${alreadyDisabled.map((row) => String(row.name)).slice(0, 20).join(', ')} | 数量=${alreadyDisabled.length}`,
          username
        );
      }
    } else {
      const toDelete = quotaRecords
        .filter((r) => !deletedNames.has(String(r.name)))
        .map((r) => String(r.name)).filter(Boolean);
      for (const batch of chunks(toDelete, ACTION_BATCH_SIZE)) {
        await ensureTaskNotCancelled(db, taskId);
        const tasks = batch.map((name) => () =>
          deleteAccount(config.base_url, config.token, name, config.timeout, config.delete_retries)
        );
        const results = await runWithConcurrency(tasks, actionConcurrency);
        await logActionResults(db, 'maintain_delete_quota_account', results, username, { logSuccesses: !isCronRun });
        const updates: Record<string, unknown>[] = [];
        for (const result of results) {
          if (result.ok) { deletedNames.add(result.name); deletedQuota++; }
          const record = existingState.get(result.name);
          if (record) {
            record.last_action = 'delete_quota';
            record.last_action_status = result.ok ? 'success' : 'failed';
            record.last_action_error = result.error;
            if (result.ok) record.managed_reason = 'quota_deleted';
            record.updated_at = nowIso;
            updates.push(record);
          }
        }
        await upsertAuthAccounts(db, updates);

        const deletedBatchNames = results.filter((result) => result.ok).map((result) => result.name);
        if (deletedBatchNames.length > 0) {
          deletedLocal += await deleteAccountsFromDB(db, deletedBatchNames);
          for (const name of deletedBatchNames) existingState.delete(name);
        }

        const summary = summarizeActionResults(results);
        await logActivity(
          db,
          'maintain_delete_quota_batch',
          formatActionSummaryDetail('删除限额批次', summary, [`本地删除=${deletedBatchNames.length}`]),
          username
        );
      }
    }

    // Re-enable recovered — in batches
    if (config.auto_reenable) {
      const scope = config.reenable_scope;
      const recoverable = scope === 'signal'
        ? recoveredRecords
        : recoveredRecords.filter((r) => String(r.managed_reason ?? '') === 'quota_disabled');
      const toReenable = recoverable
        .filter((r) => !deletedNames.has(String(r.name)))
        .map((r) => String(r.name)).filter(Boolean);
      for (const batch of chunks(toReenable, ACTION_BATCH_SIZE)) {
        await ensureTaskNotCancelled(db, taskId);
        const tasks = batch.map((name) => () =>
          setAccountDisabled(config.base_url, config.token, name, false, config.timeout)
        );
        const results = await runWithConcurrency(tasks, actionConcurrency);
        await logActionResults(db, 'maintain_reenable_account', results, username, { logSuccesses: !isCronRun });
        const updates: Record<string, unknown>[] = [];
        for (const result of results) {
          if (result.ok) reenabled++;
          const record = existingState.get(result.name);
          if (record) {
            record.last_action = 'reenable_quota';
            record.last_action_status = result.ok ? 'success' : 'failed';
            record.last_action_error = result.error;
            if (result.ok) {
              record.managed_reason = null;
              record.disabled = 0;
              record.is_recovered = 0;
              record.is_quota_limited = 0;
              record.probe_error_kind = null;
              record.probe_error_text = null;
            }
            record.updated_at = nowIso;
            updates.push(record);
          }
        }
        await upsertAuthAccounts(db, updates);

        const summary = summarizeActionResults(results);
        await logActivity(
          db,
          'maintain_reenable_batch',
          formatActionSummaryDetail('恢复启用批次', summary),
          username
        );
      }
    }

    await ensureTaskNotCancelled(db, taskId);

    const finalState = await loadExistingState(db);
    const finalCandidates = Array.from(finalState.values()).filter((r) =>
      matchesFilters(r, config.target_type, config.provider)
      && (probedNameSet.size === 0 || probedNameSet.has(String(r.name)))
    );
    const finalInvalidRecords = finalCandidates.filter((r) => Number(r.is_invalid_401) === 1);
    const finalQuotaRecords = finalCandidates.filter((r) => Number(r.is_quota_limited) === 1);
    const finalRecoveredRecords = finalCandidates.filter((r) => Number(r.is_recovered) === 1);
    const finalFailureRecords = finalCandidates.filter((r) => r.probe_error_kind);
    const finalProbedFiles = finalCandidates.filter((r) => r.last_probed_at).length;

    const maintainRunId = await startScanRun(db, 'maintain', config as unknown as Record<string, unknown>);
    await finishScanRun(db, maintainRunId, {
      status: 'success',
      total_files: scanResult.total_files,
      filtered_files: scanResult.filtered_count,
      probed_files: finalProbedFiles,
      invalid_401_count: finalInvalidRecords.length,
      quota_limited_count: finalQuotaRecords.length,
      recovered_count: finalRecoveredRecords.length,
    });

    const engineResult: EngineResult = {
      success: true,
      total_files: scanResult.total_files,
      filtered_count: scanResult.filtered_count,
      probed_count: finalProbedFiles,
      invalid_401_count: finalInvalidRecords.length,
      quota_limited_count: finalQuotaRecords.length,
      recovered_count: finalRecoveredRecords.length,
      failure_count: finalFailureRecords.length,
      actions: { deleted_401: deleted401, disabled_quota: disabledQuota, deleted_quota: deletedQuota, reenabled },
      probe_scope: scanResult.probe_scope,
      probed_names: scanResult.probed_names,
    };

    await updateTask(db, taskId, {
      status: 'completed', finished_at: new Date().toISOString(),
      result: JSON.stringify(engineResult),
    });

    await logActivity(db, 'maintain',
      `维护完成: 本次探测=${candidateRecords.length}/${scanResult.filtered_count} 删除401=${deleted401} 删除本地=${deletedLocal} 禁用限额=${disabledQuota} 删除限额=${deletedQuota} 恢复=${reenabled} 剩余401=${finalInvalidRecords.length} 剩余限额=${finalQuotaRecords.length}${scanResult.probe_scope?.partial ? ` | 轮转探测 next_cursor=${scanResult.probe_scope.next_cursor ?? 0}` : ''}`,
      username
    );

    return engineResult;
  } catch (e) {
    if (e instanceof TaskCancelledError) {
      return await finalizeTaskCancellation(db, taskId, username, e);
    }
    const errMsg = String(e);
    await updateTask(db, taskId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: errMsg,
    });
    return {
      success: false,
      total_files: 0,
      filtered_count: 0,
      probed_count: 0,
      invalid_401_count: 0,
      quota_limited_count: 0,
      recovered_count: 0,
      failure_count: 0,
      error: errMsg,
    };
  }
}

// ── upload ────────────────────────────────────────────────────────────

export interface UploadFileItem {
  file_name: string;
  content: string;
}

export async function runUpload(
  db: D1Database,
  config: AppConfig,
  files: UploadFileItem[],
  taskId: number,
  username?: string
): Promise<EngineResult> {
  let uploaded = 0, skipped = 0, failed = 0;
  const uploadConcurrency = boundedConcurrency(config.upload_workers, DEFAULT_UPLOAD_CONCURRENCY, MAX_UPLOAD_CONCURRENCY);

  try {
    await ensureTaskNotCancelled(db, taskId);

    // Check remote duplicates
    const remoteNames = new Set<string>();
    if (!config.upload_force) {
      try {
        const remoteFiles = await fetchAuthFiles(config.base_url, config.token, config.timeout);
        for (const f of remoteFiles) {
          const name = String((f as Record<string, unknown>).name ?? '').trim();
          if (name) remoteNames.add(name);
        }
      } catch { /* proceed anyway */ }
    }

    const candidates = files.filter((f) => {
      if (!config.upload_force && remoteNames.has(f.file_name)) { skipped++; return false; }
      return true;
    });

    await updateTask(db, taskId, {
      total: candidates.length, progress: 0, status: 'running',
      started_at: new Date().toISOString(),
      result: JSON.stringify({ phase: 'uploading', total: candidates.length, skipped }),
    });

    let processed = 0;
    for (const batch of chunks(candidates, UPLOAD_BATCH_SIZE)) {
      await ensureTaskNotCancelled(db, taskId);
      const tasks = batch.map((file) => async () => {
        const result = await uploadAuthFile(
          config.base_url, config.token, file.file_name, file.content,
          config.upload_method, config.timeout, config.upload_retries
        );
        if (result.ok) uploaded++; else failed++;
        return result;
      });
      await runWithConcurrency(tasks, uploadConcurrency);
      processed += batch.length;
      await updateTask(db, taskId, {
        progress: processed,
        result: JSON.stringify({ phase: 'uploading', uploaded, skipped, failed, processed }),
      });
    }

    const engineResult: EngineResult = {
      success: failed === 0,
      total_files: files.length, filtered_count: candidates.length,
      probed_count: 0, invalid_401_count: 0, quota_limited_count: 0,
      recovered_count: 0, failure_count: failed,
      upload: { uploaded, skipped, failed },
    };

    await updateTask(db, taskId, {
      status: failed === 0 ? 'completed' : 'failed',
      finished_at: new Date().toISOString(),
      result: JSON.stringify(engineResult),
    });

    await logActivity(db, 'upload', `上传完成: 成功=${uploaded} 跳过=${skipped} 失败=${failed}`, username);
    return engineResult;
  } catch (e) {
    if (e instanceof TaskCancelledError) {
      return await finalizeTaskCancellation(db, taskId, username, e, {
        ...buildCancelledResult(e.message),
        total_files: files.length,
        filtered_count: Math.max(0, files.length - skipped),
        failure_count: failed,
        upload: { uploaded, skipped, failed },
      });
    }
    const errMsg = String(e);
    await updateTask(db, taskId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: errMsg,
    });
    return {
      success: false,
      total_files: files.length,
      filtered_count: 0,
      probed_count: 0,
      invalid_401_count: 0,
      quota_limited_count: 0,
      recovered_count: 0,
      failure_count: failed,
      upload: { uploaded, skipped, failed },
      error: errMsg,
    };
  }
}

// ── maintain-refill ──────────────────────────────────────────────────

export async function runMaintainRefill(
  db: D1Database,
  config: AppConfig,
  uploadFiles: UploadFileItem[],
  taskId: number,
  username?: string
): Promise<EngineResult> {
  const maintainResult = await runMaintain(db, config, taskId, username);
  if (!maintainResult.success) return maintainResult;

  const state = await loadExistingState(db);
  const candidates = Array.from(state.values()).filter((r) =>
    matchesFilters(r, config.target_type, config.provider)
  );
  const validCount = countValidAccounts(candidates);
  const minValid = config.min_valid_accounts;

  if (validCount >= minValid) {
    await logActivity(db, 'maintain-refill', `有效账号充足: valid=${validCount} >= min=${minValid}`, username);
    return maintainResult;
  }

  const gap = minValid - validCount;
  const uploadCount = config.refill_strategy === 'fixed' ? minValid : gap;
  const filesToUpload = uploadFiles.slice(0, uploadCount);

  if (filesToUpload.length === 0) {
    const res: EngineResult = {
      ...maintainResult,
      error: `有效账号不足: valid=${validCount} < min=${minValid}, 但无可上传文件`,
    };
    await updateTask(db, taskId, {
      status: 'completed', finished_at: new Date().toISOString(),
      result: JSON.stringify(res),
    });
    return res;
  }

  const uploadResult = await runUpload(db, config, filesToUpload, taskId, username);

  await logActivity(db, 'maintain-refill',
    `补充完成: valid_before=${validCount} uploaded=${uploadResult.upload?.uploaded ?? 0}`, username);

  return { ...maintainResult, upload: uploadResult.upload };
}
