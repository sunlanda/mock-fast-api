import { api, apiPath } from '../api.js';
import { activeConnection } from '../store.js';
import { icon } from '../icons.js';
import {
  confirmDialog,
  debounce,
  emptyState,
  esc,
  formatDuration,
  formatNumber,
  jsonHighlight,
  openModal,
  setBusy,
  toast,
  toastError,
} from '../ui.js';
import { CodeEditor } from '../editor.js';
import { openConnectionModal } from '../components.js';

let conn = null;
let schemas = [];
let schema = null;
let tables = [];
let editor = null;
let mongoEditor = null;
let mode = 'sql';
let allowDdl = false;
let analysis = null;
let analysisSql = '';
let running = false;
let history = [];
let analyzeSeq = 0;
let mongoOp = 'find';
let mongoParams = {};
let mongoDoc = {};

const MONGO_OPS = [
  ['find', '查询文档'],
  ['aggregate', '聚合管道'],
  ['countDocuments', '统计数量'],
  ['distinct', '去重值'],
  ['insertOne', '插入一条'],
  ['insertMany', '插入多条'],
  ['updateOne', '更新一条'],
  ['updateMany', '更新多条'],
  ['deleteOne', '删除一条'],
  ['deleteMany', '删除多条'],
];

export function mount(container) {
  conn = activeConnection();
  if (!conn) {
    container.innerHTML = emptyState({
      iconName: 'terminal',
      title: '还没有可查询的数据源',
      description: '接入数据库后，这里会提供带安全拦截的 SQL 控制台和 MongoDB 文档查询。',
      action: `<button class="btn btn-primary" data-action="new-connection">${icon('plus')}接入数据源</button>`,
    });
    container.querySelector('[data-action="new-connection"]')?.addEventListener('click', () => openConnectionModal());
    return null;
  }
  mode = conn.kind === 'mongodb' ? 'mongo' : 'sql';
  schemas = [];
  schema = null;
  tables = [];
  analysis = null;
  analysisSql = '';
  allowDdl = false;
  running = false;
  history = readHistory();
  container.innerHTML = layout();
  bind(container);
  initEditors(container);
  boot(container);
  return null;
}

function layout() {
  const isMongo = mode === 'mongo';
  return `
    <div class="page-head">
      <div class="page-heading">
        <div class="eyebrow">${isMongo ? 'DOCUMENT CONSOLE' : 'GUARDED SQL CONSOLE'}</div>
        <h1>${isMongo ? 'Mongo 文档查询' : 'SQL 控制台'}</h1>
        <p>${isMongo
          ? '用 JSON 构造 find / aggregate / 增删改操作；删除与更新必须带 filter，高危操作会被拦截。'
          : '写 SQL、看结果。DELETE / UPDATE 必须带 WHERE，DDL 需要二次确认，DROP / TRUNCATE 永远拦截。'}</p>
      </div>
      <div class="page-actions">
        <span class="conn-pill">${icon('database')}<span>${esc(conn.name)}</span><em>${esc(kindName(conn.kind))}</em></span>
        ${conn.read_only ? `<span class="tag tag-lock">${icon('lock')}只读连接</span>` : ''}
        <label class="select-wrap" title="${isMongo ? '数据库' : 'schema'}">
          ${icon('layers')}
          <select id="sql-schema" class="mini-select" disabled><option>加载中…</option></select>
        </label>
        <a class="icon-btn" href="/api/docs" target="_blank" rel="noreferrer" title="API 文档">${icon('book')}</a>
      </div>
    </div>

    <div class="sql-workspace">
      <section class="panel query-panel">
        <header class="query-head">
          <div class="query-head-left">
            <span class="query-orb">${icon(isMongo ? 'braces' : 'terminal')}</span>
            <div>
              <strong>${isMongo ? 'Document operation' : 'Query editor'}</strong>
              <small>${isMongo ? 'JSON 参数 · 服务端会二次校验' : '支持多语句 · 单次最多返回 200 行'}</small>
            </div>
          </div>
          <div class="query-head-right">
            ${isMongo ? `
              <label class="inline-field">操作
                <select id="mongo-op" class="mini-select">
                  ${MONGO_OPS.map(([value, label]) => `<option value="${value}" ${value === mongoOp ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
              </label>
              <label class="inline-field">集合
                <input id="mongo-collection" class="input compact mono" list="collection-list" placeholder="collection" />
                <datalist id="collection-list"></datalist>
              </label>
              <label class="inline-field">Limit
                <input id="mongo-limit" class="input compact" type="number" min="1" max="500" value="50" />
              </label>
            ` : `
              <span class="safety-pill is-loading" id="safety-pill"><span class="dot"></span><span>安全检查</span></span>
              <label class="inline-check ddl-switch" title="结构变更需要二次确认">
                <input type="checkbox" id="ddl-toggle" ${allowDdl ? 'checked' : ''} ${conn.read_only ? 'disabled' : ''} />
                <span class="switch-track mini"><span></span></span>
                允许 DDL
              </label>
            `}
            <button class="icon-btn" data-action="clear" title="清空">${icon('x')}</button>
            <button class="btn btn-small btn-ghost" data-action="history">${icon('clock')}历史</button>
            ${isMongo ? '' : `<button class="btn btn-small btn-ghost" data-action="samples">${icon('spark')}示例</button>`}
            <button class="btn btn-primary btn-small" id="run-query" type="button">${icon('play')}执行</button>
          </div>
        </header>

        ${isMongo ? '' : `
          <div class="safety-banner" id="safety-banner" hidden></div>
          <div class="safety-warning" id="safety-warning" ${allowDdl ? '' : 'hidden'}>
            ${icon('alert')} DDL 已解锁。执行结构变更时仍会要求输入 <code>DDL</code> 二次确认。
          </div>
        `}

        <div class="query-editor-wrap">
          <div id="query-editor"></div>
          <div class="editor-foot">
            <span>${icon('terminal')} <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Enter</kbd> 执行</span>
            <span>${isMongo ? 'JSON 参数' : '最多返回 200 行'} · 结果会写入调用日志</span>
            ${conn.read_only ? `<span class="read-only-note">${icon('lock')}只读：仅允许查询</span>` : ''}
          </div>
        </div>
      </section>

      <section class="panel result-panel">
        <header class="result-head">
          <div>
            <strong>执行结果</strong>
            <small id="result-caption">${isMongo ? '等待查询' : 'Waiting for query'}</small>
          </div>
          <span class="spacer"></span>
          <button class="icon-btn" data-action="clear-result" title="清空结果">${icon('x')}</button>
        </header>
        <div class="result-body" id="result-body">
          ${emptyResult(isMongo)}
        </div>
      </section>
    </div>
  `;
}

function emptyResult(isMongo) {
  return emptyState({
    iconName: isMongo ? 'braces' : 'play',
    title: isMongo ? '构造一次文档查询' : '执行一条 SQL',
    description: isMongo
      ? '选择操作、集合，填写 JSON 参数后点执行。find / aggregate 的结果会以表格展示。'
      : 'SELECT 会以表格返回；UPDATE / DELETE 会显示影响行数。高危语句在到达数据库前就会被拦下。',
    action: isMongo
      ? ''
      : `<div class="shortcut-row"><kbd>Ctrl</kbd><span>+</span><kbd>Enter</kbd><span>快速执行</span></div>`,
  });
}

function kindName(kind) {
  return { sqlite: 'SQLite', postgres: 'PostgreSQL', mysql: 'MySQL', mongodb: 'MongoDB' }[kind] || kind;
}

function initEditors(container) {
  if (mode === 'mongo') {
    mongoParams = defaultMongoParams(mongoOp);
    mongoDoc = { database: '', collection: '', limit: 20, ...mongoParams };
    mongoEditor = new CodeEditor(container.querySelector('#query-editor'), {
      language: 'json',
      value: JSON.stringify(mongoParams, null, 2),
      minHeight: 330,
      onRun: () => runQuery(container),
    });
  } else {
    editor = new CodeEditor(container.querySelector('#query-editor'), {
      language: 'sql',
      value: suggestQuery(),
      minHeight: 360,
      placeholder: 'SELECT * FROM users LIMIT 20;',
      onRun: () => runQuery(container),
      onChange: () => scheduleAnalyze(container),
    });
  }
}

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem('mf.sql.history') || '[]').slice(0, 12);
  } catch {
    return [];
  }
}

function writeHistory() {
  try {
    localStorage.setItem('mf.sql.history', JSON.stringify(history.slice(0, 12)));
  } catch {
    // ignore quota errors
  }
}

async function boot(container) {
  try {
    const data = await api.get(`/api/connections/${conn.id}/schemas`);
    schemas = data.schemas || [];
    schema = data.default || schemas[0] || null;
    const select = container.querySelector('#sql-schema');
    select.disabled = false;
    select.innerHTML = schemas.length
      ? schemas.map((item) => `<option value="${esc(item)}" ${item === schema ? 'selected' : ''}>${esc(item)}</option>`).join('')
      : `<option value="">默认</option>`;
    await loadTables(container);
    if (mode === 'sql' && editor && editor.getValue().trim() === 'SELECT 1;' && tables[0]) {
      editor.setValue(suggestQuery(tables[0].name));
    }
    if (mode === 'mongo' && mongoEditor) {
      mongoDoc.collection = tables[0]?.name || '';
      const input = container.querySelector('#mongo-collection');
      if (input) input.value = mongoDoc.collection;
      mongoDoc.database = schema || '';
    }
    if (mode === 'sql') scheduleAnalyze(container);
  } catch (error) {
    toastError(error);
  }
}

async function loadTables(container) {
  const data = await api.get(apiPath(`/api/connections/${conn.id}/tables`, { schema }));
  tables = data.items || [];
  const datalist = container.querySelector('#collection-list');
  if (datalist) {
    datalist.innerHTML = tables.map((table) => `<option value="${esc(table.name)}"></option>`).join('');
  }
}

function suggestQuery(tableName = null) {
  if (!tableName) return 'SELECT 1;';
  return `SELECT * FROM ${quoteIdent(tableName, conn.kind)} LIMIT 20;`;
}

function quoteIdent(name, kind) {
  if (kind === 'mysql') return `\`${String(name).replace(/`/g, '``')}\``;
  return `"${String(name).replace(/"/g, '""')}"`;
}

function scheduleAnalyze(container) {
  if (mode !== 'sql' || !editor) return;
  debouncedAnalyze(container);
}

const debouncedAnalyze = debounce((container) => {
  runAnalyze(container);
}, 550);

async function runAnalyze(container) {
  if (mode !== 'sql' || !editor) return;
  const sql = editor.getValue();
  if (!sql.trim()) {
    analysis = null;
    setSafety(container, 'neutral', '等待输入', []);
    return;
  }
  const seq = ++analyzeSeq;
  setSafety(container, 'loading', '检查中…', []);
  try {
    const result = await api.post('/api/sql/analyze', {
      sql,
      connection_id: conn.id,
      allow_ddl: allowDdl,
    });
    if (seq !== analyzeSeq) return;
    analysis = result;
    analysisSql = sql;
    if (!result.allowed) {
      setSafety(container, 'blocked', '会被拦截', result.reasons);
    } else if (result.requires_ddl) {
      setSafety(container, 'warn', 'DDL 需确认', []);
    } else if (result.classification === 'write') {
      setSafety(container, 'warn', '写操作', []);
    } else {
      setSafety(container, 'safe', '检查通过', []);
    }
  } catch (error) {
    if (seq !== analyzeSeq) return;
    analysis = null;
    analysisSql = '';
    setSafety(container, 'neutral', '无法预检', [error.message]);
  }
}

function setSafety(container, tone, label, reasons) {
  const pill = container.querySelector('#safety-pill');
  const banner = container.querySelector('#safety-banner');
  if (pill) {
    pill.className = `safety-pill is-${tone}`;
    pill.innerHTML = `<span class="dot"></span><span>${esc(label)}</span>`;
  }
  if (banner) {
    if (reasons?.length) {
      banner.hidden = false;
      banner.className = `safety-banner is-${tone === 'blocked' ? 'danger' : 'warn'}`;
      banner.innerHTML = `
        <span class="banner-ico">${icon(tone === 'blocked' ? 'shield' : 'alert')}</span>
        <div>
          <strong>${tone === 'blocked' ? '这条语句会被安全策略拦截' : '执行前请注意'}</strong>
          <ul>${reasons.map((reason) => `<li>${esc(reason)}</li>`).join('')}</ul>
        </div>`;
    } else {
      banner.hidden = true;
      banner.innerHTML = '';
    }
  }
}

function updateDdlBanner(container) {
  const warning = container.querySelector('#safety-warning');
  if (warning) warning.hidden = !allowDdl;
}

function bind(container) {
  container.addEventListener('click', async (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === 'new-connection') {
        openConnectionModal();
      } else if (action === 'clear') {
        if (mode === 'mongo') {
          mongoParams = defaultMongoParams(mongoOp);
          mongoEditor?.setValue(JSON.stringify(mongoParams, null, 2));
        } else {
          editor?.setValue('');
          analysis = null;
          setSafety(container, 'neutral', '等待输入', []);
        }
      } else if (action === 'history') {
        openHistory(container);
      } else if (action === 'samples') {
        openSamples(container);
      } else if (action === 'clear-result') {
        container.querySelector('#result-body').innerHTML = emptyResult(mode === 'mongo');
        container.querySelector('#result-caption').textContent = mode === 'mongo' ? '等待查询' : 'Waiting for query';
      }
      return;
    }
    if (event.target.closest('#run-query')) {
      await runQuery(container);
      return;
    }
    const sample = event.target.closest('[data-sample-sql]');
    if (sample) {
      editor?.setValue(sample.dataset.sampleSql);
      closeSamples();
    }
    const historyItem = event.target.closest('[data-history]');
    if (historyItem) {
      editor?.setValue(historyItem.dataset.history);
      closeHistory();
    }
  });

  container.addEventListener('change', async (event) => {
    if (event.target.id === 'sql-schema') {
      schema = event.target.value;
      try {
        await loadTables(container);
        if (mode === 'mongo') {
          mongoDoc.database = schema || '';
          if (tables[0] && !mongoDoc.collection) {
            mongoDoc.collection = tables[0].name;
            const input = container.querySelector('#mongo-collection');
            if (input) input.value = mongoDoc.collection;
          }
        }
      } catch (error) {
        toastError(error);
      }
    }
    if (event.target.id === 'ddl-toggle') {
      allowDdl = event.target.checked;
      updateDdlBanner(container);
      await runAnalyze(container);
    }
    if (event.target.id === 'mongo-op') {
      mongoOp = event.target.value;
      mongoParams = defaultMongoParams(mongoOp);
      mongoEditor?.setValue(JSON.stringify(mongoParams, null, 2));
    }
  });

}

async function runQuery(container) {
  if (running) return;
  if (mode === 'mongo') {
    await runMongo(container);
    return;
  }
  if (!editor) return;
  const sql = editor.getValue().trim();
  if (!sql) {
    toast('先写一条 SQL 再执行', 'warn');
    editor.focus();
    return;
  }
  if (!analysis || analysisSql !== sql) await runAnalyze(container);
  const onlyDdlGate = Boolean(
    analysis &&
    !analysis.allowed &&
    !allowDdl &&
    analysis.requires_ddl &&
    analysis.reasons?.length &&
    analysis.reasons.every((reason) => reason.includes('结构变更（DDL）默认关闭'))
  );
  if (analysis && !analysis.allowed && !onlyDdlGate) {
    renderBlocked(container, analysis.reasons, analysis.classification);
    return;
  }
  if (onlyDdlGate) {
    const ok = await confirmDialog({
      title: '解锁结构变更？',
      message: `当前「允许 DDL」是关闭的。这条 SQL 会修改 <b>${esc(schema || '当前数据库')}</b> 的表结构，执行前请确认这不是生产库。`,
      confirmText: '解锁并继续',
      danger: true,
      requireText: 'DDL',
      requireLabel: '请输入 DDL 以确认',
    });
    if (!ok) return;
    allowDdl = true;
    const toggle = container.querySelector('#ddl-toggle');
    if (toggle) toggle.checked = true;
    updateDdlBanner(container);
  } else if (analysis?.requires_ddl) {
    const ok = await confirmDialog({
      title: '执行结构变更？',
      message: `这条 SQL 会修改 <b>${esc(schema || '当前数据库')}</b> 的结构。请再次确认语句影响范围，执行后可能无法回滚。`,
      confirmText: '继续执行 DDL',
      danger: true,
      requireText: 'DDL',
      requireLabel: '请输入 DDL 以确认',
    });
    if (!ok) return;
  }
  running = true;
  const button = container.querySelector('#run-query');
  setBusy(button, true, '执行中…');
  const body = container.querySelector('#result-body');
  body.innerHTML = `<div class="result-loading"><span class="spinner"></span><span>正在执行，请稍候…</span></div>`;
  try {
    const data = await api.post(`/api/connections/${conn.id}/query`, {
      sql,
      allow_ddl: allowDdl,
      ddl_token: allowDdl ? 'ALLOW_DDL' : null,
      max_rows: 200,
    });
    pushHistory(sql);
    renderResult(container, data.result, data.results?.length || 1);
  } catch (error) {
    renderError(container, error);
    toastError(error);
  } finally {
    running = false;
    setBusy(button, false);
  }
}

async function runMongo(container) {
  if (!mongoEditor) return;
  let params;
  try {
    params = JSON.parse(mongoEditor.getValue() || '{}');
  } catch {
    toast('JSON 参数格式不正确，请检查括号和逗号', 'error');
    return;
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    toast('JSON 参数必须是一个对象', 'error');
    return;
  }
  const collectionInput = container.querySelector('#mongo-collection');
  const collection = collectionInput?.value.trim();
  if (!collection) {
    toast('请选择一个集合', 'warn');
    collectionInput?.focus();
    return;
  }
  const limitInput = container.querySelector('#mongo-limit');
  const limit = Math.max(1, Math.min(Number(limitInput?.value || 50), 500));
  const payload = {
    ...params,
    operation: mongoOp,
    collection,
    database: schema || undefined,
    limit,
  };
  running = true;
  const button = container.querySelector('#run-query');
  setBusy(button, true, '执行中…');
  const body = container.querySelector('#result-body');
  body.innerHTML = `<div class="result-loading"><span class="spinner"></span><span>正在执行 ${esc(mongoOp)}…</span></div>`;
  try {
    const data = await api.post(
      apiPath(`/api/connections/${conn.id}/mongo/query`, { schema }),
      payload
    );
    renderResult(container, data, 1, 'mongo');
  } catch (error) {
    renderError(container, error);
    toastError(error);
  } finally {
    running = false;
    setBusy(button, false);
  }
}

function pushHistory(sql) {
  history = [sql, ...history.filter((item) => item !== sql)].slice(0, 12);
  writeHistory();
}

function renderResult(container, result, statementCount = 1, kind = 'sql') {
  const body = container.querySelector('#result-body');
  const caption = container.querySelector('#result-caption');
  if (!result) {
    body.innerHTML = emptyResult(kind === 'mongo');
    return;
  }
  const isWrite = result.kind === 'write';
  const duration = result.duration_ms ?? 0;
  if (caption) {
    caption.textContent = `${formatDuration(duration)} · ${isWrite ? `影响 ${result.affected} 行` : `${result.row_count || 0} 行结果`}`;
  }
  if (isWrite) {
    body.innerHTML = `
      <div class="write-success">
        <span class="write-orb">${icon('check')}</span>
        <div>
          <h3>执行成功</h3>
          <p>语句已提交，影响 <strong>${formatNumber(result.affected)}</strong> 行。</p>
        </div>
        <span class="pill">${formatDuration(duration)}</span>
      </div>
      ${statementCount > 1 ? `<div class="inline-tip">本次共执行 ${statementCount} 条语句，这里展示最后一条的结果。</div>` : ''}
    `;
    return;
  }
  const columns = result.columns || [];
  const rows = result.rows || [];
  body.innerHTML = `
    <div class="result-meta">
      <span class="status-pill is-ok">OK</span>
      <span class="pill">${formatDuration(duration)}</span>
      <span class="muted">${formatNumber(result.row_count || rows.length)} 行</span>
      ${result.total !== undefined ? `<span class="muted">总计 ${formatNumber(result.total)}</span>` : ''}
      ${result.truncated ? `<span class="tag tag-warn">已截断</span>` : ''}
      <span class="spacer"></span>
      <button class="btn btn-small btn-ghost" data-result-json>${icon('copy')}复制 JSON</button>
    </div>
    ${statementCount > 1 ? `<div class="inline-tip">本次共执行 ${statementCount} 条语句，这里展示最后一条的结果。</div>` : ''}
    ${rows.length === 0 ? emptyState({
      iconName: 'box',
      title: '查询成功，没有返回数据',
      description: '结果集为空，但语句已正常执行。',
    }) : `
      <div class="table-scroll result-scroll">
        <table class="data-table result-table">
          <thead><tr>
            <th class="col-index">#</th>
            ${columns.map((column) => `<th><span>${esc(column.name)}</span><em class="type-inline">${esc(column.type || '')}</em></th>`).join('')}
          </tr></thead>
          <tbody>
            ${rows.map((row, index) => `
              <tr>
                <td class="col-index">${index + 1}</td>
                ${columns.map((column) => `<td title="${esc(cellTitle(row[column.name]))}">${renderCell(row[column.name])}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
    ${result.truncated ? `<div class="inline-warning">结果超过 200 行，仅展示前 200 行。请添加 LIMIT 或 WHERE 缩小范围。</div>` : ''}
  `;
  body.querySelector('[data-result-json]')?.addEventListener('click', () => {
    const text = JSON.stringify(rows, null, 2);
    navigator.clipboard?.writeText(text).then(
      () => toast('结果 JSON 已复制', 'success'),
      () => toast('复制失败，请手动选择', 'error')
    );
  });
}

function cellTitle(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 400);
  return String(value).slice(0, 400);
}

function renderCell(value) {
  if (value === null || value === undefined) return '<span class="null-cell">NULL</span>';
  if (typeof value === 'boolean') return `<span class="bool-cell ${value ? 'yes' : 'no'}">${value}</span>`;
  if (typeof value === 'object') return `<code class="json-cell">${esc(JSON.stringify(value))}</code>`;
  const text = String(value);
  return text.length > 100 ? `<span title="${esc(text)}">${esc(text.slice(0, 100))}…</span>` : esc(text);
}

function renderBlocked(container, reasons, classification) {
  const body = container.querySelector('#result-body');
  body.innerHTML = `
    <div class="result-error">
      <span class="error-orb">${icon('shield')}</span>
      <div>
        <h3>SQL 已被安全策略拦截</h3>
        <p>没有语句到达数据库${classification ? ` · 分类：${esc(classification)}` : ''}。请调整写法后重试。</p>
        <ul>${(reasons || ['未知原因']).map((reason) => `<li>${esc(reason)}</li>`).join('')}</ul>
      </div>
    </div>
  `;
  container.querySelector('#result-caption').textContent = 'Blocked by safety guard';
}

function renderError(container, error) {
  const body = container.querySelector('#result-body');
  const isBlocked = error.kind === 'blocked' || error.kind === 'read_only';
  body.innerHTML = `
    <div class="result-error">
      <span class="error-orb">${icon(isBlocked ? 'shield' : 'alert')}</span>
      <div>
        <h3>${isBlocked ? '操作被拦截' : '执行失败'}</h3>
        <p>${esc(error.message)}</p>
        ${error.reasons?.length ? `<ul>${error.reasons.map((reason) => `<li>${esc(reason)}</li>`).join('')}</ul>` : ''}
        ${error.kind === 'read_only' ? '<div class="inline-tip">当前连接开启了只读模式，可以到数据源设置里关闭只读。</div>' : ''}
      </div>
    </div>
  `;
  container.querySelector('#result-caption').textContent = isBlocked ? 'Blocked' : 'Error';
}

function defaultMongoParams(operation) {
  if (operation === 'aggregate') return { pipeline: [] };
  if (operation === 'countDocuments') return { filter: {} };
  if (operation === 'distinct') return { field: '_id', filter: {} };
  if (operation === 'insertOne') return { document: { name: '新的示例数据', created_at: new Date().toISOString() } };
  if (operation === 'insertMany') return { documents: [{ name: '示例 A' }, { name: '示例 B' }] };
  if (operation === 'updateOne' || operation === 'updateMany') return { filter: {}, update: { $set: {} } };
  if (operation === 'deleteOne' || operation === 'deleteMany') return { filter: {} };
  return { filter: {}, projection: {}, sort: { _id: -1 }, limit: 20, skip: 0 };
}

let sampleModalClose = null;
let historyModalClose = null;

function closeSamples() {
  sampleModalClose?.();
  sampleModalClose = null;
}

function closeHistory() {
  historyModalClose?.();
  historyModalClose = null;
}

function openSamples(container) {
  const items = tables.length
    ? tables.flatMap((table) => [
        { label: `${table.name} · 前 20 行`, sql: `SELECT * FROM ${quoteIdent(table.name, conn.kind)} LIMIT 20;` },
        { label: `${table.name} · 总数`, sql: `SELECT COUNT(*) AS total FROM ${quoteIdent(table.name, conn.kind)};` },
      ])
    : [{ label: '通用查询', sql: 'SELECT 1;' }];
  const body = `
    <div class="sample-list">
      ${items.map((item) => `
        <button class="sample-item" data-sample-sql="${esc(item.sql)}">
          <span class="sample-label">${esc(item.label)}</span>
          <code>${esc(item.sql)}</code>
        </button>
      `).join('')}
    </div>
  `;
  const modal = openModal({
    title: '示例查询',
    subtitle: '基于当前 schema 的表生成，点选即可填入编辑器。',
    iconName: 'spark',
    body,
    size: 'md',
    onMount: (panel, close) => {
      panel.querySelectorAll('[data-sample-sql]').forEach((button) => {
        button.addEventListener('click', () => {
          editor?.setValue(button.dataset.sampleSql, { focus: true });
          close();
          runAnalyze(container);
        });
      });
    },
  });
  sampleModalClose = modal.close;
}

function openHistory(container) {
  const items = history.length ? history : [];
  const body = items.length
    ? `<div class="history-list">${items.map((sql, index) => `
        <button class="history-item" data-history="${esc(sql)}">
          <span class="history-index">${String(index + 1).padStart(2, '0')}</span>
          <code>${esc(sql)}</code>
        </button>`).join('')}</div>`
    : emptyState({ iconName: 'clock', title: '还没有执行历史', description: '成功执行过的 SQL 会自动保存在本地。' });
  if (!items.length) {
    const modal = openModal({
      title: '最近执行',
      subtitle: '保存在本机浏览器，最多保留 12 条。',
      iconName: 'clock',
      body,
      size: 'md',
    });
    historyModalClose = modal.close;
    return;
  }
  const modal = openModal({
    title: '最近执行',
    subtitle: '保存在本机浏览器，最多保留 12 条。',
    iconName: 'clock',
    body,
    size: 'md',
    onMount: (panel, close) => {
      panel.querySelectorAll('[data-history]').forEach((button) => {
        button.addEventListener('click', () => {
          editor?.setValue(button.dataset.history, { focus: true });
          close();
          runAnalyze(container);
        });
      });
    },
  });
  historyModalClose = modal.close;
}
