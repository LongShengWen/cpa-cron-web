ALTER TABLE task_queue ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_queue ADD COLUMN cancel_requested_at TEXT;
ALTER TABLE task_queue ADD COLUMN cancel_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_task_queue_cancel_requested ON task_queue(cancel_requested);
