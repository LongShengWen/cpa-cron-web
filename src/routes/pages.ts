import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import { loginPage } from '../views/layout';
import { APP_ICON_SVG } from '../views/icon';
import {
  dashboardPage,
  accountsPage,
  operationsPage,
  historyPage,
  activityPage,
  settingsPage,
} from '../views/pages';
import { getAccounts } from '../core/db';

const pages = new Hono<HonoEnv>();

pages.get('/assets/app-icon.svg', (c) => new Response(APP_ICON_SVG, {
  headers: {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
  },
}));
pages.get('/favicon.ico', (c) => c.redirect('/assets/app-icon.svg', 302));
pages.get('/login', (c) => c.html(loginPage()));
pages.get('/', (c) => c.html(dashboardPage()));
pages.get('/accounts', async (c) => {
  const data = await getAccounts(c.env.DB, { limit: 50, offset: 0, sort: 'updated_at', order: 'desc' });
  return c.html(accountsPage(data));
});
pages.get('/operations', (c) => c.html(operationsPage()));
pages.get('/history', (c) => c.html(historyPage()));
pages.get('/activity', (c) => c.html(activityPage()));
pages.get('/settings', (c) => c.html(settingsPage()));

export default pages;
