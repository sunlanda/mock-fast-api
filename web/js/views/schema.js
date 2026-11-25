import { api, apiPath } from '../api.js';
import { activeConnection } from '../store.js';
import { icon } from '../icons.js';
import {
  confirmDialog,
  copyWithToast,
  debounce,
  emptyState,
  esc,
  formatNumber,
  jsonHighlight,
  openDrawer,
  skeleton,
  toast,
  toastError,
} from '../ui.js';
import { openConnectionModal, openProjectModal, openRowModal } from '../components.js';

let conn = null;
let schemas = [];
let schema = null;
let tables = [];
let activeTable = null;
let detail = null;
let rows = null;
let tab = 'structure';
let page = 1;
let pageSize = 20;
let sort = null;
let order = 'asc';
let query = '';
let tableFilter = '';
let loading = false;

export function mount(container) {
  conn = activeConnection();
  if (!conn) {
    container.innerHTML = emptyState({
      iconName: 'database',
      title: '还没有可浏览的数据源',
      description: '接入 SQLite、PostgreSQL、MySQL 或 MongoDB 后，这里会展示表结构、字段、索引和数据。',
      action: `<button class="btn btn-primary" data-action="new-connection">${icon('plus')}接入数据源</button>`,
    });
    container.querySelector('[data-action="new-connection"]')?.addEventListener('click', () => openConnectionModal());
    return null;
  }
  container.innerHTML = layout();
  bind(container);
  boot(container);
  return null;
}

function layout() {
  return `
    <div class="page-head">
      <div class="page-heading">
        <div class="eyebrow">DATABASE EXPLORER</div>
        <h1>数据浏览器</h1>
        <p>查看真实表结构与数据，像用专业数据库客户端一样；选好表就能一键生成 Mock 接口。</p>
      </div>
      <div class="page-actions">
        <span class="conn-pill">${icon('database')}<span>${esc(conn.name)}</span><em>${esc(kindName(conn.kind))}</em></span>
        ${conn.read_only ? `<span class="tag tag-lock">${icon('lock')}只读</span>` : ''}
        <label class="select-wrap" title="切换 schema">
          ${icon('layers')}
          <select id="schema-select" class="mini-select" disabled><option>加载中…</option></select>
        </label>
        <button class="icon-btn" data-action="refresh" title="刷新">${icon('refresh')}</button>
      </div>
    </div>

    <div class="browser-grid">
      <aside class="panel table-panel">
        <div class="table-panel-head">
          <div>
            <h2>${conn.kind === 'mongodb' ? '集合' : '表'}</h2>
            <span class="muted" id="table-count">—</span>
          </div>
          <button class="icon-btn tiny" data-action="refresh-tables" title="刷新列表">${icon('refresh')}</button>
        </div>
        <label class="search-field">
          ${icon('search')}
          <input id="table-search" placeholder="筛选表名…" autocomplete="off" />
        </label>
        <div class="table-list" id="table-list">${skeleton(6)}</div>
        <div class="table-panel-foot">
          <span class="dot"></span>
          <span>${esc(conn.target || conn.name)}</span>
        </div>
      </aside>

      <section class="panel table-main" id="table-main">
        ${skeleton(8)}
      </section>
    </div>
  `;
}

function kindName(kind) {
  return { sqlite: 'SQLite', postgres: 'PostgreSQL', mysql: 'MySQL', mongodb: 'MongoDB' }[kind] || kind;
}

async function boot(container) {
  try {
    const data = await api.get(`/api/connections/${conn.id}/schemas`);
    schemas = data.schemas || [];
    schema = data.default || schemas[0] || null;
    const select = container.querySelector('#schema-select');
    select.disabled = false;
    select.innerHTML = schemas.length
      ? schemas.map((item) => `<option value="${esc(item)}" ${item === schema ? 'selected' : ''}>${esc(item)}</option>`).join('')
      : `<option value="">默认</option>`;
    await loadTables(container, { keepActive: false });
  } catch (error) {
    container.querySelector('#table-main').innerHTML = errorState(error.message);
    container.querySelector('#table-list').innerHTML = '';
    toastError(error);
  }
}

async function loadTables(container, { keepActive = true } = {}) {
  const previous = keepActive ? activeTable : null;
  const data = await api.get(
    apiPath(`/api/connections/${conn.id}/tables`, { schema })
  );
  tables = data.items || [];
  if (!tables.some((item) => item.name === previous)) activeTable = tables[0]?.name || null;
  else activeTable = previous;
  renderTableList(container);
  if (activeTable) {
    await loadTable(container, activeTable, { keepTab: keepActive });
  } else {
    detail = null;
    rows = null;
    renderMain(container);
  }
}

function renderTableList(container) {
  const list = container.querySelector('#table-list');
  const count = container.querySelector('#table-count');
  if (!list) return;
  const keyword = tableFilter.toLowerCase();
  const filtered = tables.filter((table) => table.name.toLowerCase().includes(keyword));
  count.textContent = `${tables.length} 个${conn.kind === 'mongodb' ? '集合' : '表'}`;
  if (!filtered.length) {
    list.innerHTML = `<div class="list-empty">${tableFilter ? '没有匹配的表' : '这个 schema 还是空的'}</div>`;
    return;
  }
  list.innerHTML = filtered.map((table) => `
    <button class="table-item ${table.name === activeTable ? 'is-active' : ''}" data-table="${esc(table.name)}">
      <span class="table-ico">${icon(table.kind === 'view' ? 'eye' : 'table')}</span>
      <span class="table-copy">
        <strong>${esc(table.name)}</strong>
        <small>${table.kind === 'view' ? 'VIEW' : conn.kind === 'mongodb' ? 'COLLECTION' : 'TABLE'}${table.size ? ` · ${esc(table.size)}` : ''}</small>
      </span>
      <span class="table-count">${table.row_count === null ? '—' : formatNumber(table.row_count)}</span>
    </button>
  `).join('');
}

async function loadTable(container, name, { keepTab = false } = {}) {
  activeTable = name;
  if (!keepTab) tab = 'structure';
  page = 1;
  sort = null;
  order = 'asc';
  query = '';
  loading = true;
  detail = null;
  rows = null;
  renderTableList(container);
  renderMain(container);
  try {
    const path = apiPath(`/api/connections/${conn.id}/tables/${encodeURIComponent(name)}`, { schema });
    detail = await api.get(path);
    await loadRows(container);
  } catch (error) {
    loading = false;
    detail = null;
    rows = null;
    renderMain(container, error.message);
    toastError(error);
    return;
  }
  loading = false;
  renderMain(container);
}

async function loadRows(container) {
  const path = apiPath(`/api/connections/${conn.id}/tables/${encodeURIComponent(activeTable)}/rows`, {
    schema,
    page,
    page_size: pageSize,
    sort,
    order,
    q: query,
  });
  rows = await api.get(path);
}

function renderMain(container, error = null) {
  const main = container.querySelector('#table-main');
  if (!main) return;
  if (error) {
    main.innerHTML = errorState(error);
    return;
  }
  if (loading) {
    main.innerHTML = skeleton(9);
    return;
  }
  if (!activeTable || !detail) {
    main.innerHTML = emptyState({
      iconName: 'table',
      title: '选一张表开始',
      description: '左侧选择表或集合，这里会展示字段属性、索引和可分页的数据。',
    });
    return;
  }
  const isMongo = detail.kind === 'collection';
  main.innerHTML = `
    <header class="table-head">
      <div class="table-head-title">
        <span class="table-orb">${icon(isMongo ? 'braces' : 'table')}</span>
        <div>
          <div class="table-title-row">
            <h2>${esc(detail.name)}</h2>
            <span class="tag">${isMongo ? 'COLLECTION' : detail.kind === 'view' ? 'VIEW' : 'TABLE'}</span>
            ${conn.read_only ? `<span class="tag tag-lock">${icon('lock')}只读</span>` : ''}
          </div>
          <p class="muted">
            ${esc(detail.schema || schema || '')} ·
            ${formatNumber(detail.row_count)} 行 ·
            ${detail.columns.length} 字段
            ${detail.size ? ` · ${esc(detail.size)}` : ''}
            ${detail.comment ? ` · ${esc(detail.comment)}` : ''}
          </p>
        </div>
      </div>
      <div class="table-actions">
        <button class="btn btn-small btn-ghost" data-action="seed" ${conn.read_only ? 'disabled' : ''}>${icon('zap')}插入 5 条</button>
        <button class="btn btn-small btn-ghost" data-action="add-row" ${conn.read_only ? 'disabled' : ''}>${icon('plus')}新增行</button>
        <button class="btn btn-small btn-primary-ghost" data-action="gen-mock">${icon('layers')}生成 Mock</button>
        <button class="icon-btn" data-action="refresh-table" title="刷新">${icon('refresh')}</button>
        <button class="icon-btn danger" data-action="clear-table" title="清空表" ${conn.read_only ? 'disabled' : ''}>${icon('trash')}</button>
      </div>
    </header>

    <div class="tab-row">
      <button class="tab ${tab === 'structure' ? 'is-active' : ''}" data-tab="structure">结构 <span>${detail.columns.length}</span></button>
      <button class="tab ${tab === 'data' ? 'is-active' : ''}" data-tab="data">数据 <span>${formatNumber(detail.row_count)}</span></button>
      <button class="tab ${tab === 'indexes' ? 'is-active' : ''}" data-tab="indexes">索引 / 外键 <span>${detail.indexes.length}</span></button>
    </div>

    <div class="tab-content">
      ${tab === 'structure' ? structureView(detail) : tab === 'data' ? dataView(detail, rows, isMongo) : indexesView(detail)}
    </div>
  `;
}

function structureView(info) {
  return `
    <div class="table-scroll">
      <table class="data-table structure-table">
        <thead><tr>
          <th class="col-index">#</th>
          <th>字段</th>
          <th>类型</th>
          <th>主键</th>
          <th>可空</th>
          <th>默认值</th>
          <th>备注</th>
        </tr></thead>
        <tbody>
          ${info.columns.map((column, index) => `
            <tr>
              <td class="col-index">${index + 1}</td>
              <td><code class="col-name">${esc(column.name)}</code>${column.auto_increment ? '<span class="tag tag-mini">AUTO</span>' : ''}</td>
              <td><span class="type-badge">${esc(column.type)}</span></td>
              <td>${column.primary_key ? `<span class="key-badge">${icon('key')}PK</span>` : '<span class="muted">—</span>'}</td>
              <td>${column.nullable ? '<span class="soft-badge">YES</span>' : '<span class="soft-badge no">NO</span>'}</td>
              <td><code class="muted">${esc(column.default ?? '—')}</code></td>
              <td class="muted">${esc(column.comment || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ${info.foreign_keys?.length ? `
      <div class="relation-block">
        <h3>${icon('link')}外键关系</h3>
        ${info.foreign_keys.map((fk) => `
          <div class="relation-row">
            <code>${esc(fk.column)}</code>
            <span class="muted">→</span>
            <code>${esc(fk.references_table)}.${esc(fk.references_column)}</code>
            ${fk.constraint ? `<span class="tag tag-mini">${esc(fk.constraint)}</span>` : ''}
          </div>
        `).join('')}
      </div>` : ''}
  `;
}

function dataView(info, data, isMongo) {
  if (!data) return skeleton(6);
  const columns = data.columns?.length ? data.columns : info.columns;
  if (!data.rows?.length) {
    return emptyState({
      iconName: 'table',
      title: '这张表还没有数据',
      description: '可以用上方的「插入 5 条」快速造数，或点「新增行」手动写一条。',
      action: conn.read_only ? '' : `<button class="btn btn-primary" data-action="seed">${icon('zap')}快速插入 5 条</button>`,
    });
  }
  return `
    <div class="data-toolbar">
      <label class="search-field compact">
        ${icon('search')}
        <input id="row-search" placeholder="搜索文本字段…" value="${esc(query)}" />
      </label>
      <span class="muted tiny">点击表头排序 · 点击行查看详情</span>
      <span class="spacer"></span>
      <label class="select-wrap small">
        每页
        <select id="page-size" class="mini-select">
          ${[20, 50, 100].map((size) => `<option value="${size}" ${size === pageSize ? 'selected' : ''}>${size}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="table-scroll data-scroll">
      <table class="data-table">
        <thead><tr>
          <th class="col-index">#</th>
          ${columns.map((column) => `
            <th class="sortable ${sort === column.name ? 'is-sorted' : ''}" data-sort="${esc(column.name)}">
              <span>${esc(column.name)}</span>
              <em>${sort === column.name ? (order === 'asc' ? '↑' : '↓') : ''}</em>
            </th>
          `).join('')}
          <th class="col-actions"></th>
        </tr></thead>
        <tbody>
          ${data.rows.map((row, index) => `
            <tr data-row-index="${index}">
              <td class="col-index">${(page - 1) * pageSize + index + 1}</td>
              ${columns.map((column) => `<td title="${esc(cellTitle(row[column.name]))}">${cell(row[column.name])}</td>`).join('')}
              <td class="col-actions">
                <button class="icon-btn tiny" data-action="edit-row" data-index="${index}" title="编辑">${icon('edit')}</button>
                <button class="icon-btn tiny danger" data-action="delete-row" data-index="${index}" title="删除" ${conn.read_only ? 'disabled' : ''}>${icon('trash')}</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ${pagination(data, isMongo)}
  `;
}

function cellTitle(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 400);
  return String(value).slice(0, 400);
}

function cell(value) {
  if (value === null || value === undefined) return '<span class="null-cell">NULL</span>';
  if (typeof value === 'boolean') return `<span class="bool-cell ${value ? 'yes' : 'no'}">${value}</span>`;
  if (typeof value === 'object') {
    return `<code class="json-cell">${esc(JSON.stringify(value))}</code>`;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return `<span class="date-cell">${esc(value.replace('T', ' ').replace(/\.\d+/, '').replace('+00:00', ''))}</span>`;
  }
  const text = String(value);
  return text.length > 90 ? `<span>${esc(text.slice(0, 90))}…</span>` : esc(text);
}

function pagination(data, isMongo) {
  const totalPages = Math.max(1, Math.ceil((data.total || 0) / pageSize));
  return `
    <div class="pagination">
      <span class="muted">共 ${formatNumber(data.total)} ${isMongo ? '条文档' : '行'} · 第 ${page} / ${totalPages} 页</span>
      <span class="spacer"></span>
      <button class="btn btn-small btn-ghost" data-action="page" data-page="${Math.max(1, page - 1)}" ${page <= 1 ? 'disabled' : ''}>${icon('chevron-left')}上一页</button>
      <button class="btn btn-small btn-ghost" data-action="page" data-page="${Math.min(totalPages, page + 1)}" ${page >= totalPages ? 'disabled' : ''}>下一页${icon('chevron-right')}</button>
    </div>
  `;
}

function indexesView(info) {
  if (!info.indexes?.length && !info.foreign_keys?.length) {
    return emptyState({
      iconName: 'key',
      title: '没有额外的索引或外键',
      description: '主键索引通常由数据库自动创建。',
    });
  }
  return `
    <div class="index-grid">
      ${info.indexes.map((index) => `
        <div class="index-card">
          <div class="index-card-head">
            <span class="index-ico">${icon(index.primary ? 'key' : 'layers')}</span>
            <strong>${esc(index.name)}</strong>
            ${index.unique ? '<span class="tag tag-mini">UNIQUE</span>' : ''}
            ${index.primary ? '<span class="tag tag-mini tag-primary">PRIMARY</span>' : ''}
          </div>
          <div class="index-cols">${index.columns.map((column) => `<code>${esc(column)}</code>`).join('<span class="muted">,</span>')}</div>
        </div>
      `).join('')}
    </div>
    ${info.foreign_keys?.length ? `
      <div class="relation-block">
        <h3>${icon('link')}外键</h3>
        ${info.foreign_keys.map((fk) => `
          <div class="relation-row">
            <code>${esc(fk.column)}</code><span class="muted">→</span>
            <code>${esc(fk.references_table)}.${esc(fk.references_column)}</code>
          </div>
        `).join('')}
      </div>` : ''}
  `;
}

function errorState(message) {
  return `
    <div class="inline-error large">
      <strong>${icon('alert')}读取失败</strong>
      <p>${esc(message)}</p>
      <button class="btn btn-small btn-ghost" data-action="refresh">${icon('refresh')}重试</button>
    </div>
  `;
}

function currentRow(index) {
  const data = rows;
  if (!data || !data.rows) return null;
  return data.rows[index] || null;
}

function bind(container) {
  container.addEventListener('change', async (event) => {
    if (event.target.id === 'schema-select') {
      schema = event.target.value;
      activeTable = null;
      detail = null;
      rows = null;
      try {
        await loadTables(container, { keepActive: false });
      } catch (error) {
        toastError(error);
      }
    }
    if (event.target.id === 'page-size') {
      pageSize = Number(event.target.value);
      page = 1;
      await reloadRows(container);
    }
  });

  const onSearch = debounce(async () => {
    page = 1;
    await reloadRows(container);
  }, 350);
  container.addEventListener('input', (event) => {
    if (event.target.id === 'table-search') {
      tableFilter = event.target.value;
      renderTableList(container);
    }
    if (event.target.id === 'row-search') onSearch();
  });

  container.addEventListener('click', async (event) => {
    const tableButton = event.target.closest('[data-table]');
    if (tableButton) {
      if (tableButton.dataset.table === activeTable) return;
      await loadTable(container, tableButton.dataset.table);
      return;
    }
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) {
      tab = tabButton.dataset.tab;
      renderMain(container);
      return;
    }
    const sortHeader = event.target.closest('[data-sort]');
    if (sortHeader) {
      const name = sortHeader.dataset.sort;
      if (sort === name) order = order === 'asc' ? 'desc' : 'asc';
      else {
        sort = name;
        order = 'asc';
      }
      page = 1;
      await reloadRows(container);
      return;
    }
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) {
      const rowEl = event.target.closest('[data-row-index]');
      if (rowEl && !event.target.closest('button')) {
        openRowDetail(Number(rowEl.dataset.rowIndex), container);
      }
      return;
    }
    const action = actionEl.dataset.action;
    if (action === 'new-connection') {
      openConnectionModal();
    } else if (action === 'refresh') {
      try {
        await boot(container);
      } catch (error) {
        toastError(error);
      }
    } else if (action === 'refresh-tables') {
      try {
        await loadTables(container, { keepActive: true });
      } catch (error) {
        toastError(error);
      }
    } else if (action === 'refresh-table') {
      await loadTable(container, activeTable, { keepTab: true });
    } else if (action === 'seed') {
      await seedRows(container);
    } else if (action === 'add-row') {
      openRowModal({
        connectionId: conn.id,
        table: activeTable,
        schema,
        detail,
        onSaved: () => refreshAfterWrite(container),
      });
    } else if (action === 'edit-row') {
      const row = currentRow(Number(actionEl.dataset.index));
      if (row) {
        openRowModal({
          connectionId: conn.id,
          table: activeTable,
          schema,
          detail,
          row,
          onSaved: () => refreshAfterWrite(container),
        });
      }
    } else if (action === 'delete-row') {
      const row = currentRow(Number(actionEl.dataset.index));
      if (row) await deleteRow(container, row);
    } else if (action === 'gen-mock') {
      openProjectModal({
        table: activeTable,
        schema,
        connectionId: conn.id,
      });
    } else if (action === 'clear-table') {
      await clearTable(container);
    } else if (action === 'page') {
      page = Number(actionEl.dataset.page);
      await reloadRows(container);
    }
  });

  container.querySelector('#table-search')?.focus();
}

async function reloadRows(container) {
  if (!activeTable) return;
  try {
    await loadRows(container);
    renderMain(container);
  } catch (error) {
    toastError(error);
  }
}

async function refreshAfterWrite(container) {
  if (!activeTable) return;
  try {
    await loadTables(container, { keepActive: true });
  } catch (error) {
    toastError(error);
  }
}

async function seedRows(container) {
  if (!activeTable) return;
  try {
    const result = await api.post(
      apiPath(`/api/connections/${conn.id}/tables/${encodeURIComponent(activeTable)}/seed`, { schema }),
      { count: 5 }
    );
    if (result.errors?.length) {
      toast(`写入 ${result.inserted} 条，${result.errors.length} 条失败：${result.errors[0]}`, 'warn', { duration: 6000 });
    } else {
      toast(`已插入 ${result.inserted} 条数据`, 'success');
    }
    await refreshAfterWrite(container);
  } catch (error) {
    toastError(error);
  }
}

function openRowDetail(index, container) {
  const row = currentRow(index);
  if (!row) return;
  const pk = detail.primary_key || (conn.kind === 'mongodb' ? '_id' : 'id');
  const body = `
    <div class="preview-meta">
      <span class="pill">${esc(pk)} = ${esc(row[pk])}</span>
      <span class="muted">${esc(activeTable)}</span>
    </div>
    <pre class="code-block" style="max-height:52vh;overflow:auto"><code>${jsonHighlight(row)}</code></pre>
    <div class="log-detail-actions">
      <button class="btn btn-small btn-ghost" id="row-detail-copy">${icon('copy')}复制 JSON</button>
      ${conn.read_only ? '' : `<button class="btn btn-small btn-primary-ghost" id="row-detail-edit">${icon('edit')}编辑这行</button>`}
    </div>
  `;
  openDrawer({
    title: `${activeTable} / ${row[pk]}`,
    subtitle: '单行数据 · 原始 JSON',
    body,
    width: '540px',
    onMount: (panel, close) => {
      panel.querySelector('#row-detail-copy')?.addEventListener('click', () =>
        copyWithToast(JSON.stringify(row, null, 2), '这行数据已复制')
      );
      panel.querySelector('#row-detail-edit')?.addEventListener('click', () => {
        close();
        openRowModal({
          connectionId: conn.id,
          table: activeTable,
          schema,
          detail,
          row,
          onSaved: () => refreshAfterWrite(container),
        });
      });
    },
  });
}

async function deleteRow(container, row) {
  const pk = detail.primary_key || (conn.kind === 'mongodb' ? '_id' : 'id');
  const ok = await confirmDialog({
    title: '删除这条数据？',
    message: `将从 <b>${esc(activeTable)}</b> 删除主键为 <code>${esc(row[pk])}</code> 的记录。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.del(
      apiPath(
        `/api/connections/${conn.id}/tables/${encodeURIComponent(activeTable)}/rows/${encodeURIComponent(row[pk])}`,
        { schema }
      )
    );
    toast('数据已删除', 'success');
    await refreshAfterWrite(container);
  } catch (error) {
    toastError(error);
  }
}

async function clearTable(container) {
  const ok = await confirmDialog({
    title: '清空整张表？',
    message: `这会删除 <b>${esc(activeTable)}</b> 中的全部数据，但保留表结构。此操作不可撤销。`,
    confirmText: '清空表',
    danger: true,
    requireText: activeTable,
    requireLabel: `请输入表名 ${activeTable} 以确认`,
  });
  if (!ok) return;
  try {
    const result = await api.del(
      apiPath(`/api/connections/${conn.id}/tables/${encodeURIComponent(activeTable)}/rows`, { schema }),
      { confirm: 'CLEAR' }
    );
    toast(`已清空 ${result.deleted} 条数据`, 'success');
    await refreshAfterWrite(container);
  } catch (error) {
    toastError(error);
  }
}
