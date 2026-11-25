import { api, apiPath } from './api.js';
import {
  activeConnection,
  connectionKindLabel,
  formatMeta,
  refreshConnections,
  refreshProjects,
  setActiveConnection,
  state,
} from './store.js';
import { icon } from './icons.js';
import {
  closeModal,
  confirmDialog,
  copyWithToast,
  esc,
  formatDuration,
  formatNumber,
  jsonHighlight,
  openModal,
  setBusy,
  toast,
  toastError,
} from './ui.js';
import { CodeEditor } from './editor.js';

const KINDS = [
  { id: 'sqlite', label: 'SQLite', desc: '零配置，文件即数据库', port: null, tone: 'mint' },
  { id: 'postgres', label: 'PostgreSQL', desc: '本地或远程 PG', port: 5432, tone: 'blue' },
  { id: 'mysql', label: 'MySQL', desc: 'MySQL / MariaDB', port: 3306, tone: 'amber' },
  { id: 'mongodb', label: 'MongoDB', desc: '文档型数据库', port: 27017, tone: 'violet' },
];

export function absoluteUrl(path) {
  return `${window.location.origin}${path}`;
}

function kindLabel(kind) {
  return connectionKindLabel(kind);
}

function isRemoteHost(host) {
  const value = String(host || '').trim().toLowerCase();
  return Boolean(value) && !['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(value);
}

function connSummary(conn) {
  if (!conn) return '';
  return conn.target || conn.name;
}

function formatOptions(selected) {
  return state.formats.map((format) => `
    <label class="format-option ${format.id === selected ? 'is-selected' : ''}">
      <input type="radio" name="proj-format" value="${esc(format.id)}" ${format.id === selected ? 'checked' : ''} />
      <span class="format-radio"></span>
      <span class="format-copy">
        <strong>${esc(format.label)}</strong>
        <small>${esc(format.name)}</small>
        <em>${esc(format.description)}</em>
      </span>
    </label>
  `).join('');
}

/* ------------------------------------------------------------------------- */
/* Connection modal                                                          */
/* ------------------------------------------------------------------------- */

export function openConnectionModal(connection = null) {
  const editing = Boolean(connection);
  let currentKind = connection?.kind || 'sqlite';
  let draft = { ...(connection?.config || {}) };
  if (!editing) {
    draft = { path: 'data/demo.db', host: '127.0.0.1', port: 5432, database: 'postgres', user: 'postgres' };
  }
  let isReadOnly = connection ? Boolean(connection.read_only) : false;
  let readOnlyTouched = Boolean(editing);
  let mongoMode = connection?.has_uri ? 'uri' : 'host';

  const body = document.createElement('div');
  body.innerHTML = `
    <form class="conn-form" id="conn-form" autocomplete="off">
      <div class="form-grid">
        <label class="field span-2">
          <span>连接名称</span>
          <input class="input" data-meta="name" id="conn-name" placeholder="例如：本地开发库 / 测试环境只读库"
            value="${esc(connection?.name || '本地开发库')}" autofocus />
        </label>
      </div>

      <div class="field">
        <span>数据库类型</span>
        <div class="kind-grid" id="kind-grid">
          ${KINDS.map((kind) => `
            <button type="button" class="kind-card ${kind.id === currentKind ? 'is-active' : ''}" data-kind="${kind.id}">
              <span class="kind-ico tone-${kind.tone}">${icon('database')}</span>
              <span class="kind-copy"><strong>${kind.label}</strong><small>${kind.desc}</small></span>
              <span class="kind-check">${icon('check')}</span>
            </button>`).join('')}
        </div>
      </div>

      <div id="conn-fields"></div>

      <div class="remote-banner" id="remote-banner" hidden></div>

      <div class="form-grid">
        <label class="switch-row span-2">
          <input type="checkbox" id="conn-readonly" ${isReadOnly ? 'checked' : ''} />
          <span class="switch-track"><span></span></span>
          <span class="switch-copy">
            <strong>只读连接</strong>
            <small>允许查询、生成读取接口；禁止 SQL 写入、种子数据与 Mock 变更接口。</small>
          </span>
        </label>
      </div>

      <div class="test-result" id="conn-test-result" hidden></div>
    </form>
  `;

  const footer = document.createElement('div');
  footer.className = 'modal-actions';
  footer.innerHTML = `
    ${editing ? `<button class="btn btn-danger-ghost" type="button" id="conn-delete">${icon('trash')}删除连接</button>` : ''}
    <span class="spacer"></span>
    <button class="btn btn-ghost" type="button" id="conn-cancel">取消</button>
    <button class="btn btn-ghost" type="button" id="conn-test">${icon('zap')}测试连接</button>
    <button class="btn btn-primary" type="button" id="conn-save">${editing ? '保存修改' : '保存并使用'}${icon('arrow-right')}</button>
  `;

  const modal = openModal({
    title: editing ? '编辑数据源' : '接入一个数据源',
    subtitle: editing ? '修改连接配置；留空的密码会继续使用已保存的值。' : '默认只允许本机地址，远程数据库需要显式开启访问策略。',
    eyebrow: 'DATA SOURCE',
    iconName: 'database',
    body,
    footer,
    size: 'lg',
    onMount: (panel) => {
      const fields = panel.querySelector('#conn-fields');
      const banner = panel.querySelector('#remote-banner');
      const testBox = panel.querySelector('#conn-test-result');
      const readOnlyInput = panel.querySelector('#conn-readonly');
      const nameInput = panel.querySelector('#conn-name');

      const defaultPort = (kind) => KINDS.find((item) => item.id === kind)?.port || 0;

      function capture() {
        fields.querySelectorAll('[data-key]').forEach((input) => {
          const key = input.dataset.key;
          if (input.type === 'checkbox') draft[key] = input.checked;
          else if (input.type === 'number') draft[key] = input.value === '' ? null : Number(input.value);
          else draft[key] = input.value;
        });
        draft.read_only = readOnlyInput.checked;
      }

      function updateBanner() {
        const remote = currentKind === 'mongodb' && mongoMode === 'uri'
          ? !/localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal/i.test(draft.uri || '')
          : isRemoteHost(draft.host);
        banner.hidden = !remote;
        if (!remote) return;
        banner.className = `remote-banner ${state.settings?.allow_remote_db ? 'is-warning' : 'is-danger'}`;
        banner.innerHTML = state.settings?.allow_remote_db
          ? `<span class="banner-ico">${icon('alert')}</span><div><strong>这是一个远程数据库</strong><p>MockFast 会直接读写它。建议开启只读连接，并确认不是生产库。</p></div>`
          : `<span class="banner-ico">${icon('lock')}</span><div><strong>远程访问当前已关闭</strong><p>默认策略只允许 localhost。请先到「设置 → 数据源安全策略」开启远程访问。</p><button class="text-link" type="button" id="go-settings">去设置开启 →</button></div>`;
        banner.querySelector('#go-settings')?.addEventListener('click', () => {
          closeModal();
          window.dispatchEvent(new CustomEvent('mf:navigate', { detail: 'settings' }));
        });
        if (!isReadOnly && !readOnlyTouched) {
          isReadOnly = true;
          readOnlyInput.checked = true;
        }
      }

      function field(key, label, value, options = {}) {
        const { type = 'text', placeholder = '', hint = '', attr = '' } = options;
        return `
          <label class="field ${options.span ? `span-${options.span}` : ''}">
            <span>${label}</span>
            <input class="input" type="${type}" data-key="${key}" value="${esc(value ?? '')}"
              placeholder="${esc(placeholder)}" ${attr} />
            ${hint ? `<small class="field-hint">${hint}</small>` : ''}
          </label>
        `;
      }

      function fieldsFor(kind) {
        if (kind === 'sqlite') {
          return `
            <div class="form-grid">
              ${field('path', '数据库文件路径', draft.path || 'data/demo.db', {
                span: 2,
                hint: `文件必须位于项目 data/ 目录内 · 例：data/demo.db`,
              })}
            </div>
            <div class="inline-tip">
              <span>${icon('spark')}</span>
              没有数据库？使用 <button type="button" class="text-link" id="use-demo-path">内置演示库</button>，点保存即可开始。
            </div>
          `;
        }
        if (kind === 'mongodb') {
          return `
            <div class="segmented small" id="mongo-mode">
              <button type="button" data-mode="host" class="${mongoMode === 'host' ? 'active' : ''}">主机 / 端口</button>
              <button type="button" data-mode="uri" class="${mongoMode === 'uri' ? 'active' : ''}">连接 URI</button>
            </div>
            <div class="form-grid" id="mongo-host-fields" ${mongoMode === 'uri' ? 'hidden' : ''}>
              ${field('host', 'Host', draft.host || '127.0.0.1')}
              ${field('port', 'Port', draft.port || 27017, { type: 'number' })}
              ${field('database', '数据库', draft.database || 'mockfast')}
              ${field('user', '用户名', draft.user || '', { placeholder: '可选' })}
              <label class="field">
                <span>密码</span>
                <input class="input" type="password" data-key="password"
                  placeholder="${connection?.has_password ? '已保存，留空不修改' : '可选'}" />
              </label>
              ${field('auth_source', 'authSource', draft.auth_source || 'admin')}
            </div>
            <div id="mongo-uri-fields" ${mongoMode === 'uri' ? '' : 'hidden'}>
              <label class="field">
                <span>MongoDB URI</span>
                <textarea class="input textarea mono" data-key="uri" rows="3"
                  placeholder="mongodb://user:pass@127.0.0.1:27017/mockfast">${esc(draft.uri || '')}</textarea>
                ${connection?.has_uri ? '<small class="field-hint">已保存过 URI，留空将保持原 URI 不变。</small>' : ''}
              </label>
            </div>
            <div class="form-grid">
              ${field('database_uri', 'URI 模式下的数据库名', draft.database || 'mockfast', {
                span: 2,
                hint: '使用 URI 时，MockFast 会用这个库名浏览集合。',
              })}
            </div>
          `;
        }
        return `
          <div class="form-grid">
            ${field('host', 'Host', draft.host || '127.0.0.1', { hint: '默认仅本机可连，远程需开启策略' })}
            ${field('port', 'Port', draft.port || defaultPort(kind), { type: 'number' })}
            ${field('database', '数据库名', draft.database || (kind === 'postgres' ? 'postgres' : ''))}
            ${field('user', '用户名', draft.user || (kind === 'postgres' ? 'postgres' : 'root'))}
            <label class="field">
              <span>密码</span>
              <input class="input" type="password" data-key="password"
                placeholder="${connection?.has_password ? '已保存，留空不修改' : '输入密码'}" />
            </label>
            <label class="field checkbox-field">
              <span>连接选项</span>
              <label class="inline-check"><input type="checkbox" data-key="ssl" ${draft.ssl ? 'checked' : ''}/> 启用 SSL</label>
            </label>
          </div>
        `;
      }

      function bindFields() {
        fields.querySelectorAll('[data-key]').forEach((input) => {
          input.addEventListener('input', () => {
            capture();
            if (input.dataset.key === 'host' || input.dataset.key === 'uri') updateBanner();
          });
          input.addEventListener('change', () => {
            capture();
            if (input.dataset.key === 'host' || input.dataset.key === 'uri') updateBanner();
          });
        });
        fields.querySelector('#use-demo-path')?.addEventListener('click', () => {
          const input = fields.querySelector('[data-key="path"]');
          input.value = 'data/demo.db';
          draft.path = 'data/demo.db';
        });
        const modeWrap = fields.querySelector('#mongo-mode');
        modeWrap?.querySelectorAll('[data-mode]').forEach((button) => {
          button.addEventListener('click', () => {
            capture();
            const next = button.dataset.mode;
            if (next === mongoMode) return;
            mongoMode = next;
            if (next === 'uri' && !draft.uri && connection?.has_uri) draft.keep_uri = true;
            renderFields();
          });
        });
      }

      function renderFields() {
        fields.innerHTML = fieldsFor(currentKind);
        bindFields();
        updateBanner();
      }

      panel.querySelectorAll('[data-kind]').forEach((button) => {
        button.addEventListener('click', () => {
          if (button.dataset.kind === currentKind) return;
          capture();
          currentKind = button.dataset.kind;
          panel.querySelectorAll('[data-kind]').forEach((item) => item.classList.toggle('is-active', item === button));
          if (!editing) {
            draft.port = defaultPort(currentKind);
            draft.database = currentKind === 'postgres' ? 'postgres' : currentKind === 'mysql' ? '' : draft.database;
            draft.user = currentKind === 'postgres' ? 'postgres' : currentKind === 'mysql' ? 'root' : draft.user;
          }
          renderFields();
        });
      });

      readOnlyInput.addEventListener('change', () => {
        isReadOnly = readOnlyInput.checked;
        readOnlyTouched = true;
      });

      function collect() {
        capture();
        const name = nameInput.value.trim();
        const config = { ...draft };
        delete config.read_only;
        delete config.database_uri;
        delete config.keep_uri;
        if (currentKind === 'mongodb') {
          if (mongoMode === 'uri') {
            config.uri = String(draft.uri || '').trim();
            config.database = String(draft.database_uri || draft.database || 'mockfast').trim();
            if (connection?.has_uri && !config.uri) config.keep_uri = true;
            delete config.host;
            delete config.port;
          } else {
            config.host = String(draft.host || '127.0.0.1').trim();
            config.port = Number(draft.port || 27017);
            config.database = String(draft.database || 'mockfast').trim();
            config.user = String(draft.user || '');
            config.password = String(draft.password || '');
            config.auth_source = String(draft.auth_source || 'admin');
          }
        }
        return { name, kind: currentKind, config, read_only: readOnlyInput.checked };
      }

      async function runTest() {
        const button = panel.querySelector('#conn-test');
        const payload = collect();
        if (!payload.name) {
          toast('先给这个连接起个名字', 'warn');
          nameInput.focus();
          return;
        }
        setBusy(button, true, '测试中…');
        testBox.hidden = false;
        testBox.className = 'test-result is-loading';
        testBox.innerHTML = `<span class="spinner"></span><span>正在握手 ${esc(kindLabel(currentKind))}…</span>`;
        try {
          const result = await api.post('/api/connections/test', {
            kind: payload.kind,
            config: payload.config,
            connection_id: editing ? connection.id : null,
          });
          testBox.className = 'test-result is-success';
          testBox.innerHTML = `
            <span class="test-icon">${icon('check')}</span>
            <div>
              <strong>连接成功</strong>
              <p>${esc(result.version || kindLabel(currentKind))} · ${esc(formatDuration(result.latency_ms))}${result.is_remote ? ' · 远程' : ' · 本机'}</p>
            </div>`;
        } catch (error) {
          testBox.className = 'test-result is-error';
          testBox.innerHTML = `
            <span class="test-icon">${icon('alert')}</span>
            <div>
              <strong>连接失败</strong>
              <p>${esc(error.message)}</p>
              ${error.reasons?.length ? `<ul>${error.reasons.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
            </div>`;
          if (error.kind === 'policy_error') {
            testBox.querySelector('div').insertAdjacentHTML(
              'beforeend',
              `<button class="text-link" type="button" id="test-go-settings">去设置开启远程访问 →</button>`
            );
            testBox.querySelector('#test-go-settings')?.addEventListener('click', () => {
              closeModal();
              window.dispatchEvent(new CustomEvent('mf:navigate', { detail: 'settings' }));
            });
          }
        } finally {
          setBusy(button, false);
        }
      }

      panel.querySelector('#conn-cancel').addEventListener('click', closeModal);
      panel.querySelector('#conn-test').addEventListener('click', runTest);

      panel.querySelector('#conn-save').addEventListener('click', async () => {
        const button = panel.querySelector('#conn-save');
        const payload = collect();
        if (!payload.name) {
          toast('连接名称不能为空', 'warn');
          nameInput.focus();
          return;
        }
        if (currentKind === 'sqlite' && !payload.config.path) {
          toast('请填写 SQLite 文件路径', 'warn');
          return;
        }
        setBusy(button, true, '保存中…');
        try {
          let saved;
          if (editing) {
            saved = await api.put(`/api/connections/${connection.id}`, {
              name: payload.name,
              config: payload.config,
              read_only: payload.read_only,
            });
          } else {
            saved = await api.post('/api/connections', payload);
          }
          await refreshConnections();
          setActiveConnection(saved.id);
          closeModal();
          toast(editing ? '连接已更新' : '数据源已接入', 'success');
          window.dispatchEvent(new CustomEvent('mf:connection-selected', { detail: saved.id }));
        } catch (error) {
          testBox.hidden = false;
          testBox.className = 'test-result is-error';
          testBox.innerHTML = `
            <span class="test-icon">${icon('alert')}</span>
            <div><strong>保存失败</strong><p>${esc(error.message)}</p>${
              error.reasons?.length ? `<ul>${error.reasons.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : ''
            }</div>`;
          toastError(error);
        } finally {
          setBusy(button, false);
        }
      });

      panel.querySelector('#conn-delete')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: '删除这个连接？',
          message: `将移除连接 <b>${esc(connection.name)}</b>。数据库本身和已生成的 Mock 项目不会被自动删除；若仍有项目使用它，服务会拒绝删除。`,
          confirmText: '删除连接',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.del(`/api/connections/${connection.id}`);
          await refreshConnections();
          await refreshProjects();
          closeModal();
          toast('连接已删除', 'success');
          window.dispatchEvent(new CustomEvent('mf:connections-changed'));
        } catch (error) {
          toastError(error);
        }
      });

      renderFields();
      if (!editing && currentKind === 'sqlite') {
        draft.path = 'data/demo.db';
      }
    },
  });
  return modal;
}

/* ------------------------------------------------------------------------- */
/* Project creation                                                          */
/* ------------------------------------------------------------------------- */

export function openProjectModal({ template = null, table = null, schema = null, connectionId = null } = {}) {
  const initialConnection = connectionByIdSafe(connectionId) || activeConnection();
  if (!initialConnection) {
    toast('先接入一个数据源，再生成接口', 'warn');
    openConnectionModal();
    return null;
  }

  const defaultName = template ? `${template.name} Mock` : `${table || '数据表'} Mock`;
  const defaultSlug = template?.id || String(table || 'mock-table').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const defaultSeeds = template ? 18 : 0;
  let selectedFormat = 'result.data.pagination';
  let seedCount = defaultSeeds;
  let slugTouched = false;

  const body = document.createElement('div');
  body.innerHTML = `
    <form class="project-form" id="project-form" autocomplete="off">
      <div class="project-context">
        <span class="context-ico">${icon(template?.icon || 'table')}</span>
        <div>
          <strong>${esc(template?.name || table || '自定义数据表')}</strong>
          <p>${esc(template?.description || `基于 ${initialConnection.name} 中已有的 ${table || '表'} 生成标准 CRUD 接口。`)}</p>
        </div>
        ${template ? `<span class="tag">${template.field_count} 个字段</span>` : ''}
      </div>

      <div class="form-grid">
        <label class="field">
          <span>项目名称</span>
          <input class="input" id="proj-name" value="${esc(defaultName)}" autofocus />
        </label>
        <label class="field">
          <span>数据源</span>
          <select class="input select" id="proj-connection">
            ${state.connections.map((conn) => `<option value="${conn.id}" ${conn.id === initialConnection.id ? 'selected' : ''}>${esc(conn.name)} · ${kindLabel(conn.kind)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>表 / 集合</span>
          <input class="input mono" id="proj-table" value="${esc(table || template?.table || '')}" ${table ? 'readonly' : ''} />
        </label>
        <label class="field">
          <span>接口路径</span>
          <div class="input-prefix">
            <span>/mock/</span>
            <input class="input mono" id="proj-slug" value="${esc(defaultSlug)}" />
          </div>
          <small class="field-hint">小写字母、数字和短横线；会生成 ${esc(window.location.origin)}/mock/${esc(defaultSlug)}</small>
        </label>
      </div>

      <div class="form-block">
        <div class="block-head">
          <div><strong>种子数据</strong><small>写入几条带翻页的数据，创建后还能随时追加。</small></div>
          <div class="seed-picker" id="seed-picker">
            ${[0, 5, 18, 30, 50].map((count) => `<button type="button" class="${count === seedCount ? 'active' : ''}" data-count="${count}">${count === 0 ? '不写入' : `${count} 条`}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="form-block">
        <div class="block-head">
          <div><strong>响应格式</strong><small>选一个和你们现有前端约定一致的外壳，随时可以切换。</small></div>
        </div>
        <div class="format-list" id="format-list">${formatOptions(selectedFormat)}</div>
      </div>

      <div class="inline-error" id="project-error" hidden></div>
    </form>
  `;

  const footer = document.createElement('div');
  footer.className = 'modal-actions';
  footer.innerHTML = `
    <span class="spacer"></span>
    <button class="btn btn-ghost" type="button" id="project-cancel">取消</button>
    <button class="btn btn-primary" type="button" id="project-create">${icon('spark')}创建并生成接口</button>
  `;

  const modal = openModal({
    title: template ? '套用模板，生成一套接口' : '为已有表生成接口',
    subtitle: 'MockFast 会按表结构自动开放列表、详情、新增、更新和删除接口。',
    eyebrow: template ? 'TEMPLATE → API' : 'TABLE → API',
    iconName: 'layers',
    body,
    footer,
    size: 'lg',
    onMount: (panel) => {
      const nameInput = panel.querySelector('#proj-name');
      const slugInput = panel.querySelector('#proj-slug');
      const tableInput = panel.querySelector('#proj-table');
      const connectionSelect = panel.querySelector('#proj-connection');
      const errorBox = panel.querySelector('#project-error');

      nameInput.addEventListener('input', () => {
        if (!slugTouched) {
          const base = template?.id || slugify(nameInput.value) || 'mock';
          slugInput.value = base;
        }
      });
      slugInput.addEventListener('input', () => {
        slugTouched = true;
        slugInput.value = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      });
      panel.querySelectorAll('#seed-picker button').forEach((button) => {
        button.addEventListener('click', () => {
          seedCount = Number(button.dataset.count);
          panel.querySelectorAll('#seed-picker button').forEach((item) => item.classList.toggle('active', item === button));
        });
      });
      panel.querySelectorAll('.format-option input').forEach((input) => {
        input.addEventListener('change', () => {
          selectedFormat = input.value;
          panel.querySelectorAll('.format-option').forEach((option) => {
            option.classList.toggle('is-selected', option.querySelector('input').checked);
          });
        });
      });
      panel.querySelector('#project-cancel').addEventListener('click', closeModal);

      connectionSelect.addEventListener('change', () => {
        if (table) return;
        tableInput.value = template?.table || tableInput.value;
      });

      panel.querySelector('#project-create').addEventListener('click', async () => {
        const button = panel.querySelector('#project-create');
        const name = nameInput.value.trim();
        const slug = slugInput.value.trim();
        const tableName = tableInput.value.trim();
        errorBox.hidden = true;
        if (!name) {
          errorBox.hidden = false;
          errorBox.textContent = '项目名称不能为空';
          nameInput.focus();
          return;
        }
        if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(slug)) {
          errorBox.hidden = false;
          errorBox.textContent = '接口路径只能包含小写字母、数字和短横线，且以字母或数字开头。';
          slugInput.focus();
          return;
        }
        if (!tableName) {
          errorBox.hidden = false;
          errorBox.textContent = '表名不能为空';
          tableInput.focus();
          return;
        }
        setBusy(button, true, '创建中…');
        try {
          const result = await api.post('/api/projects', {
            name,
            slug,
            connection_id: connectionSelect.value,
            template_id: template?.id || null,
            table_name: tableName,
            schema_name: schema,
            response_format: selectedFormat,
            seed_count: seedCount,
          });
          await refreshProjects();
          closeModal();
          toast(
            `已生成接口 · 写入 ${result.seeded} 条数据`,
            result.warnings?.length ? 'warn' : 'success',
            { title: result.warnings?.length ? '接口已生成，有提示' : '接口已就绪' }
          );
          window.dispatchEvent(new CustomEvent('mf:projects-changed'));
          openProjectReady(result.project, { seeded: result.seeded, warnings: result.warnings });
        } catch (error) {
          errorBox.hidden = false;
          errorBox.textContent = error.reasons?.length
            ? `${error.message}：${error.reasons.join('；')}`
            : error.message;
          toastError(error);
        } finally {
          setBusy(button, false);
        }
      });
    },
  });
  return modal;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function connectionByIdSafe(id) {
  return state.connections.find((item) => item.id === id) || null;
}

/* ------------------------------------------------------------------------- */
/* Ready + preview                                                           */
/* ------------------------------------------------------------------------- */

export function openProjectReady(project, { seeded = 0, warnings = [] } = {}) {
  const base = absoluteUrl(project.base_path);
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="ready-hero">
      <span class="ready-burst">${icon('spark')}</span>
      <div>
        <strong>${esc(project.name)} 已经可以调用了</strong>
        <p>${seeded ? `已写入 ${seeded} 条种子数据 · ` : ''}${esc(project.connection_kind_label || '')} · ${esc(project.table_name)}</p>
      </div>
    </div>
    <div class="url-copy">
      <span class="mono">${esc(base)}</span>
      <button class="btn btn-small btn-ghost" id="ready-copy" type="button">${icon('copy')}复制</button>
    </div>
    ${warnings?.length ? `<div class="inline-warning">${warnings.map((item) => `<p>${esc(item)}</p>`).join('')}</div>` : ''}
    <div class="endpoint-list compact">
      ${project.endpoints.slice(0, 5).map((endpoint) => `
        <div class="endpoint-row">
          <span class="method ${endpoint.method.toLowerCase()}">${endpoint.method}</span>
          <code>${esc(endpoint.path)}</code>
          <span class="endpoint-label">${esc(endpoint.label)}</span>
        </div>
      `).join('')}
    </div>
    <div class="ready-note">
      <span>${icon('terminal')}</span>
      试试在终端里执行 <code>curl "${esc(base)}?page=1&pageSize=5"</code>
    </div>
  `;
  const footer = document.createElement('div');
  footer.className = 'modal-actions';
  footer.innerHTML = `
    <button class="btn btn-ghost" type="button" id="ready-close">稍后再看</button>
    <button class="btn btn-primary" type="button" id="ready-preview">${icon('eye')}预览响应</button>
  `;
  const modal = openModal({
    title: '接口已生成',
    subtitle: '下面这些地址现在就能被前端调用，跨域已放开。',
    eyebrow: 'READY TO CALL',
    iconName: 'zap',
    body,
    footer,
    size: 'md',
    onMount: (panel) => {
      panel.querySelector('#ready-copy').addEventListener('click', () => copyWithToast(base, 'Base URL 已复制'));
      panel.querySelector('#ready-close').addEventListener('click', closeModal);
      panel.querySelector('#ready-preview').addEventListener('click', () => {
        closeModal();
        openPreview(project);
      });
    },
  });
  return modal;
}

export async function openPreview(project) {
  const loading = openModal({
    title: '预览响应',
    subtitle: project.name,
    eyebrow: 'RESPONSE PREVIEW',
    iconName: 'eye',
    body: `<div class="preview-loading"><span class="spinner"></span><span>正在请求 ${esc(project.base_path)}…</span></div>`,
    size: 'lg',
  });
  try {
    const preview = await api.get(apiPath(`/api/projects/${project.id}/preview`, { page: 1, page_size: 3 }));
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="preview-meta">
        <span class="pill">${esc(project.response_format)}</span>
        <span class="muted">${formatNumber(preview.meta.total)} 条数据</span>
        <span class="muted">第 ${preview.meta.page} / ${preview.meta.totalPages} 页</span>
        <span class="spacer"></span>
        <button class="btn btn-small btn-ghost" id="preview-copy" type="button">${icon('copy')}复制 JSON</button>
      </div>
      <pre class="code-block preview-code"><code>${jsonHighlight(preview.body)}</code></pre>
      <div class="preview-foot">
        <div class="curl-block">
          <span>cURL</span>
          <code id="preview-curl">curl "${esc(absoluteUrl(project.base_path))}?page=1&amp;pageSize=10"</code>
          <button class="icon-btn" id="preview-copy-curl" type="button" title="复制 cURL">${icon('copy')}</button>
        </div>
      </div>
    `;
    loading.panel.querySelector('.modal-body').replaceChildren(body);
    body.querySelector('#preview-copy').addEventListener('click', () =>
      copyWithToast(JSON.stringify(preview.body, null, 2), '响应 JSON 已复制')
    );
    body.querySelector('#preview-copy-curl').addEventListener('click', () =>
      copyWithToast(`curl "${absoluteUrl(project.base_path)}?page=1&pageSize=10"`, 'cURL 已复制')
    );
  } catch (error) {
    const box = document.createElement('div');
    box.className = 'inline-error';
    box.textContent = error.message;
    loading.panel.querySelector('.modal-body').replaceChildren(box);
  }
}

/* ------------------------------------------------------------------------- */
/* Row editor                                                                */
/* ------------------------------------------------------------------------- */

function columnDefault(column) {
  let value = column.default;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1);
    if (/^(NULL|nextval\(.*\))$/i.test(trimmed)) return '';
    return trimmed;
  }
  return value;
}

function toLocalDatetime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function openRowModal({
  connectionId,
  table,
  schema = null,
  detail,
  row = null,
  onSaved = null,
}) {
  const editing = Boolean(row);
  const isMongo = detail.kind === 'collection';
  const primaryKey = detail.primary_key || (isMongo ? '_id' : 'id');
  let editor = null;
  const body = document.createElement('div');

  if (isMongo) {
    body.innerHTML = `
      <div class="inline-tip"><span>${icon('braces')}</span>以 JSON 编辑一条文档；<code>_id</code> 可留空由 MongoDB 生成。</div>
      <div id="row-json-editor" class="row-json-editor"></div>
    `;
  } else {
    const columns = detail.columns.filter(
      (column) => !column.auto_increment && !(editing && column.name === primaryKey)
    );
    body.innerHTML = `
      <form class="row-form" id="row-form">
        <div class="form-grid">
          ${columns.map((column) => {
            let value = editing ? row[column.name] : columnDefault(column);
            const type = String(column.type || '').toLowerCase();
            const lowerName = String(column.name || '').toLowerCase();
            if (
              !editing &&
              (value === '' || value === null || value === undefined) &&
              (lowerName.endsWith('_at') || lowerName === 'created_at' || lowerName === 'updated_at')
            ) {
              value = new Date().toISOString();
            }
            const name = esc(column.name);
            const label = `${esc(column.name)} <small>${esc(column.type)}</small>${column.nullable ? '' : ' <em class="required">*</em>'}`;
            if (type.includes('bool')) {
              return `<label class="field"><span>${label}</span><select class="input select" data-col="${name}">
                <option value="true" ${value === true || value === 1 || value === 'true' ? 'selected' : ''}>true</option>
                <option value="false" ${value === false || value === 0 || value === 'false' ? 'selected' : ''}>false</option>
              </select></label>`;
            }
            if (type.includes('json')) {
              return `<label class="field span-2"><span>${label}</span><textarea class="input textarea mono" rows="3" data-col="${name}" data-json="1">${esc(editing ? JSON.stringify(row[column.name] ?? null, null, 2) : '')}</textarea></label>`;
            }
            if (type.includes('date') && type.includes('time')) {
              return `<label class="field"><span>${label}</span><input class="input" type="datetime-local" data-col="${name}" value="${esc(toLocalDatetime(value))}" /></label>`;
            }
            if (type.includes('date')) {
              return `<label class="field"><span>${label}</span><input class="input" type="date" data-col="${name}" value="${esc(String(value || '').slice(0, 10))}" /></label>`;
            }
            if (type.includes('int') || type.includes('serial')) {
              return `<label class="field"><span>${label}</span><input class="input" type="number" step="1" data-col="${name}" value="${esc(value)}" ${column.nullable ? '' : 'required'} /></label>`;
            }
            if (type.includes('decimal') || type.includes('numeric') || type.includes('float') || type.includes('double') || type.includes('real')) {
              return `<label class="field"><span>${label}</span><input class="input" type="number" step="any" data-col="${name}" value="${esc(value)}" ${column.nullable ? '' : 'required'} /></label>`;
            }
            if (type.includes('text')) {
              return `<label class="field span-2"><span>${label}</span><textarea class="input textarea" rows="3" data-col="${name}">${esc(value)}</textarea></label>`;
            }
            return `<label class="field"><span>${label}</span><input class="input" data-col="${name}" value="${esc(value)}" ${column.nullable ? '' : 'required'} /></label>`;
          }).join('')}
        </div>
        <div class="inline-error" id="row-error" hidden></div>
      </form>
    `;
  }

  const footer = document.createElement('div');
  footer.className = 'modal-actions';
  footer.innerHTML = `
    <span class="spacer"></span>
    <button class="btn btn-ghost" type="button" id="row-cancel">取消</button>
    <button class="btn btn-primary" type="button" id="row-save">${editing ? '保存修改' : '插入这条数据'}</button>
  `;

  const modal = openModal({
    title: editing ? '编辑一行数据' : '手动插入一行',
    subtitle: `${table} · ${isMongo ? 'MongoDB 文档' : `${detail.columns.length} 个字段`}`,
    eyebrow: editing ? 'UPDATE ROW' : 'INSERT ROW',
    iconName: editing ? 'edit' : 'plus',
    body,
    footer,
    size: 'lg',
    onMount: (panel) => {
      if (isMongo) {
        editor = new CodeEditor(panel.querySelector('#row-json-editor'), {
          language: 'json',
          value: JSON.stringify(row || { name: '新的示例数据', created_at: new Date().toISOString() }, null, 2),
          minHeight: 300,
        });
      }
      panel.querySelector('#row-cancel').addEventListener('click', closeModal);
      panel.querySelector('#row-save').addEventListener('click', async () => {
        const button = panel.querySelector('#row-save');
        const errorBox = panel.querySelector('#row-error');
        let payload;
        if (isMongo) {
          try {
            payload = JSON.parse(editor.getValue() || '{}');
          } catch (error) {
            toast('JSON 格式不正确，请检查逗号和引号', 'error');
            return;
          }
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            toast('文档必须是一个 JSON 对象', 'error');
            return;
          }
        } else {
          payload = {};
          errorBox.hidden = true;
          panel.querySelectorAll('[data-col]').forEach((input) => {
            const key = input.dataset.col;
            const column = detail.columns.find((item) => item.name === key);
            let value = input.value;
            if (input.type === 'checkbox') value = input.checked;
            if (value === '' && column?.nullable) {
              payload[key] = null;
              return;
            }
            if (column && String(column.type).toLowerCase().includes('int') && value !== '') value = Number(value);
            else if (
              column &&
              /(decimal|numeric|float|double|real)/i.test(column.type) &&
              value !== ''
            ) value = Number(value);
            else if (column && String(column.type).toLowerCase().includes('bool')) value = value === 'true';
            else if (input.dataset.json) {
              try {
                value = value ? JSON.parse(value) : null;
              } catch {
                value = value;
              }
            }
            payload[key] = value;
          });
        }
        setBusy(button, true, '写入中…');
        try {
          const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
          const path = `/api/connections/${connectionId}/tables/${encodeURIComponent(table)}/rows`;
          if (editing) {
            const pk = row[primaryKey];
            await api.patch(`${path}/${encodeURIComponent(pk)}${query}`, { data: payload });
          } else {
            await api.post(`${path}${query}`, { data: payload });
          }
          closeModal();
          toast(editing ? '这行数据已更新' : '数据已插入', 'success');
          onSaved?.();
          window.dispatchEvent(new CustomEvent('mf:data-changed'));
        } catch (error) {
          if (errorBox) {
            errorBox.hidden = false;
            errorBox.textContent = error.reasons?.length ? `${error.message}：${error.reasons.join('；')}` : error.message;
          }
          toastError(error);
        } finally {
          setBusy(button, false);
        }
      });
    },
  });
  return modal;
}
