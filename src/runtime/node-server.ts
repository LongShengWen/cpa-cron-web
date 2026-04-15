import { serve } from '@hono/node-server';
import { app, runScheduledMaintain } from '../index';
import { createLocalBindingsFromEnv } from './local-platform';

const bindings = createLocalBindingsFromEnv();
const port = Number.parseInt(process.env.PORT || '8787', 10) || 8787;
const host = (process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';
const enableCron = !['0', 'false', 'off', 'no'].includes(String(process.env.ENABLE_CRON || 'true').trim().toLowerCase());
const baseCronExpression = '* * * * *';

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil(promise: Promise<unknown>) {
      void promise.catch((error) => {
        console.error('[node-runtime] background task failed:', error);
      });
    },
    passThroughOnException() {
      // Node runtime: no-op
    },
    props: undefined,
  } as ExecutionContext;
}

async function cronTick(): Promise<void> {
  try {
    await runScheduledMaintain(bindings, baseCronExpression);
  } catch (error) {
    console.error('[node-runtime] scheduled maintain failed:', error);
  }
}

function scheduleCronLoop(): () => void {
  let interval: NodeJS.Timeout | null = null;
  let starter: NodeJS.Timeout | null = null;

  const startInterval = () => {
    void cronTick();
    interval = setInterval(() => {
      void cronTick();
    }, 60_000);
  };

  const now = Date.now();
  const delay = 60_000 - (now % 60_000);
  starter = setTimeout(startInterval, delay);

  return () => {
    if (starter) clearTimeout(starter);
    if (interval) clearInterval(interval);
  };
}

let stopCronLoop = () => {};
if (enableCron) {
  stopCronLoop = scheduleCronLoop();
  console.log('[node-runtime] cron scheduler enabled (base tick: every minute, actual frequency follows cron_expression)');
} else {
  console.log('[node-runtime] cron scheduler disabled by ENABLE_CRON=false');
}

serve({
  port,
  hostname: host,
  fetch: (request) => app.fetch(request, bindings, createExecutionContext()),
});

console.log(`[node-runtime] cpa-cron-web listening on http://${host}:${port}`);
console.log(`[node-runtime] sqlite path: ${(process.env.SQLITE_PATH || '/data/cpa-cron-web.db').trim() || '/data/cpa-cron-web.db'}`);

const shutdown = () => {
  stopCronLoop();
  if ('__sqlite' in bindings && bindings.__sqlite) {
    bindings.__sqlite.close();
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
