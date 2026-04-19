import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import {
  handleLogin,
  handleLogout,
  handleChangePassword,
} from '../middleware/auth';
import { loadConfig, saveConfig, validateConfig, loadCacheMeta, loadCronMeta, saveCronMeta, validateCronExpression } from '../core/config';
import {
  getDashboardStats,
  getAccountsMetaSummary,
  getAccounts,
  getAccountByName,
  deleteAccountFromDB,
  updateAccountDisabledState,
  upsertAuthAccounts,
  getScanRuns,
  clearScanRuns,
  clearScanRunsOlderThanDays,
  getActivityLog,
  clearActivityLog,
  clearActivityLogOlderThanDays,
  logActivity,
  getRecentTasks,
  getTaskById,
  createTask,
  requestTaskCancellation,
  updateTask,
  clearFinishedTasks,
  clearFinishedTasksOlderThanDays,
} from '../core/db';
import { runScan, runMaintain, runUpload } from '../core/engine';
import type { UploadFileItem } from '../core/engine';
import { deleteAccount, setAccountDisabled, fetchAuthFiles, buildAuthRecord, probeWhamUsage } from '../core/cpa-client';

const api = new Hono<HonoEnv>();

function statusMessageIndicatesQuota(record: Record<string, unknown>): boolean {
  const raw = String(record.status_message ?? '').trim();
  if (!raw) return false;
  if (/usage_limit_reached/i.test(raw)) return true;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const directType = String(parsed.type ?? '').trim();
    if (directType === 'usage_limit_reached') return true;
    const errorObj = parsed.error;
    if (errorObj && typeof errorObj === 'object' && !Array.isArray(errorObj)) {
      return String((errorObj as Record<string, unknown>).type ?? '').trim() === 'usage_limit_reached';
    }
  } catch {
    // ignore non-json strings
  }
  return false;
}

function statusMessageIndicatesInvalid(record: Record<string, unknown>): boolean {
  const raw = String(record.status_message ?? '').trim();
  if (!raw) return false;
  return /(unauthorized|401|invalid token|token expired|expired|payment_required|not_found|invalidated|authentication token|sign(?:ed)? in again|signing in again|login again|log in again)/i.test(raw);
}

type SingleMaintainResult = {
  ok: boolean;
  name: string;
  action?: string;
  action_result?: Record<string, unknown> | null;
  removed?: boolean;
  account?: Record<string, unknown> | null;
  error?: string;
};

async function maintainAccountInternal(
  db: D1Database,
  config: Awaited<ReturnType<typeof loadConfig>>,
  username: string,
  name: string,
  existing: Record<string, unknown> | null,
  remoteItem: Record<string, unknown> | null
): Promise<SingleMaintainResult> {
  if (!existing) {
    return { ok: false, name, error: `本地未找到账号: ${name}` };
  }
  if (!remoteItem) {
    return { ok: false, name, error: `远端 CPA 当前未找到该账号: ${name}，建议先执行一次全量扫描` };
  }

  const nowIso = new Date().toISOString();
  const inventoryRecord = buildAuthRecord(remoteItem, existing, nowIso);
  await upsertAuthAccounts(db, [inventoryRecord]);

  const probedRecord = await probeWhamUsage(
    config.base_url,
    config.token,
    inventoryRecord,
    config.timeout,
    config.retries,
    config.user_agent,
    config.quota_disable_threshold
  );

  let workingRecord: Record<string, unknown> = { ...probedRecord, updated_at: new Date().toISOString() };
  let action = 'none';
  let actionResult: Record<string, unknown> | null = null;

  const invalid = Number(workingRecord.is_invalid_401 ?? 0) === 1 || statusMessageIndicatesInvalid(workingRecord);
  const quotaLimited = !invalid && (
    Number(workingRecord.is_quota_limited ?? 0) === 1 || statusMessageIndicatesQuota(workingRecord)
  );
  const recovered = Number(workingRecord.is_recovered ?? 0) === 1;

  if (invalid) {
    if (config.delete_401 && Number(workingRecord.api_status_code ?? 0) === 401) {
      action = 'delete_invalid';
      actionResult = await deleteAccount(config.base_url, config.token, name, config.timeout, config.delete_retries) as unknown as Record<string, unknown>;
      if (actionResult.ok) {
        await deleteAccountFromDB(db, name);
        await logActivity(db, 'maintain_single_account', `单账号维护删除401/失效账号: ${name}`, username);
        return {
          ok: true,
          name,
          action,
          action_result: actionResult,
          removed: true,
          account: null,
        };
      }
      workingRecord.last_action = 'delete_invalid';
      workingRecord.last_action_status = 'failed';
      workingRecord.last_action_error = String(actionResult.error ?? '删除失败');
    } else if (Number(workingRecord.disabled ?? 0) !== 1) {
      action = 'disable_invalid';
      actionResult = await setAccountDisabled(config.base_url, config.token, name, true, config.timeout) as unknown as Record<string, unknown>;
      workingRecord.last_action = 'disable_invalid';
      workingRecord.last_action_status = actionResult.ok ? 'success' : 'failed';
      workingRecord.last_action_error = actionResult.ok ? null : String(actionResult.error ?? '禁用失败');
      if (actionResult.ok) {
        workingRecord.disabled = 1;
        workingRecord.managed_reason = 'invalid_disabled';
        workingRecord.is_recovered = 0;
      }
    } else {
      action = 'mark_invalid_disabled';
      workingRecord.disabled = 1;
      workingRecord.managed_reason = 'invalid_disabled';
      workingRecord.is_recovered = 0;
      workingRecord.last_action = 'mark_invalid_disabled';
      workingRecord.last_action_status = 'success';
      workingRecord.last_action_error = null;
    }
  } else if (quotaLimited) {
    if (config.quota_action === 'delete') {
      action = 'delete_quota';
      actionResult = await deleteAccount(config.base_url, config.token, name, config.timeout, config.delete_retries) as unknown as Record<string, unknown>;
      if (actionResult.ok) {
        await deleteAccountFromDB(db, name);
        await logActivity(db, 'maintain_single_account', `单账号维护删除限额账号: ${name}`, username);
        return {
          ok: true,
          name,
          action,
          action_result: actionResult,
          removed: true,
          account: null,
        };
      }
      workingRecord.last_action = 'delete_quota';
      workingRecord.last_action_status = 'failed';
      workingRecord.last_action_error = String(actionResult.error ?? '删除失败');
    } else if (Number(workingRecord.disabled ?? 0) !== 1) {
      action = 'disable_quota';
      actionResult = await setAccountDisabled(config.base_url, config.token, name, true, config.timeout) as unknown as Record<string, unknown>;
      workingRecord.last_action = 'disable_quota';
      workingRecord.last_action_status = actionResult.ok ? 'success' : 'failed';
      workingRecord.last_action_error = actionResult.ok ? null : String(actionResult.error ?? '禁用失败');
      if (actionResult.ok) {
        workingRecord.disabled = 1;
        workingRecord.managed_reason = 'quota_disabled';
        workingRecord.is_recovered = 0;
      }
    } else {
      action = 'mark_quota_disabled';
      workingRecord.disabled = 1;
      workingRecord.managed_reason = 'quota_disabled';
      workingRecord.is_recovered = 0;
      workingRecord.last_action = 'mark_quota_disabled';
      workingRecord.last_action_status = 'success';
      workingRecord.last_action_error = null;
    }
  } else if (
    recovered &&
    config.auto_reenable &&
    Number(workingRecord.disabled ?? 0) === 1 &&
    (config.reenable_scope === 'signal' || String(workingRecord.managed_reason ?? '') === 'quota_disabled')
  ) {
    action = 'reenable';
    actionResult = await setAccountDisabled(config.base_url, config.token, name, false, config.timeout) as unknown as Record<string, unknown>;
    workingRecord.last_action = 'reenable_quota';
    workingRecord.last_action_status = actionResult.ok ? 'success' : 'failed';
    workingRecord.last_action_error = actionResult.ok ? null : String(actionResult.error ?? '启用失败');
    if (actionResult.ok) {
      workingRecord.disabled = 0;
      workingRecord.managed_reason = null;
      workingRecord.is_recovered = 0;
      workingRecord.is_quota_limited = 0;
      workingRecord.probe_error_kind = null;
      workingRecord.probe_error_text = null;
    }
  } else {
    action = 'refresh_only';
    workingRecord.last_action = 'maintain_single_probe';
    workingRecord.last_action_status = 'success';
    workingRecord.last_action_error = null;
  }

  workingRecord.updated_at = new Date().toISOString();
  await upsertAuthAccounts(db, [workingRecord]);

  const actionSummary = actionResult
    ? ` | 动作=${action} | 结果=${actionResult.ok ? '成功' : '失败'}${actionResult.error ? ` | 错误=${String(actionResult.error)}` : ''}`
    : ` | 动作=${action}`;
  await logActivity(
    db,
    'maintain_single_account',
    `单账号维护: ${name} | invalid=${invalid ? 1 : 0} | quota=${quotaLimited ? 1 : 0} | recovered=${recovered ? 1 : 0}${actionSummary}`,
    username
  );

  return {
    ok: true,
    name,
    action,
    action_result: actionResult,
    removed: false,
    account: workingRecord,
  };
}

function normalizeBatchNames(body: { names?: unknown }): string[] {
  if (!Array.isArray(body.names)) return [];
  const uniq = new Set<string>();
  for (const item of body.names) {
    const name = String(item ?? '').trim();
    if (name) uniq.add(name);
  }
  return Array.from(uniq);
}

// ── Auth ─────────────────────────────────────────────────────────────

api.post('/auth/login', handleLogin);
api.post('/auth/logout', handleLogout);
api.post('/auth/change-password', handleChangePassword);

api.get('/auth/me', async (c) => {
  const user = c.get('user') as Record<string, unknown>;
  return c.json({ ok: true, user: { username: user?.username, sub: user?.sub } });
});

// ── Dashboard ────────────────────────────────────────────────────────

api.get('/dashboard', async (c) => {
  const stats = await getDashboardStats(c.env.DB);
  const cron = await loadCronMeta(c.env.DB);
  const config = await loadConfig(c.env.DB, c.env);
  return c.json({ ...stats, cron: { ...cron, cron_enabled: config.cron_enabled } });
});

// ── Config ───────────────────────────────────────────────────────────

api.get('/config', async (c) => {
  const config = await loadConfig(c.env.DB, c.env);
  const cron = await loadCronMeta(c.env.DB);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    if (k === 'token') {
      out[k] = v ? '***' + String(v).slice(-6) : '';
    } else {
      out[k] = String(v);
    }
  }
  out.cron_expression = cron.cron_expression;
  return c.json(out);
});

api.put('/config', async (c) => {
  const body = await c.req.json();
  const cronExpressionRaw = typeof body.cron_expression === 'string' ? body.cron_expression.trim() : '';
  if ('cron_expression' in body) {
    delete body.cron_expression;
  }
  if (body.token && typeof body.token === 'string' && body.token.startsWith('***')) {
    delete body.token;
  }
  if (cronExpressionRaw) {
    const cronErrors = validateCronExpression(cronExpressionRaw);
    if (cronErrors.length > 0) {
      return c.json({ ok: false, error: cronErrors.join('；') }, 400);
    }
  }
  await saveConfig(c.env.DB, body);
  if (cronExpressionRaw) {
    await saveCronMeta(c.env.DB, { cron_expression: cronExpressionRaw });
  }
  if ('cron_enabled' in body) {
    const cronEnabled = ['true', '1', 'yes', 'on'].includes(String(body.cron_enabled).toLowerCase().trim());
    if (!cronEnabled) {
      await saveCronMeta(c.env.DB, {
        cron_last_result: 'disabled',
        cron_last_error: '定时任务已关闭',
      });
    } else {
      await saveCronMeta(c.env.DB, {
        cron_last_error: '',
      });
    }
  }
  const user = c.get('user') as Record<string, unknown>;
  await logActivity(
    c.env.DB,
    'config_update',
    [
      '配置已更新',
      cronExpressionRaw ? `cron_expression=${cronExpressionRaw}` : '',
      'cron_enabled' in body ? `cron_enabled=${String(body.cron_enabled)}` : '',
    ].filter(Boolean).join(' | '),
    String(user?.username ?? '')
  );
  return c.json({ ok: true });
});

api.get('/config/validate', async (c) => {
  const config = await loadConfig(c.env.DB, c.env);
  const errors = validateConfig(config);
  return c.json({ valid: errors.length === 0, errors });
});

api.post('/config/test', async (c) => {
  const config = await loadConfig(c.env.DB, c.env);
  let body: Record<string, string> = {};
  try { body = await c.req.json(); } catch { /* empty body is fine */ }
  const baseUrl = (body.base_url?.trim() || config.base_url || '').replace(/\/+$/, '');
  const token = body.token?.trim() || config.token || '';

  if (!baseUrl) return c.json({ ok: false, error: '请先配置 base_url' });
  if (!token) return c.json({ ok: false, error: '请先配置 token' });

  const targetUrl = `${baseUrl}/v0/management/auth-files`;
  try { new URL(targetUrl); } catch {
    return c.json({ ok: false, error: `base_url 格式无效: ${baseUrl}` });
  }

  const timeoutMs = Math.max(5, config.timeout || 15) * 1000;
  let resp: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      resp = await fetch(targetUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally { clearTimeout(timer); }
  } catch (e: unknown) {
    const errStr = String(e);
    if (errStr.includes('AbortError') || errStr.includes('abort'))
      return c.json({ ok: false, error: `连接超时 (${timeoutMs / 1000}s)，请检查 base_url 是否正确` });
    if (errStr.includes('internal error'))
      return c.json({ ok: false, error: `无法连接到目标服务器，请检查 base_url 是否正确、服务是否在线: ${baseUrl}` });
    return c.json({ ok: false, error: `连接失败: ${errStr.slice(0, 200)}` });
  }

  if (resp.status === 401 || resp.status === 403) {
    let detail = '';
    try { detail = await resp.text(); } catch { /* ignore */ }
    const lowered = detail.toLowerCase();

    if (lowered.includes('ip banned') || lowered.includes('too many failed attempts')) {
      const compact = detail.replace(/\s+/g, ' ').trim().slice(0, 240);
      return c.json({ ok: false, error: `当前出口 IP 已被风控封禁: ${compact || '请稍后再试'}` });
    }

    if (resp.status === 401) {
      return c.json({ ok: false, error: `认证失败 (HTTP 401)，请检查 token 是否正确${detail ? '，远端返回: ' + detail.slice(0, 160) : ''}` });
    }

    return c.json({ ok: false, error: `访问被拒绝 (HTTP 403)${detail ? '，远端返回: ' + detail.slice(0, 180) : '，请检查 token 权限或服务风控状态'}` });
  }
  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.text()).slice(0, 200); } catch { /* */ }
    return c.json({ ok: false, error: `HTTP ${resp.status}${detail ? ': ' + detail : ''}` });
  }
  try {
    const data = await resp.json() as Record<string, unknown>;
    const files = Array.isArray(data.files) ? data.files : [];
    return c.json({ ok: true, message: `连接成功! 共 ${files.length} 个认证文件` });
  } catch {
    return c.json({ ok: false, error: '返回内容不是有效 JSON' });
  }
});

// ── Accounts ─────────────────────────────────────────────────────────

api.get('/accounts', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const filter = c.req.query('filter') || '';
  const sort = c.req.query('sort') || 'updated_at';
  const order = (c.req.query('order') || 'desc') as 'asc' | 'desc';
  const type = c.req.query('type') || '';
  const provider = c.req.query('provider') || '';
  const status_filter = c.req.query('status') || '';
  const result = await getAccounts(c.env.DB, { limit, offset, filter, sort, order, type, provider, status_filter });
  return c.json(result);
});

api.get('/accounts/meta', async (c) => {
  const config = await loadConfig(c.env.DB, c.env);
  const cache = await loadCacheMeta(c.env.DB);
  const summary = await getAccountsMetaSummary(c.env.DB);
  return c.json({
    current_base_url: config.base_url,
    cache_base_url: cache.cache_base_url,
    cache_last_success_at: cache.cache_last_success_at,
    cache_last_status: cache.cache_last_status,
    cache_last_error: cache.cache_last_error,
    latest_probed_at: summary.latest_probed_at,
    latest_updated_at: summary.latest_updated_at,
    cache_matches_current: !!config.base_url && !!cache.cache_base_url && config.base_url === cache.cache_base_url,
  });
});

api.post('/accounts/batch/maintain', async (c) => {
  const body = await c.req.json<{ names?: string[] }>();
  const names = normalizeBatchNames(body);
  if (names.length === 0) return c.json({ ok: false, error: '请至少选择一个账号' }, 400);

  const config = await loadConfig(c.env.DB, c.env);
  if (!config.base_url || !config.token) {
    return c.json({ ok: false, error: 'CPA 配置不完整' }, 400);
  }

  const user = c.get('user') as Record<string, unknown>;
  const username = String(user?.username ?? '');

  try {
    const files = await fetchAuthFiles(config.base_url, config.token, config.timeout);
    const remoteMap = new Map<string, Record<string, unknown>>();
    for (const item of files) {
      const name = String((item as Record<string, unknown>).name ?? '').trim();
      if (name) remoteMap.set(name, item as Record<string, unknown>);
    }

    const results: SingleMaintainResult[] = [];
    for (const name of names) {
      const existing = await getAccountByName(c.env.DB, name);
      const remoteItem = remoteMap.get(name) ?? null;
      results.push(await maintainAccountInternal(c.env.DB, config, username, name, existing, remoteItem));
    }

    const success = results.filter((item) => item.ok).length;
    const failed = results.length - success;
    const removed = results.filter((item) => item.removed).length;
    const actions = results.reduce<Record<string, number>>((acc, item) => {
      const key = String(item.action ?? '');
      if (key) acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    await logActivity(
      c.env.DB,
      'maintain_batch_account',
      `批量维护账号: 总数=${results.length} 成功=${success} 失败=${failed} 删除=${removed}`,
      username
    );

    return c.json({ ok: true, total: results.length, success, failed, removed, actions, results });
  } catch (error) {
    return c.json({ ok: false, error: String(error) }, 500);
  }
});

api.post('/accounts/batch/toggle', async (c) => {
  const body = await c.req.json<{ names?: string[]; disabled?: boolean }>();
  const names = normalizeBatchNames(body);
  if (names.length === 0) return c.json({ ok: false, error: '请至少选择一个账号' }, 400);
  if (typeof body.disabled !== 'boolean') return c.json({ ok: false, error: 'disabled 参数无效' }, 400);

  const config = await loadConfig(c.env.DB, c.env);
  if (!config.base_url || !config.token) {
    return c.json({ ok: false, error: 'CPA 配置不完整' }, 400);
  }

  const user = c.get('user') as Record<string, unknown>;
  const username = String(user?.username ?? '');
  const results: Array<Record<string, unknown>> = [];

  for (const name of names) {
    const result = await setAccountDisabled(config.base_url, config.token, name, body.disabled, config.timeout) as unknown as Record<string, unknown>;
    if (result.ok) {
      await updateAccountDisabledState(c.env.DB, name, body.disabled);
    }
    results.push({ name, ...result });
  }

  const success = results.filter((item) => item.ok).length;
  const failed = results.length - success;
  await logActivity(
    c.env.DB,
    'toggle_batch_account',
    `批量${body.disabled ? '禁用' : '启用'}账号: 总数=${results.length} 成功=${success} 失败=${failed}`,
    username
  );

  return c.json({ ok: true, total: results.length, success, failed, results });
});

api.post('/accounts/batch/delete', async (c) => {
  const body = await c.req.json<{ names?: string[] }>();
  const names = normalizeBatchNames(body);
  if (names.length === 0) return c.json({ ok: false, error: '请至少选择一个账号' }, 400);

  const config = await loadConfig(c.env.DB, c.env);
  if (!config.base_url || !config.token) {
    return c.json({ ok: false, error: 'CPA 配置不完整' }, 400);
  }

  const user = c.get('user') as Record<string, unknown>;
  const username = String(user?.username ?? '');
  const results: Array<Record<string, unknown>> = [];

  for (const name of names) {
    const result = await deleteAccount(config.base_url, config.token, name, config.timeout, config.delete_retries) as unknown as Record<string, unknown>;
    if (result.ok) {
      await deleteAccountFromDB(c.env.DB, name);
    }
    results.push({ name, ...result });
  }

  const success = results.filter((item) => item.ok).length;
  const failed = results.length - success;
  await logActivity(
    c.env.DB,
    'delete_batch_account',
    `批量删除账号: 总数=${results.length} 成功=${success} 失败=${failed}`,
    username
  );

  return c.json({ ok: true, total: results.length, success, failed, results });
});

api.delete('/accounts/:name', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const config = await loadConfig(c.env.DB, c.env);
  if (!config.base_url || !config.token)
    return c.json({ error: 'CPA 配置不完整' }, 400);

  const result = await deleteAccount(config.base_url, config.token, name, config.timeout, config.delete_retries);
  if (result.ok) {
    await deleteAccountFromDB(c.env.DB, name);
    const user = c.get('user') as Record<string, unknown>;
    await logActivity(c.env.DB, 'delete_account', `删除账号: ${name}`, String(user?.username ?? ''));
  }
  return c.json(result);
});

api.post('/accounts/:name/toggle', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const body = await c.req.json<{ disabled: boolean }>();
  const config = await loadConfig(c.env.DB, c.env);
  if (!config.base_url || !config.token)
    return c.json({ error: 'CPA 配置不完整' }, 400);

  const result = await setAccountDisabled(config.base_url, config.token, name, body.disabled, config.timeout);
  if (result.ok) {
    await updateAccountDisabledState(c.env.DB, name, body.disabled);
    const user = c.get('user') as Record<string, unknown>;
    await logActivity(c.env.DB, 'toggle_account', `${body.disabled ? '禁用' : '启用'}账号: ${name}`, String(user?.username ?? ''));
  }
  return c.json(result);
});

api.post('/accounts/:name/maintain', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const config = await loadConfig(c.env.DB, c.env);
  if (!config.base_url || !config.token) {
    return c.json({ ok: false, error: 'CPA 配置不完整' }, 400);
  }

  const existing = await getAccountByName(c.env.DB, name);
  if (!existing) {
    return c.json({ ok: false, error: `本地未找到账号: ${name}` }, 404);
  }

  const user = c.get('user') as Record<string, unknown>;
  const username = String(user?.username ?? '');

  try {
    const files = await fetchAuthFiles(config.base_url, config.token, config.timeout);
    const remoteItem = files.find((item) => String((item as Record<string, unknown>).name ?? '').trim() === name) as Record<string, unknown> | undefined;
    const result = await maintainAccountInternal(c.env.DB, config, username, name, existing, remoteItem ?? null);
    return c.json(result, result.ok ? 200 : 404);
  } catch (error) {
    return c.json({ ok: false, error: String(error) }, 500);
  }
});

// ── Operations (async via waitUntil) ─────────────────────────────────

/** Helper: get ExecutionContext from c.executionCtx */
function getCtx(c: { executionCtx?: ExecutionContext | undefined }): ExecutionContext {
  if (c.executionCtx) return c.executionCtx;
  return {
    waitUntil(promise: Promise<unknown>) {
      void promise.catch((error) => {
        console.error('Background task failed:', error);
      });
    },
    passThroughOnException() {
      // Node/Docker runtime fallback: nothing to do.
    },
    props: undefined,
  } as ExecutionContext;
}

api.post('/operations/scan', async (c) => {
  const config = await loadConfig(c.env.DB, c.env);
  const errors = validateConfig(config);
  if (errors.length > 0)
    return c.json({ error: '配置验证失败', details: errors }, 400);

  const user = c.get('user') as Record<string, unknown>;
  const username = String(user?.username ?? '');
  const taskId = await createTask(c.env.DB, 'scan', { username });

  // Run in background — response returns immediately
  getCtx(c).waitUntil(runScan(c.env.DB, config, taskId, username));

  return c.json({ ok: true, task_id: taskId });
});

api.post('/operations/maintain', async (c) => {
  const config = await loadConfig(c.env.DB, c.env);
  const errors = validateConfig(config);
  if (errors.length > 0)
    return c.json({ error: '配置验证失败', details: errors }, 400);

  const user = c.get('user') as Record<string, unknown>;
  const username = String(user?.username ?? '');
  const taskId = await createTask(c.env.DB, 'maintain', { username });

  getCtx(c).waitUntil(runMaintain(c.env.DB, config, taskId, username));

  return c.json({ ok: true, task_id: taskId });
});

api.post('/operations/upload', async (c) => {
  const config = await loadConfig(c.env.DB, c.env);
  const errors = validateConfig(config);
  if (errors.length > 0)
    return c.json({ error: '配置验证失败', details: errors }, 400);

  const contentType = c.req.header('Content-Type') || '';
  let files: UploadFileItem[] = [];

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const entries = formData.getAll('files');
    for (const entry of entries) {
      if (typeof entry === 'object' && entry !== null && 'text' in entry) {
        const fileEntry = entry as unknown as { name: string; text(): Promise<string> };
        const text = await fileEntry.text();
        try { JSON.parse(text); } catch { continue; }
        files.push({ file_name: fileEntry.name, content: text });
      }
    }
  } else {
    const body = await c.req.json<{ files: UploadFileItem[] }>();
    files = body.files || [];
  }

  if (files.length === 0) return c.json({ error: '未提供上传文件' }, 400);

  const user = c.get('user') as Record<string, unknown>;
  const username = String(user?.username ?? '');
  const taskId = await createTask(c.env.DB, 'upload', { username, file_count: files.length });

  getCtx(c).waitUntil(runUpload(c.env.DB, config, files, taskId, username));

  return c.json({ ok: true, task_id: taskId });
});

// ── Export ────────────────────────────────────────────────────────────

api.get('/export/invalid', async (c) => {
  const result = await getAccounts(c.env.DB, { status_filter: 'invalid_401', limit: 500 });
  return c.json(result.rows);
});

api.get('/export/quota', async (c) => {
  const result = await getAccounts(c.env.DB, { status_filter: 'quota_limited', limit: 500 });
  return c.json(result.rows);
});

// ── Scan History ─────────────────────────────────────────────────────

api.get('/scan-runs', async (c) => {
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const result = await getScanRuns(c.env.DB, limit, offset);
  return c.json(result);
});

api.post('/history/cleanup', async (c) => {
  const body = await c.req.json<{ scope?: string; keep_days?: number | string }>().catch(() => null);
  const scope = String(body?.scope || 'scan_runs');
  const keepDaysRaw = body?.keep_days;
  const keepDays = keepDaysRaw == null || keepDaysRaw === ''
    ? null
    : Number.parseInt(String(keepDaysRaw), 10);
  const user = c.get('user') as Record<string, unknown>;
  const username = String(user?.username ?? '');

  if (!['scan_runs', 'activity_log', 'finished_tasks', 'all'].includes(scope)) {
    return c.json({ error: '不支持的清理范围' }, 400);
  }
  if (keepDays != null && (!Number.isFinite(keepDays) || keepDays < 1)) {
    return c.json({ error: 'keep_days 必须是大于等于 1 的整数' }, 400);
  }

  const result = {
    scope,
    keep_days: keepDays,
    scan_runs: 0,
    activity_log: 0,
    finished_tasks: 0,
  };

  if (scope === 'scan_runs' || scope === 'all') {
    result.scan_runs = keepDays != null
      ? await clearScanRunsOlderThanDays(c.env.DB, keepDays)
      : await clearScanRuns(c.env.DB);
  }
  if (scope === 'finished_tasks' || scope === 'all') {
    result.finished_tasks = keepDays != null
      ? await clearFinishedTasksOlderThanDays(c.env.DB, keepDays)
      : await clearFinishedTasks(c.env.DB);
  }
  if (scope === 'activity_log' || scope === 'all') {
    result.activity_log = keepDays != null
      ? await clearActivityLogOlderThanDays(c.env.DB, keepDays)
      : await clearActivityLog(c.env.DB);
  }

  const touchesActivityLog = scope === 'activity_log' || scope === 'all';
  if (!touchesActivityLog) {
    const actionName = keepDays != null ? 'cleanup_history_retention' : `cleanup_${scope}`;
    const detail = keepDays != null
      ? `按天数清理历史: scope=${scope} keep_days=${keepDays} | 扫描历史=${result.scan_runs} | 操作日志=${result.activity_log} | 已完成任务=${result.finished_tasks}`
      : scope === 'scan_runs'
        ? `清理扫描历史: 删除 ${result.scan_runs} 条`
        : scope === 'finished_tasks'
          ? `清理已完成任务: 删除 ${result.finished_tasks} 条`
          : `清理历史: scope=${scope}`;
    await logActivity(c.env.DB, actionName, detail, username);
  }

  const actionLabel = keepDays != null ? `已清理 ${keepDays} 天前历史` : '已清理';
  return c.json({
    ok: true,
    ...result,
    message: [
      scope === 'scan_runs' || scope === 'all' ? `扫描历史 ${result.scan_runs} 条` : '',
      scope === 'activity_log' || scope === 'all' ? `操作日志 ${result.activity_log} 条` : '',
      scope === 'finished_tasks' || scope === 'all' ? `已完成任务 ${result.finished_tasks} 条` : '',
    ].filter(Boolean).join('，') + ` ${actionLabel}`,
  });
});

// ── Activity Log ─────────────────────────────────────────────────────

api.get('/activity', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const result = await getActivityLog(c.env.DB, limit, offset);
  return c.json(result);
});

// ── Tasks ────────────────────────────────────────────────────────────

api.get('/tasks', async (c) => {
  const tasks = await getRecentTasks(c.env.DB);
  return c.json(tasks);
});

api.get('/tasks/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const task = await getTaskById(c.env.DB, id);
  if (!task) return c.json({ error: '任务不存在' }, 404);
  return c.json(task);
});

api.post('/tasks/:id/cancel', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) {
    return c.json({ error: '任务ID无效' }, 400);
  }

  const stopReason = '用户手动停止任务';
  const result = await requestTaskCancellation(c.env.DB, id, stopReason);
  if (!result.found) {
    return c.json({ error: '任务不存在' }, 404);
  }

  if (!result.cancel_requested && result.status !== 'cancelled') {
    return c.json({
      error: `任务当前状态为 ${result.status}，无法停止`,
      status: result.status,
      type: result.type,
    }, 409);
  }

  const user = c.get('user') as Record<string, unknown>;
  const username = String(user?.username ?? '');
  const detail = result.cancelled_immediately
    ? `任务已直接停止: id=${id} type=${result.type || '-'} status=cancelled`
    : `任务已发出停止请求: id=${id} type=${result.type || '-'} current_status=${result.status}`;
  await logActivity(c.env.DB, 'cancel_task', detail, username);

  return c.json({
    ok: true,
    task_id: id,
    status: result.status,
    type: result.type,
    cancel_requested: result.cancel_requested,
    cancelled_immediately: result.cancelled_immediately,
    message: result.cancelled_immediately ? '任务已停止' : '已发送停止请求，当前批次结束后会安全停止',
  });
});

export default api;
