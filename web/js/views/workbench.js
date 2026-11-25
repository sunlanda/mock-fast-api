import { api } from '../api.js';
import {
  activeConnection,
  formatMeta,
  refreshProjects,
  setActiveConnection,
  state,
} from '../store.js';
import { icon } from '../icons.js';
import {
  copyWithToast,
  emptyState,
  esc,
  formatDuration,
  formatNumber,
  jsonHighlight,
  openModal,
  toast,
  toastError,
  confirmDialog,
} from '../ui.js';
import { openConnectionModal, openPreview, openProjectModal, absoluteUrl } from '../components.js';

export function mount(container) {
  document.title = '工作台 · MockFast';
  const active = activeConnection();
  const projectCount = state.projects.length;
  const heroProject =
    state.projects.find((project) => project.table_name === 'users') ||
    state.projects[0];
  const heroSlug = heroProject?.slug || 'user-center';
  const heroTable = heroProject?.table_name || 'users';

  container.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow"><span class="pulse-dot"></span> LOCAL-FIRST API MOCK STUDIO</div>
        <h1>PRD 刚到手，<br /><em>接口已经能调了。</em></h1>
        <p class="hero-lede">
          选一个数据库、点一张模板卡片，MockFast 自动建表、灌入带分页的种子数据，
          并开放一套可直接调用的 REST 接口。前端先跑起来，后端慢慢来。
        </p>
        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" data-action="scroll-templates">
            ${icon('spark')} 选一张模板卡片
            <span class="btn-arrow">${icon('arrow-right')}</span>
          </button>
          <button class="btn btn-ghost btn-lg" data-action="new-connection">
            ${icon('database')} 连接我的数据库
          </button>
        </div>
        <div class="hero-stats">
          <div class="hero-stat"><strong>${formatNumber(state.connections.length)}</strong><span>数据源</span></div>
          <div class="hero-stat"><strong>${formatNumber(projectCount)}</strong><span>Mock 接口</span></div>
          <div class="hero-stat"><strong id="hero-today">—</strong><span>今日调用</span></div>
          <div class="hero-stat"><strong id="hero-avg">—</strong><span>平均响应</span></div>
        </div>
      </div>

      <div class="hero-visual" aria-hidden="true">
        <div class="terminal-card">
          <div class="terminal-bar">
            <span class="terminal-dots"><i></i><i></i><i></i></span>
            <span class="terminal-path">GET /mock/${esc(heroSlug)}?page=1&amp;pageSize=3</span>
            <span class="terminal-ms">12.4 ms</span>
          </div>
          <div class="terminal-status">
            <span class="status-ok">200 OK</span>
            <span class="mono">application/json</span>
            <span class="mono">×-mock-source: MockFast</span>
          </div>
          <pre class="terminal-code"><code>${jsonHighlight({
            code: 0,
            message: 'ok',
            result: {
              data: {
                list: [
                  { id: 1, name: '林晚', role: 'editor', status: 'active' },
                  { id: 2, name: '陈予安', role: 'viewer', status: 'active' },
                  { id: 3, name: '江屿', role: 'admin', status: 'active' },
                ],
                pagination: { page: 1, pageSize: 3, total: 26, totalPages: 9 },
              },
            },
          })}</code></pre>
          <div class="terminal-foot">
            <span>${icon('database')} ${esc(heroTable)}</span>
            <span>${icon('clock')} 12.4 ms</span>
            <span class="terminal-live"><i></i> LIVE</span>
          </div>
        </div>
        <div class="float-chip chip-a"><span>${icon('layers')}</span> 分页已就绪</div>
        <div class="float-chip chip-b"><span>${icon('shield')}</span> SQL 安全拦截</div>
        <div class="float-chip chip-c"><span>${icon('activity')}</span> 请求日志</div>
      </div>
    </section>

    <section class="section" id="datasource-section">
      ${sectionHead('01', '先选数据源', '本地 SQLite 开箱即用，也可以接 PostgreSQL / MySQL / MongoDB。', `
        <button class="btn btn-small btn-ghost" data-action="new-connection">${icon('plus')}新建连接</button>
      `)}
      <div class="conn-cards">
        ${state.connections.map((conn) => connectionCard(conn, active?.id)).join('')}
        <button class="conn-card conn-add" data-action="new-connection" type="button">
          <span class="conn-add-orb">${icon('plus')}</span>
          <strong>接入新数据源</strong>
          <small>SQLite / PostgreSQL / MySQL / MongoDB</small>
        </button>
      </div>
      <div class="policy-strip ${state.settings?.allow_remote_db ? 'is-open' : ''}">
        <span class="policy-ico">${icon(state.settings?.allow_remote_db ? 'server' : 'lock')}</span>
        <p>
          ${state.settings?.allow_remote_db
            ? '远程数据库访问已开启。建议为远程连接勾选「只读」，并确认不是生产库。'
            : '当前只允许本机地址。远程数据库需要到设置里显式开启，避免误连生产环境。'}
        </p>
        <button class="text-link" data-action="go-settings" type="button">查看安全策略 →</button>
      </div>
    </section>

    <section class="section" id="templates-section">
      ${sectionHead('02', '选一张模板卡片', '每张卡片都带着一套表结构、可信的示例数据和响应格式；点选后自动套用。', `
        <span class="section-badge">${state.templates.length} 套模板</span>
      `)}
      <div class="template-grid">
        ${state.templates.map((template) => templateCard(template, Boolean(active))).join('')}
      </div>
    </section>

    <section class="section" id="projects-section">
      ${sectionHead('03', '你的 Mock 接口', projectCount
        ? '每个项目都暴露了列表、详情、新增、更新和删除接口，调用记录会实时写进日志。'
        : '还没有接口。选一张模板卡片，60 秒后就能拿到第一组可调用的地址。', `
        <button class="btn btn-small btn-ghost" data-action="go-schema">${icon('database')}浏览已有表</button>
      `)}
      <div class="project-list">
        ${projectCount
          ? state.projects.map((project) => projectCard(project)).join('')
          : emptyState({
              iconName: 'layers',
              title: '还没有 Mock 接口',
              description: '从模板开始最快：自动建表、灌数据、生成 CRUD，一步到位。',
              action: `<button class="btn btn-primary" data-action="scroll-templates">${icon('spark')}挑一张模板</button>`,
            })}
      </div>
    </section>
  `;

  bind(container);
  loadStats(container);
  return null;
}

function sectionHead(index, title, description, actions = '') {
  return `
    <div class="section-head">
      <span class="section-index">${index}</span>
      <div class="section-copy">
        <h2>${esc(title)}</h2>
        <p>${esc(description)}</p>
      </div>
      <div class="section-actions">${actions}</div>
    </div>
  `;
}

function connectionCard(conn, activeId) {
  const isActive = conn.id === activeId;
  return `
    <button class="conn-card ${isActive ? 'is-active' : ''}" data-action="select-connection" data-id="${conn.id}" type="button">
      <span class="conn-card-top">
        <span class="conn-kind tone-${conn.kind}">${icon('database')}</span>
        <span class="conn-badges">
          ${conn.is_remote ? '<span class="tag tag-warn">远程</span>' : '<span class="tag">本机</span>'}
          ${conn.read_only ? '<span class="tag tag-lock">只读</span>' : ''}
        </span>
        ${isActive ? `<span class="conn-check">${icon('check')}</span>` : ''}
      </span>
      <strong>${esc(conn.name)}</strong>
      <small class="mono conn-target" title="${esc(conn.target)}">${esc(conn.target)}</small>
      <span class="conn-foot">
        <span>${esc(kindName(conn.kind))}</span>
        <span>${conn.has_password ? '已保存凭据' : '无密码'}</span>
      </span>
    </button>
  `;
}

function kindName(kind) {
  return { sqlite: 'SQLite', postgres: 'PostgreSQL', mysql: 'MySQL', mongodb: 'MongoDB' }[kind] || kind;
}

function templateCard(template, enabled) {
  return `
    <article class="template-card tone-${template.tone} ${enabled ? '' : 'is-disabled'}" data-action="use-template" data-template="${template.id}">
      <div class="template-top">
        <span class="template-ico">${icon(template.icon)}</span>
        <span class="template-badge">${esc(template.badge)}</span>
        <span class="template-go">${icon('arrow-up-right')}</span>
      </div>
      <div class="template-body">
        <h3>${esc(template.name)}</h3>
        <p class="template-tagline">${esc(template.tagline)}</p>
        <p class="template-desc">${esc(template.description)}</p>
      </div>
      <div class="template-fields">
        ${template.columns.slice(0, 5).map((column) => `<span>${esc(column.name)}</span>`).join('')}
        ${template.columns.length > 5 ? `<span class="more">+${template.columns.length - 5}</span>` : ''}
      </div>
      <div class="template-foot">
        <span class="mono">${esc(template.table)}</span>
        <span>${template.field_count} 字段</span>
        <span class="template-cta">${enabled ? '套用模板' : '先连接数据库'} ${icon('arrow-right')}</span>
      </div>
    </article>
  `;
}

function endpointCopyPath(project, path) {
  return absoluteUrl(path.replace(':id', '1'));
}

function projectCard(project) {
  const base = absoluteUrl(project.base_path);
  const format = formatMeta(project.response_format);
  return `
    <article class="project-card" data-project="${project.id}">
      <header class="project-head">
        <div class="project-title">
          <span class="project-orb tone-${project.connection_kind || 'sqlite'}">${icon('layers')}</span>
          <div>
            <div class="project-name-row">
              <h3>${esc(project.name)}</h3>
              <span class="tag mono">${esc(project.table_name)}</span>
              <span class="tag tag-soft">${esc(project.connection_kind_label || '')}</span>
            </div>
            <p>${esc(project.connection_name)} · <span class="mono">${esc(project.base_path)}</span></p>
          </div>
        </div>
        <div class="project-actions">
          <label class="format-picker" title="切换响应格式">
            <span>${icon('braces')}</span>
            <select data-format-select data-id="${project.id}">
              ${state.formats.map((item) => `<option value="${esc(item.id)}" ${item.id === project.response_format ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}
            </select>
          </label>
          <button class="icon-btn" data-action="preview" data-id="${project.id}" title="预览响应">${icon('eye')}</button>
          <button class="icon-btn danger" data-action="delete-project" data-id="${project.id}" title="删除项目">${icon('trash')}</button>
        </div>
      </header>

      <div class="base-url">
        <span class="base-label">BASE</span>
        <code>${esc(base)}</code>
        <button class="icon-btn tiny" data-action="copy" data-copy="${esc(base)}" title="复制 Base URL">${icon('copy')}</button>
        <a class="icon-btn tiny" href="${esc(base)}" target="_blank" rel="noreferrer" title="打开接口">${icon('external')}</a>
      </div>

      <div class="endpoint-list">
        ${project.endpoints.map((endpoint) => `
          <div class="endpoint-row">
            <span class="method ${endpoint.method.toLowerCase()}">${endpoint.method}</span>
            <code>${esc(endpoint.path)}</code>
            <span class="endpoint-label">${esc(endpoint.label)}</span>
            <button class="icon-btn tiny" data-action="copy" data-copy="${esc(endpointCopyPath(project, endpoint.path))}" title="复制完整地址">${icon('copy')}</button>
          </div>
        `).join('')}
      </div>

      <footer class="project-foot">
        <div class="seed-actions">
          <span class="seed-label">${icon('zap')}快速造数</span>
          ${[1, 5, 20].map((count) => `<button class="chip-btn" data-action="seed" data-id="${project.id}" data-count="${count}">+${count} 条</button>`).join('')}
        </div>
        <div class="project-foot-actions">
          <span class="muted tiny">${format ? esc(format.name) : esc(project.response_format)}</span>
          <button class="btn btn-small btn-ghost" data-action="test-api" data-id="${project.id}">${icon('send')}试调用</button>
          <button class="btn btn-small btn-primary-ghost" data-action="preview" data-id="${project.id}">${icon('eye')}预览</button>
        </div>
      </footer>
    </article>
  `;
}

async function loadStats(container) {
  try {
    const stats = await api.get('/api/logs/stats');
    const today = container.querySelector('#hero-today');
    const avg = container.querySelector('#hero-avg');
    if (today) today.textContent = formatNumber(stats.today);
    if (avg) avg.textContent = stats.avg_ms ? formatDuration(stats.avg_ms) : '—';
  } catch {
    // Stats are decorative; ignore failures.
  }
}

function bind(container) {
  container.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'scroll-templates') {
      container.querySelector('#templates-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'new-connection') {
      openConnectionModal();
    } else if (action === 'select-connection') {
      setActiveConnection(target.dataset.id);
      container.querySelectorAll('.conn-card[data-action="select-connection"]').forEach((card) => {
        card.classList.toggle('is-active', card.dataset.id === target.dataset.id);
        const check = card.querySelector('.conn-check');
        if (card.dataset.id === target.dataset.id && !check) {
          card.querySelector('.conn-card-top')?.insertAdjacentHTML('beforeend', `<span class="conn-check">${icon('check')}</span>`);
        } else if (card.dataset.id !== target.dataset.id) {
          check?.remove();
        }
      });
      window.dispatchEvent(new CustomEvent('mf:connection-picked', { detail: target.dataset.id }));
      toast('已切换当前数据源', 'info', { duration: 1800 });
    } else if (action === 'go-settings') {
      window.dispatchEvent(new CustomEvent('mf:navigate', { detail: 'settings' }));
    } else if (action === 'go-schema') {
      window.dispatchEvent(new CustomEvent('mf:navigate', { detail: 'schema' }));
    } else if (action === 'use-template') {
      const template = state.templates.find((item) => item.id === target.dataset.template);
      if (!activeConnection()) {
        toast('请先接入一个数据源', 'warn');
        openConnectionModal();
        return;
      }
      openProjectModal({ template });
    } else if (action === 'preview') {
      const project = state.projects.find((item) => item.id === target.dataset.id);
      if (project) openPreview(project);
    } else if (action === 'seed') {
      const id = target.dataset.id;
      const count = Number(target.dataset.count || 5);
      const buttons = container.querySelectorAll(`[data-action="seed"][data-id="${id}"]`);
      buttons.forEach((button) => { button.disabled = true; });
      try {
        const result = await api.post(`/api/projects/${id}/seed`, { count });
        toast(
          result.errors?.length ? `写入 ${result.inserted} 条，${result.errors.length} 条失败` : `已追加 ${result.inserted} 条种子数据`,
          result.errors?.length ? 'warn' : 'success'
        );
      } catch (error) {
        toastError(error);
      } finally {
        buttons.forEach((button) => { button.disabled = false; });
      }
    } else if (action === 'copy') {
      copyWithToast(target.dataset.copy, '完整地址已复制');
    } else if (action === 'test-api') {
      const project = state.projects.find((item) => item.id === target.dataset.id);
      if (project) testApi(project);
    } else if (action === 'delete-project') {
      const project = state.projects.find((item) => item.id === target.dataset.id);
      if (!project) return;
      const ok = await confirmDialog({
        title: '删除这个 Mock 项目？',
        message: `将删除接口 <b>${esc(project.name)}</b>。数据库中的表和数据会保留，之后仍可在「数据浏览器」里重新生成接口。`,
        confirmText: '删除项目',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/api/projects/${project.id}`);
        await refreshProjects();
        toast('Mock 项目已删除', 'success');
        window.dispatchEvent(new CustomEvent('mf:projects-changed'));
      } catch (error) {
        toastError(error);
      }
    }
  });

  container.addEventListener('change', async (event) => {
    const select = event.target.closest('[data-format-select]');
    if (!select) return;
    const project = state.projects.find((item) => item.id === select.dataset.id);
    if (!project) return;
    try {
      const updated = await api.patch(`/api/projects/${project.id}`, { response_format: select.value });
      project.response_format = updated.response_format;
      toast(`响应格式已切换为 ${updated.response_format}`, 'success');
    } catch (error) {
      toastError(error);
      select.value = project.response_format;
    }
  });
}

async function testApi(project) {
  const url = `${absoluteUrl(project.base_path)}?page=1&pageSize=2`;
  const started = performance.now();
  let status = 0;
  let body = null;
  let error = null;
  try {
    const response = await fetch(url);
    status = response.status;
    body = await response.json();
  } catch (err) {
    error = err;
  }
  const duration = performance.now() - started;
  const modal = openModal({
    title: '试调用',
    subtitle: `${project.name} · ${url.replace(window.location.origin, '')}`,
    eyebrow: status ? `HTTP ${status}` : 'NETWORK ERROR',
    iconName: 'send',
    size: 'lg',
    body: `<div class="preview-loading"><span class="spinner"></span><span>请求中…</span></div>`,
  });
  const content = document.createElement('div');
  if (error) {
    content.innerHTML = `<div class="inline-error">请求失败：${esc(error.message)}</div>`;
  } else {
    content.innerHTML = `
      <div class="preview-meta">
        <span class="status-pill ${status >= 400 ? 'is-warn' : 'is-ok'}">${status}</span>
        <span class="pill">${esc(formatDuration(duration))}</span>
        <span class="muted">${esc(project.table_name)} · pageSize=2</span>
        <span class="spacer"></span>
        <button class="btn btn-small btn-ghost" id="test-copy" type="button">${icon('copy')}复制响应</button>
      </div>
      <pre class="code-block"><code>${jsonHighlight(body)}</code></pre>
      <div class="curl-block">
        <span>cURL</span>
        <code>curl "${esc(url)}"</code>
        <button class="icon-btn" id="test-copy-curl" type="button" title="复制 cURL">${icon('copy')}</button>
      </div>
    `;
  }
  modal.panel.querySelector('.modal-body').replaceChildren(content);
  if (!error) {
    content.querySelector('#test-copy').addEventListener('click', () => copyWithToast(JSON.stringify(body, null, 2), '响应已复制'));
    content.querySelector('#test-copy-curl').addEventListener('click', () => copyWithToast(`curl "${url}"`, 'cURL 已复制'));
  }
}
