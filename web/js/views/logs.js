import { api, apiPath } from '../api.js';
import { state } from '../store.js';
import { icon } from '../icons.js';
import {
  confirmDialog,
  debounce,
  emptyState,
  esc,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
  jsonHighlight,
  openDrawer,
  statusClass,
  toast,
  toastError,
} from '../ui.js';

let auto = true;
let timer = null;
let initialized = false;
let filters = { q: '', status: '', kind: '', project: '', limit: 50 };
let stats = null;
let logs = null;
let resizeObserver = null;

export function mount(container) {
  initialized = false;
  container.innerHTML = layout();
  bind(container);
  load(container, { initial: true });
  timer = setInterval(() => {
    if (!auto || document.hidden || document.body.classList.contains('drawer-open')) return;
    load(container, { silent: true });
  }, 2800);
  resizeObserver = new ResizeObserver(() => drawSpark(container));
  const canvas = container.querySelector('#log-spark');
  if (canvas) resizeObserver.observe(canvas.parentElement);
  return () => {
    clearInterval(timer);
    timer = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
  };
}

function layout() {
  return `
    <div class="page-head">
      <div class="page-heading">
        <div class="eyebrow">REQUEST OBSERVABILITY</div>
        <h1>调用日志</h1>
        <p>每一次 Mock 调用和 SQL 执行都会记录响应时间、请求头、查询参数与响应预览。敏感请求头自动脱敏。</p>
      </div>
      <div class="page-actions">
        <label class="auto-toggle" title="每 2.8 秒自动刷新">
          <input type="checkbox" id="log-auto" ${auto ? 'checked' : ''} />
          <span class="switch-track mini"><span></span></span>
          <span>实时刷新</span>
          <span class="live-dot ${auto ? 'is-on' : ''}"></span>
        </label>
        <button class="btn btn-small btn-ghost" data-action="refresh">${icon('refresh')}刷新</button>
        <button class="btn btn-small btn-danger-ghost" data-action="clear-logs">${icon('trash')}清空</button>
      </div>
    </div>

    <div class="stat-grid">
      ${statCard('总调用', 'stat-total', 'activity', 'mint')}
      ${statCard('今日调用', 'stat-today', 'zap', 'blue')}
      ${statCard('平均响应', 'stat-avg', 'clock', 'amber')}
      ${statCard('P95 响应', 'stat-p95', 'activity', 'violet', true)}
    </div>

    <section class="panel log-panel">
      <div class="log-chart-wrap">
        <div class="log-chart-head">
          <div>
            <strong>响应时间轨迹</strong>
            <small>最近 40 次调用 · 红点表示 4xx / 5xx</small>
          </div>
          <span class="error-rate" id="stat-error">错误率 —</span>
        </div>
        <div class="log-chart"><canvas id="log-spark"></canvas></div>
      </div>

      <div class="log-toolbar">
        <label class="search-field">
          ${icon('search')}
          <input id="log-q" placeholder="搜索路径、方法或请求体…" value="${esc(filters.q)}" />
        </label>
        <select id="log-status" class="mini-select">
          ${[
            ['', '全部状态'],
            ['2xx', '2xx 成功'],
            ['4xx', '4xx 客户端错误'],
            ['5xx', '5xx 服务错误'],
            ['error', '所有错误'],
          ].map(([value, label]) => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <select id="log-kind" class="mini-select">
          <option value="">全部类型</option>
          <option value="mock" ${filters.kind === 'mock' ? 'selected' : ''}>Mock 调用</option>
          <option value="sql" ${filters.kind === 'sql' ? 'selected' : ''}>SQL 执行</option>
        </select>
        <select id="log-project" class="mini-select">
          <option value="">全部项目</option>
          ${state.projects.map((project) => `<option value="${esc(project.slug)}" ${filters.project === project.slug ? 'selected' : ''}>${esc(project.name)}</option>`).join('')}
        </select>
        <select id="log-limit" class="mini-select">
          ${[20, 50, 100, 200].map((limit) => `<option value="${limit}" ${filters.limit === limit ? 'selected' : ''}>最近 ${limit} 条</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <span class="muted tiny" id="log-count">—</span>
      </div>

      <div class="log-table-wrap" id="log-table">
        ${tableSkeleton()}
      </div>
    </section>
  `;
}

function statCard(label, id, iconName, tone, extra = false) {
  return `
    <div class="stat-card tone-${tone}">
      <div class="stat-icon">${icon(iconName)}</div>
      <div class="stat-copy">
        <span>${label}</span>
        <strong id="${id}">—</strong>
        ${extra ? '<small id="stat-extra">—</small>' : ''}
      </div>
    </div>
  `;
}

function tableSkeleton() {
  return `<div class="log-skeleton">${Array.from({ length: 8 }).map(() => `
    <div class="log-skeleton-row"><span></span><span></span><span></span><span></span></div>
  `).join('')}</div>`;
}

async function load(container, { silent = false, initial = false } = {}) {
  if (!container.querySelector('#log-table')) return;
  try {
    const [statsData, logData] = await Promise.all([
      api.get('/api/logs/stats'),
      api.get(apiPath('/api/logs', {
        limit: filters.limit,
        status: filters.status,
        kind: filters.kind,
        project: filters.project,
        q: filters.q,
      })),
    ]);
    stats = statsData;
    logs = logData;
    renderStats(container);
    renderTable(container);
    drawSpark(container);
    initialized = true;
  } catch (error) {
    if (!silent || initial) toastError(error);
    if (initial) {
      container.querySelector('#log-table').innerHTML = `<div class="inline-error large">${icon('alert')} 日志加载失败：${esc(error.message)}</div>`;
    }
  }
}

function renderStats(container) {
  if (!stats) return;
  const total = container.querySelector('#stat-total');
  const today = container.querySelector('#stat-today');
  const avg = container.querySelector('#stat-avg');
  const p95 = container.querySelector('#stat-p95');
  const error = container.querySelector('#stat-error');
  const extra = container.querySelector('#stat-extra');
  if (total) total.textContent = formatNumber(stats.total);
  if (today) today.textContent = formatNumber(stats.today);
  if (avg) avg.textContent = stats.avg_ms ? formatDuration(stats.avg_ms) : '—';
  if (p95) p95.textContent = stats.p95_ms ? formatDuration(stats.p95_ms) : '—';
  if (extra) extra.textContent = `近 ${formatNumber(Math.min(stats.total, 1000))} 次样本`;
  if (error) {
    error.textContent = `错误率 ${stats.error_rate}%`;
    error.className = `error-rate ${stats.error_rate > 5 ? 'is-high' : ''}`;
  }
}

function renderTable(container) {
  const wrap = container.querySelector('#log-table');
  const count = container.querySelector('#log-count');
  if (!wrap || !logs) return;
  count.textContent = `${formatNumber(logs.total)} 条记录 · 显示最近 ${logs.items.length} 条`;
  if (!logs.items.length) {
    wrap.innerHTML = emptyState({
      iconName: 'activity',
      title: '还没有调用记录',
      description: '调用任意 /mock 接口，或在 SQL 控制台执行一条语句，这里就会实时出现记录。',
      action: `<button class="btn btn-ghost" data-action="refresh">${icon('refresh')}刷新</button>`,
    });
    return;
  }
  const maxDuration = Math.max(...logs.items.map((item) => item.duration_ms || 1), 1);
  wrap.innerHTML = `
    <table class="data-table log-table">
      <thead><tr>
        <th class="col-time">时间</th>
        <th>方法</th>
        <th>路径</th>
        <th>状态</th>
        <th>响应时间</th>
        <th>大小</th>
        <th class="col-client">来源</th>
      </tr></thead>
      <tbody>
        ${logs.items.map((log) => `
          <tr class="log-row" data-log-id="${log.id}">
            <td class="col-time"><span title="${esc(log.ts)}">${formatDateTime(log.ts)}</span></td>
            <td><span class="method ${log.method.toLowerCase()}">${esc(log.method)}</span></td>
            <td class="col-path">
              <span class="path-text" title="${esc(log.path + (log.query ? `?${log.query}` : ''))}">${esc(log.path)}</span>
              ${log.project_slug ? `<span class="tag tag-mini">${esc(log.project_slug)}</span>` : `<span class="tag tag-mini tag-soft">${log.kind === 'sql' ? 'SQL' : 'API'}</span>`}
            </td>
            <td><span class="status-pill ${statusClass(log.status)}">${log.status}</span></td>
            <td>
              <div class="duration-cell">
                <span>${formatDuration(log.duration_ms)}</span>
                <span class="duration-bar"><i style="width:${Math.max(3, Math.min(100, (log.duration_ms / maxDuration) * 100))}%"></i></span>
              </div>
            </td>
            <td class="muted">${formatBytes(log.size)}</td>
            <td class="col-client mono muted" title="${esc(log.client || '')}">${esc(log.client || '—')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function drawSpark(container) {
  const canvas = container.querySelector('#log-spark');
  if (!canvas || !stats) return;
  const width = canvas.parentElement.clientWidth || 600;
  const height = canvas.parentElement.clientHeight || 120;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const series = stats.series || [];
  const pad = { top: 14, right: 10, bottom: 16, left: 10 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i += 1) {
    const y = pad.top + (chartH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }
  if (!series.length) {
    ctx.fillStyle = 'rgba(139,160,173,.7)';
    ctx.font = '12px ui-sans-serif, system-ui';
    ctx.fillText('等待第一次调用…', pad.left + 4, pad.top + chartH / 2);
    return;
  }
  const max = Math.max(...series.map((item) => item.duration_ms || 0), 1);
  const step = series.length > 1 ? chartW / (series.length - 1) : chartW;
  const points = series.map((item, index) => ({
    x: pad.left + step * index,
    y: pad.top + chartH - ((item.duration_ms || 0) / max) * (chartH - 8),
    status: item.status,
  }));
  const gradient = ctx.createLinearGradient(0, pad.top, 0, height);
  gradient.addColorStop(0, 'rgba(72,224,164,.28)');
  gradient.addColorStop(1, 'rgba(72,224,164,0)');
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(points[points.length - 1].x, pad.top + chartH);
  ctx.lineTo(points[0].x, pad.top + chartH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = '#48e0a4';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  points.forEach((point) => {
    if (point.status >= 400) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.8, 0, Math.PI * 2);
      ctx.fillStyle = '#fb7185';
      ctx.fill();
    }
  });
}

function bind(container) {
  container.addEventListener('click', async (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === 'refresh') {
        load(container);
      } else if (action === 'clear-logs') {
        const ok = await confirmDialog({
          title: '清空调用日志？',
          message: '会删除全部请求记录，但不会影响 Mock 项目或数据库数据。',
          confirmText: '清空日志',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.del('/api/logs');
          toast('调用日志已清空', 'success');
          await load(container);
        } catch (error) {
          toastError(error);
        }
      }
      return;
    }
    const row = event.target.closest('[data-log-id]');
    if (row) {
      openLogDetail(Number(row.dataset.logId));
    }
  });

  container.addEventListener('change', async (event) => {
    if (event.target.id === 'log-auto') {
      auto = event.target.checked;
      const dot = container.querySelector('.auto-toggle .live-dot');
      dot?.classList.toggle('is-on', auto);
      toast(auto ? '已开启实时刷新' : '已暂停实时刷新', 'info', { duration: 1600 });
    }
    if (event.target.id === 'log-status') filters.status = event.target.value;
    if (event.target.id === 'log-kind') filters.kind = event.target.value;
    if (event.target.id === 'log-project') filters.project = event.target.value;
    if (event.target.id === 'log-limit') filters.limit = Number(event.target.value);
    if (['log-status', 'log-kind', 'log-project', 'log-limit'].includes(event.target.id)) {
      await load(container);
    }
  });

  const onSearch = debounce(() => load(container), 350);
  container.addEventListener('input', (event) => {
    if (event.target.id === 'log-q') {
      filters.q = event.target.value;
      onSearch();
    }
  });
}

async function openLogDetail(id) {
  try {
    const log = await api.get(`/api/logs/${id}`);
    const queryRows = [...new URLSearchParams(log.query || '').entries()];
    const bodyHtml = prettyBody(log.req_body);
    const respHtml = prettyBody(log.resp_preview);
    const curl = buildCurl(log);
    const body = `
      <div class="log-detail-meta">
        <div class="log-detail-method">
          <span class="method ${log.method.toLowerCase()}">${esc(log.method)}</span>
          <span class="status-pill ${statusClass(log.status)}">${log.status}</span>
          <span class="pill">${formatDuration(log.duration_ms)}</span>
          <span class="pill">${formatBytes(log.size)}</span>
        </div>
        <code class="log-detail-path">${esc(log.path)}${log.query ? `?${esc(log.query)}` : ''}</code>
        <div class="log-detail-sub">
          <span>${formatDateTime(log.ts)}</span>
          <span>·</span>
          <span>${esc(log.kind === 'sql' ? 'SQL 执行' : 'Mock 调用')}</span>
          ${log.project_slug ? `<span>·</span><span>${esc(log.project_slug)}</span>` : ''}
          <span>·</span>
          <span class="mono">${esc(log.client || '—')}</span>
        </div>
      </div>
      <div class="log-detail-actions">
        <button class="btn btn-small btn-ghost" id="copy-curl">${icon('copy')}复制 cURL</button>
        <button class="btn btn-small btn-ghost" id="copy-json">${icon('copy')}复制响应 JSON</button>
      </div>

      <details class="log-section" open>
        <summary>${icon('terminal')}请求头 <span>${Object.keys(log.req_headers || {}).length}</span></summary>
        ${kvTable(log.req_headers)}
      </details>

      <details class="log-section" ${log.query ? 'open' : ''}>
        <summary>${icon('filter')}查询参数 <span>${queryRows.length}</span></summary>
        ${queryRows.length ? `<div class="kv-table">${queryRows.map(([key, value]) => `
          <div class="kv-row"><span class="kv-key">${esc(key)}</span><code class="kv-val">${esc(value)}</code></div>
        `).join('')}</div>` : '<p class="muted log-empty-line">没有查询参数</p>'}
      </details>

      <details class="log-section" ${log.req_body ? 'open' : ''}>
        <summary>${icon('braces')}请求体</summary>
        ${bodyHtml}
      </details>

      <details class="log-section">
        <summary>${icon('server')}响应头 <span>${Object.keys(log.resp_headers || {}).length}</span></summary>
        ${kvTable(log.resp_headers)}
      </details>

      <details class="log-section" open>
        <summary>${icon('eye')}响应预览 ${log.error ? '<em class="tag tag-warn">ERROR</em>' : ''}</summary>
        ${respHtml}
      </details>
    `;
    const drawer = openDrawer({
      title: `${log.method} ${log.path}`,
      subtitle: `${formatDateTime(log.ts)} · ${formatDuration(log.duration_ms)} · ${log.status}`,
      body,
      width: '620px',
      onMount: (panel) => {
        panel.querySelector('#copy-curl').addEventListener('click', async () => {
          await navigator.clipboard?.writeText(curl);
          toast('cURL 已复制', 'success');
        });
        panel.querySelector('#copy-json').addEventListener('click', async () => {
          await navigator.clipboard?.writeText(log.resp_preview || '');
          toast('响应内容已复制', 'success');
        });
      },
    });
    void drawer;
  } catch (error) {
    toastError(error);
  }
}

function kvTable(headers = {}) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return '<p class="muted log-empty-line">没有记录到请求头</p>';
  return `<div class="kv-table">${entries.map(([key, value]) => `
    <div class="kv-row"><span class="kv-key mono">${esc(key)}</span><code class="kv-val">${esc(value)}</code></div>
  `).join('')}</div>`;
}

function prettyBody(body) {
  if (!body) return '<p class="muted log-empty-line">空</p>';
  try {
    const parsed = JSON.parse(body);
    return `<pre class="code-block log-code"><code>${jsonHighlight(parsed)}</code></pre>`;
  } catch {
    return `<pre class="code-block log-code"><code>${esc(body)}</code></pre>`;
  }
}

function buildCurl(log) {
  const url = `${window.location.origin}${log.path}${log.query ? `?${log.query}` : ''}`;
  const headers = log.req_headers || {};
  const ignored = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'cookie', 'authorization']);
  const headerArgs = Object.entries(headers)
    .filter(([key]) => !ignored.has(key))
    .map(([key, value]) => `  -H "${key}: ${String(value).replace(/"/g, '\\"')}"`)
    .join(' \\\n');
  const body = log.req_body ? ` \\\n  --data-raw '${log.req_body.replace(/'/g, "'\\''")}'` : '';
  return `curl -X ${log.method} '${url}'${headerArgs ? ` \\\n${headerArgs}` : ''}${body}`;
}
