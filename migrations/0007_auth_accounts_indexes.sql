-- 为 Docker / 本地 SQLite 面板常用排序与轮询查询补充索引，
-- 减少账号列表、最近探测时间、仪表盘统计在大数据量下的卡顿。

CREATE INDEX IF NOT EXISTS idx_auth_accounts_updated_at
ON auth_accounts(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_accounts_last_probed_at
ON auth_accounts(last_probed_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_accounts_provider_updated_at
ON auth_accounts(provider, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_accounts_status_flags_updated_at
ON auth_accounts(disabled, is_invalid_401, is_quota_limited, is_recovered, updated_at DESC);
