import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import { loginPage } from '../views/layout';
import { APP_ICON_SVG } from '../views/icon';
import { buildPwaManifest, buildServiceWorker, getPngIconBody, PWA_METADATA } from '../views/pwa';
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

pages.get('/assets/app-icon-192.png', (c) => new Response(getPngIconBody(192), {
  headers: {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=86400',
  },
}));

pages.get('/assets/app-icon-512.png', (c) => new Response(getPngIconBody(512), {
  headers: {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=86400',
  },
}));

pages.get('/apple-touch-icon.png', (c) => new Response(getPngIconBody(180), {
  headers: {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=86400',
  },
}));

pages.get('/manifest.webmanifest', (c) => new Response(buildPwaManifest(), {
  headers: {
    'Content-Type': 'application/manifest+json; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  },
}));

pages.get('/sw.js', (c) => new Response(buildServiceWorker(), {
  headers: {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
    'Service-Worker-Allowed': '/',
  },
}));

pages.get('/favicon.ico', (c) => c.redirect(PWA_METADATA.appleTouchIconHref, 302));
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
