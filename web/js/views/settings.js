import { api } from '../api.js';
import { state } from '../store.js';
import { icon } from '../icons.js';
import {
  confirmDialog,
  copyWithToast,
  esc,
  formatNumber,
  toast,
  toastError,
} from '../ui.js';

export function mount(container) {
  const settings = state.settings || {};
  const allowRemote = Boolean(settings.allow_remote_db);
  const envOverride = settings.allow_remote_source === 'env';
  container.innerHTML = `
    <div class="page-head">
      <div class="page-heading">
        <div class="eyebrow">WORKSPACE SETTINGS</div>
        <h1>设置</h1>
        <p>数据源安全策略、日志保留、外观与运行信息。所有配置只保存在这台机器上。</p>
      </div>
      <div class="page-actions">
        <span class="local-pill"><span class="dot"></span>LOCAL ONLY</span>
      </div>
    </div>

    <div class="settings-grid">
      <section class="panel settings-card span-2">
        <header class="settings-head">
          <span class="settings-ico tone-mint">${icon('shield')}</span>
          <div>
            <h2>数据源安全策略</h2>
            <p>控制 MockFast 是否可以连接非本机数据库。默认关闭，防止误连测试/生产环境。</p>
          </div>
          <span class="tag ${allowRemote ? 'tag-warn' : 'tag-ok'}">${allowRemote ? '允许远程' : '仅本机'}</span>
        </header>
        <div class="settings-body">
          <label class="switch-row policy-switch">
            <input type="checkbox" id="policy-remote" ${allowRemote ? 'checked' : ''} ${envOverride ? 'disabled' : ''} />
            <span class="switch-track"><span></span></span>
            <span class="switch-copy">
              <strong>允许连接远程数据库</strong>
              <small>开启后，非 localhost 的地址可以保存和连接；建议同时为远程连接开启「只读」。</small>
            </span>
          </label>
          ${envOverride ? `
            <div class="inline-tip">
              ${icon('terminal')} 当前由环境变量 <code>MOCKFAST_ALLOW_REMOTE_DB</code> 控制，页面开关不可覆盖。
            </div>` : ''}
          <div class="policy-grid">
            <div class="policy-item">
              <span class="policy-dot ok"></span>
              <div><strong>默认仅本机</strong><p>localhost / 127.0.0.1 / ::1，以及项目 data/ 内的 SQLite 文件。</p></div>
            </div>
            <div class="policy-item">
              <span class="policy-dot warn"></span>
              <div><strong>远程需显式开启</strong><p>开启后建议只读连接，并在 SQL 控制台看清目标库再执行。</p></div>
            </div>
            <div class="policy-item">
              <span class="policy-dot danger"></span>
              <div><strong>生产库不要接</strong><p>MockFast 是开发工具，没有多用户权限、审计与备份能力。</p></div>
            </div>
          </div>
          <div class="settings-note">
            ${icon('alert')}
            修改立即生效。关闭远程访问后，已保存的远程连接也会被拒绝，直到重新开启。
          </div>
        </div>
      </section>

      <section class="panel settings-card">
        <header class="settings-head">
          <span class="settings-ico tone-blue">${icon('activity')}</span>
          <div>
            <h2>调用日志</h2>
            <p>记录 Mock 与 SQL 请求的响应时间、请求头和响应预览。</p>
          </div>
        </header>
        <div class="settings-body">
          <label class="field">
            <span>保留条数</span>
            <input class="input" id="log-retention" type="number" min="200" max="20000" step="100" value="${Number(settings.log_retention || 3000)}" />
            <small class="field-hint">取值范围 200 – 20000，超出后自动清理最旧记录。</small>
          </label>
          <div class="settings-actions">
            <button class="btn btn-small btn-primary-ghost" id="save-retention">${icon('check')}保存</button>
            <button class="btn btn-small btn-danger-ghost" id="clear-logs">${icon('trash')}清空日志</button>
          </div>
        </div>
      </section>

      <section class="panel settings-card">
        <header class="settings-head">
          <span class="settings-ico tone-amber">${icon('sun')}</span>
          <div>
            <h2>外观</h2>
            <p>深色适合长时间调试，浅色适合投屏和截图。</p>
          </div>
        </header>
        <div class="settings-body">
          <div class="theme-grid">
            <button class="theme-card ${state.theme === 'dark' ? 'is-active' : ''}" data-theme-set="dark">
              <span class="theme-preview dark"><i></i><i></i><i></i></span>
              <strong>深色</strong>
              <small>默认 · 开发者控制台</small>
            </button>
            <button class="theme-card ${state.theme === 'light' ? 'is-active' : ''}" data-theme-set="light">
              <span class="theme-preview light"><i></i><i></i><i></i></span>
              <strong>浅色</strong>
              <small>明亮 · 适合演示</small>
            </button>
          </div>
        </div>
      </section>

      <section class="panel settings-card span-2">
        <header class="settings-head">
          <span class="settings-ico tone-violet">${icon('server')}</span>
          <div>
            <h2>运行信息</h2>
            <p>本地服务地址、数据目录与版本。前端通过同源请求访问 API，不需要额外 CORS 配置。</p>
          </div>
          <span class="tag tag-ok">${icon('check')}运行中</span>
        </header>
        <div class="settings-body">
          <div class="runtime-grid">
            <div class="runtime-item">
              <span>服务地址</span>
              <code>${esc(window.location.origin)}</code>
              <button class="icon-btn tiny" data-copy="${esc(window.location.origin)}" title="复制">${icon('copy')}</button>
            </div>
            <div class="runtime-item">
              <span>版本</span>
              <code>MockFast v${esc(state.health?.version || '1.0.0')}</code>
            </div>
            <div class="runtime-item">
              <span>数据目录</span>
              <code title="${esc(settings.data_dir || '')}">${esc(settings.data_dir || '—')}</code>
              <button class="icon-btn tiny" data-copy="${esc(settings.data_dir || '')}" title="复制">${icon('copy')}</button>
            </div>
            <div class="runtime-item">
              <span>启动命令</span>
              <code>python run.py --port ${esc(state.health?.port || 8787)}</code>
              <button class="icon-btn tiny" data-copy="python run.py --port ${esc(state.health?.port || 8787)}" title="复制">${icon('copy')}</button>
            </div>
          </div>
          <div class="settings-actions">
            <a class="btn btn-small btn-ghost" href="/api/docs" target="_blank" rel="noreferrer">${icon('book')}OpenAPI 文档</a>
            <a class="btn btn-small btn-ghost" href="/api/health" target="_blank" rel="noreferrer">${icon('activity')}健康检查</a>
            <span class="muted tiny">${formatNumber(state.health?.projects || 0)} 个项目 · ${formatNumber(state.health?.connections || 0)} 个数据源</span>
          </div>
        </div>
      </section>

      <section class="panel settings-card span-2">
        <header class="settings-head">
          <span class="settings-ico tone-mint">${icon('database')}</span>
          <div>
            <h2>数据库可视化：为什么做进 MockFast</h2>
            <p>成熟的开源管理工具很多，但它们都需要另起服务、单独登录，且不容易和 Mock 生成打通。</p>
          </div>
        </header>
        <div class="settings-body">
          <div class="oss-grid">
            <a class="oss-card" href="https://www.adminer.org/" target="_blank" rel="noreferrer">
              <strong>Adminer <span>${icon('external')}</span></strong>
              <p>单文件 PHP 数据库管理，轻量但需要 PHP 运行时，嵌入受 CSP / 登录态限制。</p>
            </a>
            <a class="oss-card" href="https://github.com/dbeaver/cloudbeaver" target="_blank" rel="noreferrer">
              <strong>CloudBeaver <span>${icon('external')}</span></strong>
              <p>DBeaver 的 Web 版，能力完整但依赖 Java 服务与账号体系，适合团队级部署。</p>
            </a>
            <a class="oss-card" href="https://github.com/dbgate/dbgate" target="_blank" rel="noreferrer">
              <strong>DBGate <span>${icon('external')}</span></strong>
              <p>体验优秀的 Web 数据库客户端，可 Docker 部署；独立 UI 与 Mock 工作流割裂。</p>
            </a>
            <a class="oss-card" href="https://github.com/nocodb/nocodb" target="_blank" rel="noreferrer">
              <strong>NocoDB <span>${icon('external')}</span></strong>
              <p>把数据库变成 Airtable 式表格，偏业务协作，SQL 控制与 Mock 生成不是它的重点。</p>
            </a>
          </div>
          <div class="inline-tip">
            ${icon('spark')}
            MockFast 选择内置一个「够用的 schema / 数据浏览器」：零额外服务、与生成接口共用连接、写入前统一走安全守卫。
            需要更重的库管理时，仍可继续使用你熟悉的 Adminer / CloudBeaver / DBGate。
          </div>
        </div>
      </section>
    </div>
  `;

  bind(container);
  return null;
}

function bind(container) {
  const policy = container.querySelector('#policy-remote');
  policy?.addEventListener('change', async () => {
    const next = policy.checked;
    policy.disabled = true;
    try {
      const settings = await api.put('/api/settings', { allow_remote_db: next });
      state.settings = settings;
      toast(next ? '已允许远程数据库连接' : '已恢复为仅本机访问', 'success');
      window.dispatchEvent(new CustomEvent('mf:settings-changed'));
    } catch (error) {
      policy.checked = !next;
      toastError(error);
    } finally {
      policy.disabled = false;
    }
  });

  container.querySelector('#save-retention')?.addEventListener('click', async () => {
    const input = container.querySelector('#log-retention');
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 200) {
      toast('保留条数最少为 200', 'warn');
      return;
    }
    try {
      state.settings = await api.put('/api/settings', { log_retention: value });
      toast(`日志保留条数已设为 ${state.settings.log_retention}`, 'success');
    } catch (error) {
      toastError(error);
    }
  });

  container.querySelector('#clear-logs')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '清空全部调用日志？',
      message: '日志用于排查响应时间和请求头，清空后不可恢复；不会影响数据库数据。',
      confirmText: '清空日志',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del('/api/logs');
      toast('调用日志已清空', 'success');
    } catch (error) {
      toastError(error);
    }
  });

  container.querySelectorAll('[data-theme-set]').forEach((button) => {
    button.addEventListener('click', () => {
      const theme = button.dataset.themeSet;
      window.dispatchEvent(new CustomEvent('mf:theme', { detail: theme }));
      container.querySelectorAll('[data-theme-set]').forEach((item) => {
        item.classList.toggle('is-active', item.dataset.themeSet === theme);
      });
    });
  });

  container.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', () => copyWithToast(button.dataset.copy, '已复制'));
  });
}
