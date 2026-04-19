import { APP_ICON_LINK_TAGS } from './icon';
import { PWA_METADATA } from './pwa';

type NavItem = {
  href: string;
  label: string;
  icon: string;
  id: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: '仪表盘', icon: 'dashboard', id: 'dashboard' },
  { href: '/accounts', label: '账号管理', icon: 'people', id: 'accounts' },
  { href: '/operations', label: '运维操作', icon: 'build', id: 'operations' },
  { href: '/history', label: '扫描历史', icon: 'history', id: 'history' },
  { href: '/activity', label: '操作日志', icon: 'receipt_long', id: 'activity' },
  { href: '/settings', label: '系统配置', icon: 'settings', id: 'settings' },
];

function renderDesktopNav(activeNav: string): string {
  return NAV_ITEMS
    .map(
      (item) =>
        `<a href="${item.href}" class="nav-item ${activeNav === item.id ? 'active' : ''}"><span class="material-icons">${item.icon}</span><span>${item.label}</span></a>`
    )
    .join('\n');
}

export function htmlLayout(title: string, content: string, activeNav = ''): string {
  const navHtml = renderDesktopNav(activeNav);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${title} - cpa-cron-web</title>
${APP_ICON_LINK_TAGS}
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
<style>
:root {
  --bg: #0f1117;
  --bg-card: #1a1d27;
  --bg-card-hover: #222636;
  --bg-sidebar: #141620;
  --border: #2a2e3d;
  --text: #e4e6eb;
  --text-dim: #8b8fa3;
  --primary: #6c5ce7;
  --primary-hover: #7c6df7;
  --success: #00b894;
  --danger: #e74c3c;
  --warning: #fdcb6e;
  --info: #74b9ff;
  --radius: 8px;
  --sidebar-width: 240px;
  --topbar-height: 68px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { background: var(--bg); }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  overflow-x: hidden;
}
a { color: var(--primary); text-decoration: none; }
button { font: inherit; }
/* Sidebar */
.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  height: 100vh;
  height: 100dvh;
  position: fixed;
  left: 0;
  top: 0;
  display: flex;
  flex-direction: column;
  z-index: 100;
  transition: transform .22s ease;
}
.sidebar-header { padding: 20px; border-bottom: 1px solid var(--border); }
.sidebar-header h1 { font-size: 18px; font-weight: 700; color: var(--primary); }
.sidebar-header p { font-size: 12px; color: var(--text-dim); margin-top: 4px; }
.sidebar-nav { flex: 1; padding: 12px 0; overflow-y: auto; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  color: var(--text-dim);
  font-size: 14px;
  transition: all .15s;
}
.nav-item:hover { color: var(--text); background: rgba(108,92,231,.1); }
.nav-item.active { color: var(--primary); background: rgba(108,92,231,.15); border-right: 3px solid var(--primary); }
.nav-item .material-icons { font-size: 20px; }
.sidebar-footer { padding: 16px 20px; border-top: 1px solid var(--border); }
.user-info { display: flex; align-items: center; gap: 10px; }
.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
}
.user-name { font-size: 13px; }
.btn-logout { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 12px; margin-top: 8px; }
.btn-logout:hover { color: var(--danger); }
.sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(4, 6, 12, .62);
  backdrop-filter: blur(3px);
  opacity: 0;
  pointer-events: none;
  transition: opacity .2s ease;
  z-index: 95;
}
.sidebar-backdrop.show { opacity: 1; pointer-events: auto; }
body.sidebar-open { overflow: hidden; }
body.pwa-standalone .sidebar {
  transform: translateX(-105%);
  box-shadow: 0 16px 48px rgba(0,0,0,.45);
}
body.pwa-standalone .sidebar.show { transform: translateX(0); }
body.pwa-standalone .sidebar-backdrop { display: block; }
body.pwa-standalone .main {
  margin-left: 0;
  width: 100%;
}
body.pwa-standalone .mobile-menu-btn { display: inline-flex; }
body.pwa-standalone .topbar-kicker,
body.pwa-standalone .topbar-subtitle { display: none; }
body.pwa-standalone .topbar-title-group { gap: 0; }
body.pwa-standalone .sidebar-header p { display: none; }
/* Main */
.main {
  margin-left: var(--sidebar-width);
  flex: 1;
  min-height: 100vh;
  min-height: 100dvh;
  width: calc(100% - var(--sidebar-width));
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 90;
  min-height: var(--topbar-height);
  padding: 16px 32px;
  border-bottom: 1px solid rgba(42,46,61,.9);
  background: linear-gradient(180deg, rgba(15,17,23,.94), rgba(15,17,23,.82));
  backdrop-filter: blur(14px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.topbar-left, .topbar-right { display: flex; align-items: center; gap: 12px; min-width: 0; }
.topbar-left { flex: 1 1 auto; min-width: 0; }
.topbar-title-group { display: grid; gap: 2px; min-width: 0; }
.topbar-kicker { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--text-dim); }
.topbar h2 { font-size: 20px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.topbar-subtitle { font-size: 12px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.topbar-right { margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
.topbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.content { padding: 24px 32px 32px; }
.page-grid { display: grid; gap: 24px; }
.page-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.page-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.section-stack { display: grid; gap: 24px; margin-top: 24px; }
.meta-list { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; font-size: 13px; color: var(--text-dim); }
.action-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.toolbar-group { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; min-width: 0; }
.toolbar-group-grow { flex: 1 1 auto; min-width: 0; }
.toolbar-spacer { margin-left: auto; }
.inline-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; min-width: 0; }
.inline-form > * { min-width: 0; }
.section-note { font-size: 12px; color: var(--text-dim); line-height: 1.6; }
.surface-note {
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(108,92,231,.12);
  background: rgba(15,17,23,.48);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.65;
}
.ops-grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.result-stats-grid { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
.saved-config-grid { padding: 16px 20px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; font-size: 13px; }
.saved-config-item {
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(108,92,231,.12);
  background: linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.02));
}
.saved-config-label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--text-dim);
}
.saved-config-value {
  display: block;
  margin-top: 8px;
  color: var(--text);
  line-height: 1.6;
  word-break: break-word;
}
.section-card-stack { display: grid; gap: 16px; }
.settings-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(0,0,0,.12);
}
.settings-panel[open] { border-color: rgba(108,92,231,.26); }
.settings-panel-summary {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  cursor: pointer;
  background: linear-gradient(180deg, rgba(108,92,231,.08), rgba(108,92,231,.03));
}
.settings-panel-summary::-webkit-details-marker { display: none; }
.settings-panel-icon {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(108,92,231,.14);
  color: var(--primary);
  flex-shrink: 0;
}
.settings-panel-main { min-width: 0; flex: 1 1 auto; display: grid; gap: 4px; }
.settings-panel-kicker {
  font-size: 11px;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--text-dim);
}
.settings-panel-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
.settings-panel-subtitle {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-dim);
}
.settings-panel-chevron {
  color: var(--text-dim);
  transition: transform .18s ease, color .18s ease;
}
.settings-panel[open] .settings-panel-chevron {
  transform: rotate(180deg);
  color: var(--primary);
}
.settings-panel-body { padding: 0 20px 20px; }
.settings-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.settings-actions > * { min-width: 0; }
.accounts-meta-panel {
  overflow: hidden;
  border-radius: 20px;
}
.accounts-meta-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, 1fr);
  gap: 16px;
  padding: 18px;
}
.accounts-status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.status-mini-card {
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(108,92,231,.12);
  background: linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.015));
  min-height: 92px;
}
.status-mini-label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--text-dim);
}
.status-mini-value {
  display: block;
  margin-top: 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.5;
}
.quick-actions-panel {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-radius: 16px;
  border: 1px solid rgba(108,92,231,.12);
  background: rgba(255,255,255,.025);
}
.quick-actions-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
}
.quick-actions-title .material-icons { font-size: 16px; color: var(--primary); }
.quick-actions-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.quick-actions-grid .btn {
  width: 100%;
  min-height: 36px;
  padding: 8px 10px;
  justify-content: center;
}
.quick-actions-grid #quickScanMaintainBtn,
.quick-actions-grid #quickTaskCancelBtn {
  grid-column: 1 / -1;
}
.accounts-toolbar-panel { display: grid; gap: 14px; }
.accounts-toolbar-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.accounts-toolbar-copy { display: grid; gap: 6px; }
.toolbar-section-tag {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .12em;
  color: var(--text-dim);
}
.accounts-toolbar-title { font-size: 16px; font-weight: 600; color: var(--text); }
.accounts-counter-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid rgba(108,92,231,.14);
  background: rgba(108,92,231,.08);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
}
.accounts-filter-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) repeat(2, minmax(140px, .7fr)) auto;
  gap: 10px;
  align-items: center;
}
.accounts-batch-grid {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dashboard-section-body,
.operations-section-body,
.history-section-body,
.activity-section-body {
  padding: 18px 20px;
}
.ops-action-row { display:flex; align-items:center; gap:12px; }
.ops-action-icon { font-size:36px; flex-shrink:0; }
.ops-action-copy { flex:1; min-width:0; }
.ops-action-desc { font-size:13px; margin-top:4px; color:var(--text-dim); line-height:1.55; }
.responsive-table table { min-width: 100%; }
.accounts-table .account-row td { position: relative; }
.accounts-table .account-cell-email { font-weight: 600; }
.accounts-table .account-cell-provider, .accounts-table .account-cell-api, .accounts-table .account-cell-updated { color: var(--text-dim); }
.quota-card { display: flex; flex-direction: column; gap: 6px; min-width: 120px; }
.quota-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.quota-card-value { font-weight: 600; color: var(--text); }
.quota-card-percent { font-size: 11px; color: var(--text-dim); }
.quota-card-reset { font-size: 11px; color: var(--text-dim); }
.quota-progress { height: 6px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; }
.quota-progress > span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--primary), var(--info)); }
.quota-card-success .quota-progress > span { background: linear-gradient(90deg, rgba(0,184,148,.95), rgba(0,220,170,.95)); }
.quota-card-info .quota-progress > span { background: linear-gradient(90deg, rgba(116,185,255,.95), rgba(108,92,231,.95)); }
.quota-card-warning .quota-progress > span { background: linear-gradient(90deg, rgba(253,203,110,.95), rgba(240,185,77,.95)); }
.quota-card-danger .quota-progress > span { background: linear-gradient(90deg, rgba(231,76,60,.95), rgba(192,57,43,.95)); }
.account-updated-stack { display: flex; flex-direction: column; gap: 2px; }
.account-updated-absolute { color: var(--text); }
.account-updated-relative { font-size: 11px; color: var(--text-dim); }
.account-card-details { display: none; }
.accounts-table .account-cell-actions .action-group { width: 100%; }
.accounts-table .account-cell-actions .btn { min-height: 34px; }
.mobile-menu-btn { display: none; }
/* Cards */
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
.compact-stats-grid { grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: 8px; margin-bottom: 12px; }
.stat-card {
  background: linear-gradient(180deg, rgba(26,29,39,.98), rgba(23,25,35,.96));
  border: 1px solid rgba(42,46,61,.94);
  border-radius: 18px;
  padding: 20px;
  transition: all .15s;
  box-shadow: 0 12px 28px rgba(0,0,0,.12);
}
.stat-card:hover { background: var(--bg-card-hover); border-color: rgba(108,92,231,.48); transform: translateY(-1px); }
.stat-card .label { font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .5px; }
.stat-card .value { font-size: 28px; font-weight: 700; margin-top: 8px; }
.stat-card .value.success { color: var(--success); }
.stat-card .value.danger { color: var(--danger); }
.stat-card .value.warning { color: var(--warning); }
.stat-card .value.info { color: var(--info); }
.compact-stat-card {
  padding: 10px 12px;
  border-radius: 12px;
  box-shadow: 0 6px 16px rgba(0,0,0,.10);
}
.compact-stat-card .label {
  font-size: 10px;
  letter-spacing: .25px;
}
.compact-stat-card .value {
  margin-top: 4px;
  font-size: 18px;
  line-height: 1.2;
}
/* Table */
.table-wrapper {
  background: linear-gradient(180deg, rgba(26,29,39,.98), rgba(26,29,39,.95));
  border: 1px solid var(--border);
  border-radius: 18px;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  box-shadow: 0 14px 36px rgba(0,0,0,.12);
}
.table-wrapper table { width: 100%; }
.table-toolbar {
  padding: 16px 18px;
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  border-bottom: 1px solid rgba(42,46,61,.92);
  background: linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.01));
}
table { width: 100%; border-collapse: collapse; }
th, td { padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--border); font-size: 13px; }
th { background: rgba(108,92,231,.08); color: var(--text-dim); font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .5px; white-space: nowrap; }
tr:hover td { background: rgba(108,92,231,.04); }
/* Badge */
.badge { padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.badge-success { background: rgba(0,184,148,.15); color: var(--success); }
.badge-danger { background: rgba(231,76,60,.15); color: var(--danger); }
.badge-warning { background: rgba(253,203,110,.15); color: var(--warning); }
.badge-info { background: rgba(116,185,255,.15); color: var(--info); }
.badge-dim { background: rgba(139,143,163,.15); color: var(--text-dim); }
/* Buttons */
.btn { padding: 8px 16px; border-radius: var(--radius); font-size: 13px; font-weight: 500; border: 1px solid transparent; cursor: pointer; transition: all .15s; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { background: var(--primary-hover); }
.btn-warning { background: var(--warning); color: #1a1d27; }
.btn-warning:hover { background: #f0b94d; }
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover { background: #c0392b; }
.btn-outline { background: transparent; border-color: var(--border); color: var(--text); }
.btn-outline:hover { border-color: var(--primary); color: var(--primary); }
.btn-sm { padding: 6px 12px; font-size: 12px; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.icon-btn {
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,.02);
  color: var(--text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.icon-btn:hover { border-color: var(--primary); color: var(--primary); }
/* Forms */
input, select, textarea { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 12px; color: var(--text); font-size: 13px; outline: none; transition: border-color .15s; }
input:focus, select:focus, textarea:focus { border-color: var(--primary); }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 12px; color: var(--text-dim); margin-bottom: 6px; font-weight: 500; }
.form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
/* Pagination */
.pagination { display: flex; align-items: center; gap: 8px; padding: 16px; justify-content: center; }
.pagination button { background: var(--bg-card); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: var(--radius); cursor: pointer; font-size: 13px; }
.pagination button:hover { border-color: var(--primary); }
.pagination button:disabled { opacity: .4; cursor: not-allowed; }
.pagination span { font-size: 13px; color: var(--text-dim); }
/* Alert */
.alert { padding: 12px 16px; border-radius: var(--radius); margin-bottom: 16px; font-size: 13px; }
.alert-success { background: rgba(0,184,148,.1); border: 1px solid rgba(0,184,148,.3); color: var(--success); }
.alert-danger { background: rgba(231,76,60,.1); border: 1px solid rgba(231,76,60,.3); color: var(--danger); }
.alert-info { background: rgba(116,185,255,.1); border: 1px solid rgba(116,185,255,.3); color: var(--info); }
/* Modal */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 200; display: none; align-items: center; justify-content: center; }
.modal-overlay.show { display: flex; }
.modal { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; width: 90%; max-width: 500px; padding: 24px; }
.modal h3 { font-size: 16px; margin-bottom: 16px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
/* Loading */
.spinner { display: inline-block; width: 20px; height: 20px; border: 2px solid var(--border); border-top-color: var(--primary); border-radius: 50%; animation: spin .6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
/* Toast notification */
.toast-container { position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
.toast { pointer-events: auto; padding: 14px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; color: #fff; box-shadow: 0 8px 32px rgba(0,0,0,.4); transform: translateX(120%); animation: toastIn .35s ease forwards; display: flex; align-items: center; gap: 10px; max-width: 420px; backdrop-filter: blur(8px); }
.toast.toast-out { animation: toastOut .3s ease forwards; }
.toast-success { background: linear-gradient(135deg, rgba(0,184,148,.92), rgba(0,150,120,.92)); }
.toast-danger { background: linear-gradient(135deg, rgba(231,76,60,.92), rgba(192,57,43,.92)); }
.toast-info { background: linear-gradient(135deg, rgba(116,185,255,.92), rgba(108,92,231,.92)); }
.toast-warning { background: linear-gradient(135deg, rgba(253,203,110,.92), rgba(225,177,44,.92)); color: #1a1d27; }
.toast .material-icons { font-size: 20px; flex-shrink: 0; }
@keyframes toastIn { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes toastOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(120%); opacity: 0; } }
/* Tooltip */
.app-tooltip {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 10000;
  display: none;
  max-width: 320px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(20, 22, 32, .96);
  border: 1px solid rgba(108, 92, 231, .28);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
  box-shadow: 0 10px 30px rgba(0,0,0,.35);
  pointer-events: none;
  white-space: pre-wrap;
  word-break: break-word;
  backdrop-filter: blur(10px);
}
.app-tooltip.show { display: block; }
.app-tooltip-anchor { cursor: help; }
/* Pulse animation for active states */
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .6; } }
.pulse { animation: pulse 1.5s ease-in-out infinite; }
/* Progress bar shine */
@keyframes shine { from { left: -50%; } to { left: 150%; } }
.progress-bar-animated { position: relative; overflow: hidden; }
.progress-bar-animated::after { content: ''; position: absolute; top: 0; left: -50%; width: 50%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,.2), transparent); animation: shine 1.5s ease infinite; }
/* Empty state */
.empty { text-align: center; padding: 48px 16px; color: var(--text-dim); }
.empty .material-icons { font-size: 48px; margin-bottom: 12px; opacity: .3; }
/* Responsive */
@media (max-width: 768px) {
  .sidebar {
    width: min(84vw, 320px);
    max-width: 320px;
    transform: translateX(-105%);
    box-shadow: 0 16px 48px rgba(0,0,0,.45);
  }
  .sidebar.show { transform: translateX(0); }
  .sidebar-backdrop { display: block; }
  .sidebar-footer { padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
  .main {
    margin-left: 0;
    width: 100%;
    min-height: 100dvh;
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }
  .topbar {
    min-height: 56px;
    padding: calc(10px + env(safe-area-inset-top, 0px)) 14px 10px;
    gap: 8px;
    flex-wrap: nowrap;
    align-items: center;
  }
  .topbar-kicker,
  .topbar-subtitle { display: none; }
  .topbar-title-group { gap: 0; }
  .topbar h2 { font-size: 17px; line-height: 1.3; }
  .topbar-left { width: auto; }
  .topbar-right { width: auto; gap: 8px; margin-left: auto; justify-content: flex-end; }
  .topbar-actions { justify-content: flex-end; }
  .content { padding: 14px 14px 20px; }
  .page-grid { gap: 14px; }
  .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .compact-stats-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
  .compact-stat-card { padding: 8px 10px; }
  .compact-stat-card .label { font-size: 10px; }
  .compact-stat-card .value { font-size: 16px; }
  .mobile-menu-btn { display: flex; }
  .sidebar-header { padding: 16px; }
  .sidebar-header p { display: none; }
  .sidebar-nav { padding: 8px 0; }
  .nav-item { padding: 11px 16px; }
  .table-toolbar { padding: 12px 14px; gap: 10px; display: grid; }
  th, td { white-space: nowrap; }
  .table-toolbar > input,
  .table-toolbar > select,
  .table-toolbar > button,
  .table-toolbar > .btn,
  .table-toolbar > .toolbar-group,
  .table-toolbar > .inline-form,
  .table-toolbar > .toolbar-spacer,
  .table-toolbar > div,
  .table-toolbar > span {
    width: 100%;
    max-width: 100%;
  }
  .table-toolbar > input,
  .table-toolbar > select { width: 100% !important; }
  .table-toolbar > button,
  .table-toolbar > .btn { justify-content: center; }
  .toolbar-group,
  .inline-form { width: 100%; }
  .toolbar-group > *,
  .inline-form > * { flex: 1 1 100%; }
  .toolbar-spacer { margin-left: 0; }
  .toast-container { right: 12px; left: 12px; top: calc(12px + env(safe-area-inset-top, 0px)); }
  .toast { max-width: none; }
  .page-grid-2, .page-grid-3 { grid-template-columns: 1fr; }
  .section-note { font-size: 11px; line-height: 1.5; }
  .surface-note { padding: 10px 12px; font-size: 11px; line-height: 1.55; }
  .meta-list { gap: 10px; align-items: stretch; }
  .meta-list > * { width: 100%; }
  .meta-list .btn { width: 100%; justify-content: center; }
  .ops-grid { grid-template-columns: 1fr !important; gap: 12px; }
  .saved-config-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; padding: 12px; gap: 10px; }
  .saved-config-item { padding: 12px 14px; border-radius: 14px; }
  .saved-config-value { margin-top: 6px; line-height: 1.5; }
  .accounts-meta-grid { grid-template-columns: 1fr; padding: 12px; gap: 12px; }
  .accounts-status-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .status-mini-card { min-height: 0; padding: 10px; border-radius: 12px; }
  .status-mini-label { font-size: 10px; letter-spacing: .05em; }
  .status-mini-value { margin-top: 6px; font-size: 13px; line-height: 1.35; }
  .quick-actions-panel { padding: 10px; border-radius: 14px; }
  .quick-actions-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
  .quick-actions-grid .btn { min-height: 38px; }
  .accounts-counter-pill { min-height: 30px; padding: 4px 10px; font-size: 11px; }
  .accounts-toolbar-head { flex-direction: column; align-items: flex-start; }
  .accounts-filter-grid { grid-template-columns: 1fr; }
  .accounts-batch-grid { width: 100%; display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .accounts-batch-grid > * { min-width: 0; }
  .accounts-batch-grid > .accounts-counter-pill { grid-column: 1 / -1; justify-content: center; }
  .result-stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dashboard-section-body,
  .operations-section-body,
  .history-section-body,
  .activity-section-body { padding: 14px; }
  .ops-grid .stat-card { padding: 14px; }
  .ops-action-row { gap: 10px; align-items: flex-start; }
  .ops-action-icon { font-size: 28px !important; }
  .ops-action-desc { font-size: 12px !important; margin-top: 3px !important; }
  .settings-panel { border-radius: 14px; }
  .settings-panel-summary { padding: 14px; gap: 10px; align-items: flex-start; }
  .settings-panel-icon { width: 36px; height: 36px; border-radius: 12px; }
  .settings-panel-kicker,
  .settings-panel-subtitle { display: none; }
  .settings-panel-title { font-size: 15px; line-height: 1.35; }
  .settings-panel-body { padding: 0 14px 14px; }
  .settings-actions > * { flex: 1 1 100%; }
  input, select, textarea { min-height: 40px; font-size: 16px; }
  .btn { min-height: 40px; }
  .section-stack { gap: 12px; margin-top: 12px; }
  .table-wrapper, .stat-card { border-radius: 16px; }
  .modal-overlay { align-items: flex-end; }
  .modal {
    width: 100%;
    max-width: none;
    margin: 0;
    border-radius: 18px 18px 0 0;
    padding: 20px 16px calc(20px + env(safe-area-inset-bottom, 0px));
    border-left: none;
    border-right: none;
    border-bottom: none;
  }
  .modal-actions {
    flex-direction: column-reverse;
  }
  .modal-actions .btn {
    width: 100%;
  }
  .responsive-table { background: transparent; border: none; overflow: visible; }
  .responsive-table > table { min-width: 0; }
  .responsive-table thead { display: none; }
  .responsive-table tbody { display: grid; gap: 10px; padding: 10px; }
  .responsive-table tr { display: block; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-card); overflow: hidden; }
  .responsive-table td {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(42,46,61,.72);
    white-space: normal !important;
  }
  .responsive-table td:last-child { border-bottom: none; }
  .responsive-table td::before {
    content: attr(data-label);
    font-size: 11px;
    line-height: 1.4;
    letter-spacing: .3px;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .responsive-table td[colspan] {
    display: block;
    text-align: center !important;
  }
  .responsive-table td[colspan]::before { display: none; }
  .responsive-table .action-group { width: 100%; }
  .responsive-table .action-group .btn { flex: 1 1 calc(50% - 4px); }
  .accounts-table tbody { padding: 10px; }
  .accounts-table tr.account-row.account-state-success { border-color: rgba(0,184,148,.26); background: linear-gradient(180deg, rgba(0,184,148,.06), rgba(26,29,39,.96)); }
  .accounts-table tr.account-row.account-state-info { border-color: rgba(116,185,255,.26); background: linear-gradient(180deg, rgba(116,185,255,.06), rgba(26,29,39,.96)); }
  .accounts-table tr.account-row.account-state-warning { border-color: rgba(253,203,110,.26); background: linear-gradient(180deg, rgba(253,203,110,.06), rgba(26,29,39,.96)); }
  .accounts-table tr.account-row.account-state-danger { border-color: rgba(231,76,60,.32); background: linear-gradient(180deg, rgba(231,76,60,.07), rgba(26,29,39,.96)); }
  .accounts-table tr.account-row.account-state-dim { border-color: rgba(139,143,163,.26); background: linear-gradient(180deg, rgba(139,143,163,.05), rgba(26,29,39,.96)); }
  .accounts-table tr.account-row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    grid-template-areas:
      'select email status'
      'provider provider api'
      'quota quota quota'
      'spark spark spark'
      'updated updated updated'
      'actions actions actions';
    gap: 0;
    border-radius: 16px;
    box-shadow: 0 10px 28px rgba(0,0,0,.18);
  }
  .accounts-table tr.account-row td::before { margin-bottom: 2px; }
  .accounts-table .account-cell-select { grid-area: select; align-items: center; justify-content: center; padding-right: 4px; }
  .accounts-table .account-cell-select::before { display: none; }
  .accounts-table .account-cell-email {
    grid-area: email;
    min-width: 0;
    padding-bottom: 6px;
  }
  .accounts-table .account-cell-email::before { display: none; }
  .accounts-table .account-email-text {
    width: 100%;
    font-size: 15px;
    line-height: 1.5;
    color: var(--text);
    white-space: normal;
    word-break: break-word;
  }
  .accounts-table .account-cell-status {
    grid-area: status;
    align-items: flex-end;
    justify-content: center;
    padding-left: 8px;
  }
  .accounts-table .account-cell-status::before { display: none; }
  .accounts-table .account-cell-provider {
    grid-area: provider;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    padding-top: 6px;
  }
  .accounts-table .account-cell-provider::before,
  .accounts-table .account-cell-api::before,
  .accounts-table .account-cell-updated::before {
    font-size: 10px;
    letter-spacing: .4px;
  }
  .accounts-table .account-provider-chip, .accounts-table .account-api-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(255,255,255,.04);
    color: var(--text);
    font-size: 12px;
    border: 1px solid rgba(108,92,231,.16);
  }
  .accounts-table .account-cell-api {
    grid-area: api;
    align-items: flex-end;
    justify-content: center;
    padding-top: 6px;
  }
  .accounts-table .account-cell-quota, .accounts-table .account-cell-spark {
    background: rgba(255,255,255,.02);
  }
  .accounts-table .account-cell-quota { grid-area: quota; }
  .accounts-table .account-cell-spark { grid-area: spark; }
  .accounts-table .account-cell-quota .app-tooltip-anchor,
  .accounts-table .account-cell-spark .app-tooltip-anchor {
    width: 100%;
    min-width: 0 !important;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(108,92,231,.07);
    border: 1px solid rgba(108,92,231,.14);
  }
  .accounts-table .account-cell-updated {
    grid-area: updated;
    padding-top: 10px;
    color: var(--text-dim);
  }
  .accounts-table .account-cell-actions {
    grid-area: actions;
    background: linear-gradient(180deg, rgba(255,255,255,.02), transparent);
  }
  .account-card-details { display: block; margin-top: 10px; width: 100%; border-top: 1px dashed rgba(108,92,231,.18); padding-top: 10px; }
  .account-card-details summary { list-style: none; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--text-dim); font-size: 12px; }
  .account-card-details summary::-webkit-details-marker { display: none; }
  .account-card-details[open] summary { color: var(--primary); }
  .account-card-details[open] .material-icons { transform: rotate(180deg); }
  .account-card-details .material-icons { font-size: 18px; transition: transform .18s ease; }
  .account-card-details-body { display: grid; gap: 8px; margin-top: 10px; }
  .account-detail-item { padding: 10px 12px; border-radius: 12px; background: rgba(15,17,23,.72); border: 1px solid rgba(108,92,231,.12); }
  .account-detail-label { display: block; margin-bottom: 4px; font-size: 11px; letter-spacing: .3px; text-transform: uppercase; color: var(--text-dim); }
  .account-detail-value { display: block; line-height: 1.5; color: var(--text); white-space: normal; word-break: break-word; }
}

@media (max-width: 520px) {
  .content { padding: 12px 12px 18px; }
  .stats-grid { grid-template-columns: 1fr; }
  .compact-stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .form-row { grid-template-columns: 1fr; }
  .responsive-table .action-group .btn { flex-basis: 100%; }
  .result-stats-grid { grid-template-columns: 1fr; }
  .saved-config-grid,
  .accounts-status-grid,
  .accounts-batch-grid { grid-template-columns: 1fr !important; }
  .accounts-batch-grid > .accounts-counter-pill { grid-column: auto; }
  .quick-actions-grid { grid-template-columns: 1fr; }
  .quick-actions-grid #quickScanMaintainBtn,
  .quick-actions-grid #quickTaskCancelBtn { grid-column: auto; }
  .topbar { padding: calc(8px + env(safe-area-inset-top, 0px)) 12px 8px; }
  .topbar h2 { font-size: 16px; }
  .settings-panel-summary { padding: 12px; }
  .settings-panel-body { padding: 0 12px 12px; }
  .accounts-table tr.account-row {
    grid-template-columns: 32px minmax(0, 1fr);
    grid-template-areas:
      'select email'
      'status status'
      'provider api'
      'quota quota'
      'spark spark'
      'updated updated'
      'actions actions';
  }
  .accounts-table .account-cell-status { align-items: flex-start; padding-left: 12px; }
  .accounts-table .account-cell-provider, .accounts-table .account-cell-api { align-items: flex-start; }
  .topbar-actions { width: 100%; justify-content: stretch; }
  .topbar-actions > * { flex: 1 1 auto; }
  .topbar-right { width: 100%; }
}
</style>
</head>
<body>
<aside class="sidebar" id="appSidebar">
  <div class="sidebar-header">
    <h1>cpa-cron-web</h1>
  </div>
  <nav class="sidebar-nav">
    ${navHtml}
  </nav>
  <div class="sidebar-footer">
    <div class="user-info">
      <div class="user-avatar" id="userAvatar">A</div>
      <div>
        <div class="user-name" id="userName">Admin</div>
        <button class="btn-logout" onclick="logout()">退出登录</button>
      </div>
    </div>
  </div>
</aside>
<div class="sidebar-backdrop" id="sidebarBackdrop" onclick="toggleMobileSidebar(false)"></div>
<div class="main">
  <div class="topbar">
    <div class="topbar-left">
      <button type="button" class="icon-btn mobile-menu-btn" aria-label="切换导航菜单" onclick="toggleMobileSidebar()">
        <span class="material-icons">menu</span>
      </button>
      <div class="topbar-title-group">
        <span class="topbar-kicker">cpa-cron-web</span>
        <h2>${title}</h2>
      </div>
  </div>
  <div class="topbar-right">
      <div id="topbarActions" class="topbar-actions"></div>
    </div>
  </div>
  <div class="content">
    <script>
    async function api(path, opts = {}) {
      const token = localStorage.getItem('cpa_token') || '';
      const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...opts.headers };
      const fetchOpts = { ...opts, headers };
      const resp = await fetch('/api' + path, fetchOpts);
      if (resp.status === 401) {
        localStorage.removeItem('cpa_token');
        window.location.href = '/login';
        return null;
      }
      const contentType = (resp.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json')) {
        try {
          return await resp.json();
        } catch (error) {
          console.error('API JSON 解析失败:', path, error);
          return { ok: false, error: '接口返回了无法解析的 JSON 数据' };
        }
      }

      const text = await resp.text();
      console.error('API 返回非 JSON:', path, resp.status, text.slice(0, 300));
      return {
        ok: false,
        error: '接口返回的不是 JSON，可能是反向代理未转发 /api/*、登录态失效，或服务返回了错误页面',
        status: resp.status,
        raw: text.slice(0, 300),
      };
    }
    window.api = api;
    </script>
    ${content}
  </div>
</div>
<script>
(function() {
  const container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  window.showToast = function(message, type, duration) {
    type = type || 'info';
    duration = duration || 4000;
    const iconMap = { success: 'check_circle', danger: 'error', warning: 'warning', info: 'info' };
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML = '<span class="material-icons">' + (iconMap[type] || 'info') + '</span><span>' + message + '</span>';
    container.appendChild(toast);
    setTimeout(function() {
      toast.classList.add('toast-out');
      setTimeout(function() { toast.remove(); }, 300);
    }, duration);
  };
})();

(function() {
  const tooltip = document.createElement('div');
  tooltip.className = 'app-tooltip';
  document.body.appendChild(tooltip);

  let activeTarget = null;

  function hideTooltip() {
    activeTarget = null;
    tooltip.classList.remove('show');
    tooltip.textContent = '';
  }

  function positionTooltip(clientX, clientY) {
    const offset = 14;
    const rect = tooltip.getBoundingClientRect();
    let left = clientX + offset;
    let top = clientY + offset;

    if (left + rect.width > window.innerWidth - 12) {
      left = Math.max(12, clientX - rect.width - offset);
    }
    if (top + rect.height > window.innerHeight - 12) {
      top = Math.max(12, clientY - rect.height - offset);
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  function showTooltip(target, clientX, clientY) {
    const text = target && target.getAttribute ? target.getAttribute('data-tooltip') : '';
    if (!text) {
      hideTooltip();
      return;
    }
    activeTarget = target;
    tooltip.textContent = text;
    tooltip.classList.add('show');
    positionTooltip(clientX, clientY);
  }

  document.addEventListener('mouseover', function(event) {
    const target = event.target instanceof Element ? event.target.closest('[data-tooltip]') : null;
    if (!target) {
      hideTooltip();
      return;
    }
    showTooltip(target, event.clientX, event.clientY);
  });

  document.addEventListener('mousemove', function(event) {
    if (!activeTarget) return;
    positionTooltip(event.clientX, event.clientY);
  });

  document.addEventListener('mouseout', function(event) {
    if (!activeTarget) return;
    const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (related && activeTarget.contains(related)) return;
    const leaving = event.target instanceof Element ? event.target.closest('[data-tooltip]') : null;
    if (leaving === activeTarget) hideTooltip();
  });

  window.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('blur', hideTooltip);
})();

window.formatChinaTime = function(value) {
  if (!value) return '-';
  const raw = String(value).trim();
  if (!raw) return '-';
  let date = null;
  if (/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$/.test(raw)) {
    date = new Date(raw.replace(' ', 'T') + 'Z');
  } else {
    date = new Date(raw);
  }
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(/\\//g, '-');
};

function isStandaloneMode() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

function toggleMobileSidebar(force) {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar || !backdrop) return;
  const next = typeof force === 'boolean' ? force : !sidebar.classList.contains('show');
  sidebar.classList.toggle('show', next);
  backdrop.classList.toggle('show', next);
  document.body.classList.toggle('sidebar-open', next);
}
window.toggleMobileSidebar = toggleMobileSidebar;

function syncPwaState() {
  const standalone = isStandaloneMode();
  document.body.classList.toggle('pwa-standalone', standalone);
  if (!standalone && window.innerWidth > 768) {
    toggleMobileSidebar(false);
  }
}

async function api(path, opts = {}) {
  const token = localStorage.getItem('cpa_token') || '';
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...opts.headers };
  const fetchOpts = { ...opts, headers };
  const resp = await fetch('/api' + path, fetchOpts);
  if (resp.status === 401) {
    localStorage.removeItem('cpa_token');
    window.location.href = '/login';
    return null;
  }
  const contentType = (resp.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    try {
      return await resp.json();
    } catch (error) {
      console.error('API JSON 解析失败:', path, error);
      return { ok: false, error: '接口返回了无法解析的 JSON 数据' };
    }
  }

  const text = await resp.text();
  console.error('API 返回非 JSON:', path, resp.status, text.slice(0, 300));
  return {
    ok: false,
    error: '接口返回的不是 JSON，可能是反向代理未转发 /api/*、登录态失效，或服务返回了错误页面',
    status: resp.status,
    raw: text.slice(0, 300),
  };
}
window.api = api;

async function logout() {
  await api('/auth/logout', { method: 'POST' });
  localStorage.removeItem('cpa_token');
  window.location.href = '/login';
}
window.logout = logout;

window.addEventListener('DOMContentLoaded', async function() {
  syncPwaState();

  document.querySelectorAll('.nav-item').forEach(function(item) {
    item.addEventListener('click', function() {
      toggleMobileSidebar(false);
    });
  });

  window.addEventListener('resize', function() {
    if (window.innerWidth > 768 && !isStandaloneMode()) toggleMobileSidebar(false);
  });

  const displayModeQuery = window.matchMedia ? window.matchMedia('(display-mode: standalone)') : null;
  if (displayModeQuery) {
    if (displayModeQuery.addEventListener) displayModeQuery.addEventListener('change', syncPwaState);
    else if (displayModeQuery.addListener) displayModeQuery.addListener(syncPwaState);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('${PWA_METADATA.serviceWorkerHref}').catch(function(error) {
        console.warn('PWA service worker 注册失败:', error);
      });
    }, { once: true });
  }

  const me = await api('/auth/me');
  if (me && me.user) {
    const userNameEl = document.getElementById('userName');
    const userAvatarEl = document.getElementById('userAvatar');
    if (userNameEl) userNameEl.textContent = me.user.username;
    if (userAvatarEl) userAvatarEl.textContent = (me.user.username || 'A')[0].toUpperCase();
  }
});
</script>
</body>
</html>`;
}

export function loginPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>登录 - cpa-cron-web</title>
${APP_ICON_LINK_TAGS}
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
<style>
:root {
  --bg: #0f1117;
  --bg-card: #1a1d27;
  --border: #2a2e3d;
  --text: #e4e6eb;
  --text-dim: #8b8fa3;
  --primary: #6c5ce7;
  --primary-hover: #7c6df7;
  --danger: #e74c3c;
  --radius: 8px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { background: var(--bg); }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: radial-gradient(circle at top, rgba(108,92,231,.18), transparent 35%), var(--bg);
  color: var(--text);
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 16px calc(24px + env(safe-area-inset-bottom, 0px));
}
.login-card {
  background: rgba(26,29,39,.96);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 40px 32px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 24px 80px rgba(0,0,0,.36);
  backdrop-filter: blur(14px);
}
.login-card h1 { font-size: 24px; text-align: center; margin-bottom: 8px; color: var(--primary); }
.login-card p { text-align: center; color: var(--text-dim); font-size: 14px; margin-bottom: 28px; }
.form-group { margin-bottom: 20px; }
.form-group label { display: block; font-size: 13px; color: var(--text-dim); margin-bottom: 6px; }
.form-group input {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition: border-color .15s;
}
.form-group input:focus { border-color: var(--primary); }
.btn-login {
  width: 100%;
  padding: 12px;
  border-radius: var(--radius);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all .15s;
}
.btn-login { background: var(--primary); color: #fff; border: none; }
.btn-login:hover { background: var(--primary-hover); }
.btn-login:disabled { opacity: .5; cursor: not-allowed; }
.error-msg {
  background: rgba(231,76,60,.1);
  border: 1px solid rgba(231,76,60,.3);
  color: var(--danger);
  padding: 10px 14px;
  border-radius: var(--radius);
  font-size: 13px;
  margin-bottom: 16px;
  display: none;
}
.footer { text-align: center; margin-top: 24px; font-size: 12px; color: var(--text-dim); line-height: 1.6; }
@media (max-width: 480px) {
  body {
    align-items: stretch;
    justify-content: flex-start;
    padding: calc(14px + env(safe-area-inset-top, 0px)) 12px calc(14px + env(safe-area-inset-bottom, 0px));
  }
  .login-card {
    min-height: calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 28px);
    border-radius: 24px;
    padding: 28px 20px 24px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    box-shadow: 0 18px 48px rgba(0,0,0,.28);
  }
  .login-card h1 { font-size: 26px; }
  .login-card p { margin-bottom: 24px; font-size: 13px; }
  .form-group input { min-height: 46px; font-size: 16px; }
  .btn-login { min-height: 46px; }
  .footer { margin-top: auto; padding-top: 24px; }
}
</style>
</head>
<body>
<div class="login-card">
  <h1>cpa-cron-web</h1>
  <p>CPA 管理控制台</p>
  <div class="error-msg" id="errorMsg"></div>
  <form id="loginForm">
    <div class="form-group">
      <label>用户名</label>
      <input type="text" id="username" placeholder="请输入用户名" autocomplete="username" required>
    </div>
    <div class="form-group">
      <label>密码</label>
      <input type="password" id="password" placeholder="请输入密码" autocomplete="current-password" required>
    </div>
    <button type="submit" class="btn-login" id="loginBtn">登 录</button>
  </form>
  <div class="footer">首次部署请通过环境变量设置管理员账号后再登录</div>
</div>
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('${PWA_METADATA.serviceWorkerHref}').catch(function(error) {
      console.warn('PWA service worker 注册失败:', error);
    });
  }, { once: true });
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const errEl = document.getElementById('errorMsg');
  btn.disabled = true;
  btn.textContent = '登录中...';
  errEl.style.display = 'none';
  try {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
    });
    const data = await resp.json();
    if (data.ok) {
      localStorage.setItem('cpa_token', data.token);
      window.location.href = '/';
    } else {
      errEl.textContent = data.error || '登录失败';
      errEl.style.display = 'block';
    }
  } catch (err) {
    errEl.textContent = '网络错误';
    errEl.style.display = 'block';
  }
  btn.disabled = false;
  btn.textContent = '登 录';
});
</script>
</body>
</html>`;
}
