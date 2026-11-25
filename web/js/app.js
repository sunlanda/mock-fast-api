import { api } from './api.js';
import {
  activeConnection,
  loadBootstrap,
  refreshConnections,
  refreshProjects,
  setActiveConnection,
  state,
} from './store.js';
import { icon, hydrateIcons } from './icons.js';
import { closeDrawer, closeModal, esc, toast, toastError } from './ui.js';
import { openConnectionModal } from './components.js';
import * as workbench from './views/workbench.js';
import * as schemaView from './views/schema.js';
import * as sqlView from './views/sql.js';
import * as logsView from './views/logs.js';
import * as settingsView from './views/settings.js';

const VIEWS = {
  workbench: { meta: { title: '工作台', subtitle: '从 PRD 到可调用的接口，只差一张模板卡片。' }, module: workbench },
  schema: { meta: { title: '数据浏览器', subtitle: '查看表结构、字段、索引与可分页数据。' }, module: schemaView },
  sql: { meta: { title: 'SQL 控制台', subtitle: '带高危拦截的查询与写入；DDL 需要二次确认。' }, module: sqlView },
  logs: { meta: { title: '调用日志', subtitle: '响应时间、请求头、查询参数与响应预览。' }, module: logsView },
  settings: { meta: { title: '设置', subtitle: '数据源策略、日志保留与运行信息。' }, module: settingsView },
};

const viewRoot = document.querySelector('#view-root');
const connTrigger = document.querySelector('#conn-trigger');
const connMenu = document.querySelector('#conn-menu');
const connLabel = document.querySelector('#conn-label');
const themeToggle = document.querySelector('#theme-toggle');
let cleanup = null;
let renderSeq = 0;
let menuOpen = false;

hydrateIcons();
bindShell();
initTheme();
boot();

async function boot() {
  try {
    await loadBootstrap();
    const hashView = window.location.hash.replace(/^#\/?/, '');
    state.view = VIEWS[hashView] ? hashView : 'workbench';
    applyTheme(localStorage.getItem('mf.theme') || state.settings?.theme || 'dark');
    updateTopbar();
    renderConnMenu();
    await renderView();
  } catch (error) {
    viewRoot.innerHTML = `
      <div class="boot-error">
        <span class="boot-error-orb">${icon('alert')}</span>
        <h1>MockFast 没有启动成功</h1>
        <p>${esc(error.message)}</p>
        <p class="muted">请确认本地服务仍在运行，然后重试。也可以查看终端里的 Python 报错。</p>
        <button class="btn btn-primary" id="boot-retry">${icon('refresh')}重新加载</button>
      </div>
    `;
    viewRoot.querySelector('#boot-retry')?.addEventListener('click', () => window.location.reload());
  }
}

function bindShell() {
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelector('.rail')?.classList.remove('is-open');
      setView(button.dataset.view);
    });
  });
  document.querySelector('#mobile-menu')?.addEventListener('click', () => {
    document.querySelector('.rail')?.classList.toggle('is-open');
  });
  themeToggle?.addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    api.put('/api/settings', { theme: state.theme }).catch(() => {});
  });
  connTrigger?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleMenu(!menuOpen);
  });
  connMenu?.addEventListener('click', async (event) => {
    const option = event.target.closest('[data-conn]');
    if (option) {
      const id = option.dataset.conn;
      setActiveConnection(id);
      toggleMenu(false);
      updateTopbar();
      renderConnMenu();
      await renderView({ scroll: false });
      toast('已切换当前数据源', 'info', { duration: 1600 });
      return;
    }
    if (event.target.closest('[data-new-connection]')) {
      toggleMenu(false);
      openConnectionModal();
      return;
    }
    if (event.target.closest('[data-edit-connection]')) {
      toggleMenu(false);
      const active = activeConnection();
      if (active) openConnectionModal(active);
      else openConnectionModal();
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.conn-switch')) toggleMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') toggleMenu(false);
  });
  window.addEventListener('hashchange', () => {
    const view = window.location.hash.replace(/^#\/?/, '');
    if (VIEWS[view] && view !== state.view) {
      closeModal();
      closeDrawer();
      state.view = view;
      renderView();
    }
  });

  window.addEventListener('mf:navigate', (event) => setView(event.detail));
  window.addEventListener('mf:connection-picked', () => {
    updateTopbar();
    renderConnMenu();
  });
  window.addEventListener('mf:connection-selected', async (event) => {
    setActiveConnection(event.detail);
    await refreshConnections();
    await refreshProjects();
    updateTopbar();
    renderConnMenu();
    await renderView({ scroll: false });
  });
  window.addEventListener('mf:connections-changed', async () => {
    await refreshConnections();
    await refreshProjects();
    updateTopbar();
    renderConnMenu();
    await renderView({ scroll: false });
  });
  window.addEventListener('mf:projects-changed', async () => {
    await refreshProjects();
    updateTopbar();
    await renderView({ scroll: false });
  });
  window.addEventListener('mf:settings-changed', async () => {
    try {
      state.settings = await api.get('/api/settings');
    } catch {
      // keep previous settings
    }
    updateTopbar();
    await renderView({ scroll: false });
  });
  window.addEventListener('mf:theme', (event) => {
    applyTheme(event.detail);
    api.put('/api/settings', { theme: event.detail }).catch(() => {});
  });
}

function initTheme() {
  applyTheme(localStorage.getItem('mf.theme') || 'dark');
}

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  state.theme = next;
  document.documentElement.dataset.theme = next;
  localStorage.setItem('mf.theme', next);
  if (themeToggle) {
    const ico = themeToggle.querySelector('.theme-ico');
    const label = themeToggle.querySelector('.theme-label');
    if (ico) ico.innerHTML = icon(next === 'dark' ? 'moon' : 'sun');
    if (label) label.textContent = next === 'dark' ? '深色' : '浅色';
  }
}

function setView(view) {
  if (!VIEWS[view]) return;
  closeModal();
  closeDrawer();
  if (view === state.view) {
    renderView();
    return;
  }
  state.view = view;
  history.pushState(null, '', `#/${view}`);
  renderView({ scroll: true });
  document.querySelector('.rail')?.classList.remove('is-open');
}

async function renderView({ scroll = false } = {}) {
  const entry = VIEWS[state.view] || VIEWS.workbench;
  const seq = ++renderSeq;
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch { /* ignore */ }
  }
  cleanup = null;
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelector('#view-title').textContent = entry.meta.title;
  document.querySelector('#view-subtitle').textContent = entry.meta.subtitle;
  document.title = `${entry.meta.title} · MockFast`;
  viewRoot.innerHTML = '';
  const viewEl = document.createElement('section');
  viewEl.className = 'view';
  viewRoot.appendChild(viewEl);
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  try {
    const result = await entry.module.mount(viewEl);
    if (seq !== renderSeq) return;
    if (typeof result === 'function') cleanup = result;
  } catch (error) {
    if (seq !== renderSeq) return;
    viewEl.innerHTML = `
      <div class="boot-error">
        <span class="boot-error-orb">${icon('alert')}</span>
        <h2>页面加载失败</h2>
        <p>${esc(error.message)}</p>
        <button class="btn btn-primary" id="view-retry">${icon('refresh')}重试</button>
      </div>
    `;
    viewEl.querySelector('#view-retry')?.addEventListener('click', () => renderView());
    toastError(error);
  }
}

function updateTopbar() {
  const active = activeConnection();
  if (connLabel) {
    connLabel.textContent = active ? active.name : '选择数据源';
    connTrigger.title = active ? `${active.target || active.name} · ${active.kind}` : '选择或接入数据源';
    connTrigger.classList.toggle('is-empty', !active);
  }
  const localLabel = document.querySelector('#local-label');
  if (localLabel) {
    localLabel.textContent = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' ? 'LOCAL' : 'LAN';
    document.querySelector('#local-pill')?.setAttribute('title', `${window.location.host} · 数据仅保存在本机`);
  }
}

function renderConnMenu() {
  if (!connMenu) return;
  const active = activeConnection();
  connMenu.innerHTML = `
    <div class="menu-head">
      <span>数据源</span>
      <span class="muted">${state.connections.length}</span>
    </div>
    <div class="menu-list">
      ${state.connections.length ? state.connections.map((conn) => `
        <button class="conn-option ${conn.id === active?.id ? 'is-active' : ''}" data-conn="${conn.id}">
          <span class="conn-option-ico">${icon('database')}</span>
          <span class="conn-option-copy">
            <strong>${esc(conn.name)}</strong>
            <small>${esc(conn.kind === 'postgres' ? 'PostgreSQL' : conn.kind === 'mysql' ? 'MySQL' : conn.kind === 'mongodb' ? 'MongoDB' : 'SQLite')} · ${conn.is_remote ? '远程' : '本机'}${conn.read_only ? ' · 只读' : ''}</small>
          </span>
          ${conn.id === active?.id ? `<span class="conn-option-check">${icon('check')}</span>` : ''}
        </button>
      `).join('') : `<div class="menu-empty">还没有数据源</div>`}
    </div>
    <div class="menu-foot">
      <button class="menu-action" data-new-connection>${icon('plus')}新建连接</button>
      <button class="menu-action" data-edit-connection ${active ? '' : 'disabled'}>${icon('sliders')}编辑当前连接</button>
    </div>
  `;
}

function toggleMenu(open) {
  menuOpen = Boolean(open);
  if (!connMenu) return;
  connMenu.hidden = !menuOpen;
  connTrigger?.setAttribute('aria-expanded', String(menuOpen));
  connTrigger?.classList.toggle('is-open', menuOpen);
  if (menuOpen) renderConnMenu();
}
