import { icon } from './icons.js';
import { errorText } from './api.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return new Intl.NumberFormat('zh-CN').format(number);
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  const value = Number(ms);
  if (Number.isNaN(value)) return '—';
  if (value < 1) return `${value.toFixed(2)} ms`;
  if (value < 1000) return `${value.toFixed(1)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  const value = Number(bytes);
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return '刚刚';
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return formatDateTime(iso);
}

export function methodClass(method) {
  return `method-${String(method || 'GET').toLowerCase()}`;
}

export function statusClass(status) {
  const value = Number(status);
  if (value >= 500) return 'is-error';
  if (value >= 400) return 'is-warn';
  if (value >= 300) return 'is-info';
  if (value >= 200) return 'is-ok';
  return 'is-muted';
}

export function toast(message, type = 'success', { title = '', duration = 3600 } = {}) {
  const root = qs('#toast-root');
  if (!root) return;
  const toastEl = document.createElement('div');
  toastEl.className = `toast toast-${type}`;
  const iconName = type === 'error' ? 'alert' : type === 'warn' ? 'alert' : type === 'info' ? 'spark' : 'check';
  toastEl.innerHTML = `
    <span class="toast-icon">${icon(iconName)}</span>
    <div class="toast-copy">
      ${title ? `<strong>${esc(title)}</strong>` : ''}
      <span>${esc(message)}</span>
    </div>
    <button class="toast-close" type="button" aria-label="关闭">${icon('x')}</button>
  `;
  root.appendChild(toastEl);
  const remove = () => {
    toastEl.classList.add('leaving');
    setTimeout(() => toastEl.remove(), 220);
  };
  toastEl.querySelector('.toast-close').addEventListener('click', remove);
  setTimeout(remove, Math.max(duration, message.length > 80 ? 6000 : duration));
}

export function toastError(error) {
  const text = errorText(error);
  toast(text, 'error', { title: error?.kind === 'blocked' ? '已被安全策略拦截' : '操作没有完成', duration: 6500 });
}

let activeModal = null;
let activeDrawer = null;

export function openModal({
  title = '',
  subtitle = '',
  eyebrow = '',
  iconName = '',
  body = '',
  footer = '',
  size = 'md',
  onMount = null,
  closeOnBackdrop = true,
  closeOnEscape = true,
} = {}) {
  closeModal();
  const root = qs('#modal-root');
  const layer = document.createElement('div');
  layer.className = 'modal-layer';
  layer.innerHTML = `
    <div class="modal-backdrop"></div>
    <section class="modal-panel modal-${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head">
        <div class="modal-heading">
          ${eyebrow ? `<span class="modal-eyebrow">${esc(eyebrow)}</span>` : ''}
          <div class="modal-title-row">
            ${iconName ? `<span class="modal-icon">${icon(iconName)}</span>` : ''}
            <div>
              <h2>${esc(title)}</h2>
              ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
            </div>
          </div>
        </div>
        <button class="icon-btn modal-close" type="button" aria-label="关闭">${icon('x')}</button>
      </header>
      <div class="modal-body"></div>
      ${footer ? '<footer class="modal-foot"></footer>' : ''}
    </section>
  `;
  root.appendChild(layer);
  const panel = layer.querySelector('.modal-panel');
  const bodyEl = layer.querySelector('.modal-body');
  if (body instanceof HTMLElement) bodyEl.appendChild(body);
  else bodyEl.innerHTML = body;
  if (footer) {
    const foot = layer.querySelector('.modal-foot');
    if (footer instanceof HTMLElement) foot.appendChild(footer);
    else foot.innerHTML = footer;
  }
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => layer.classList.add('open'));

  const close = () => {
    layer.classList.remove('open');
    document.body.classList.remove('modal-open');
    setTimeout(() => {
      layer.remove();
      if (activeModal === layer) activeModal = null;
    }, 180);
  };
  activeModal = layer;
  layer.querySelector('.modal-close')?.addEventListener('click', close);
  if (closeOnBackdrop) {
    layer.querySelector('.modal-backdrop')?.addEventListener('click', close);
  }
  const keyHandler = (event) => {
    if (event.key === 'Escape' && closeOnEscape) {
      close();
      document.removeEventListener('keydown', keyHandler);
    }
  };
  document.addEventListener('keydown', keyHandler);
  setTimeout(() => {
    const focusable = layer.querySelector('[autofocus], input, textarea, select, button.btn-primary');
    focusable?.focus();
  }, 80);
  if (onMount) onMount(panel, close);
  return { panel, close };
}

export function closeModal() {
  const root = qs('#modal-root');
  if (root) root.innerHTML = '';
  document.body.classList.remove('modal-open');
  activeModal = null;
}

export function confirmDialog({
  title = '确认操作',
  message = '',
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  requireText = null,
  requireLabel = '',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      closeModal();
    };
    const body = `
      <div class="confirm-copy">${message}</div>
      ${requireText ? `
        <label class="field confirm-field">
          <span>${esc(requireLabel || `请输入 ${requireText} 以继续`)}</span>
          <input id="confirm-input" class="input" autocomplete="off" placeholder="${esc(requireText)}" />
        </label>` : ''}
    `;
    const footer = document.createElement('div');
    footer.className = 'modal-actions';
    footer.innerHTML = `
      <button class="btn btn-ghost" type="button" data-cancel>${esc(cancelText)}</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-confirm ${requireText ? 'disabled' : ''}>
        ${esc(confirmText)}
      </button>
    `;
    const { panel, close } = openModal({
      title,
      subtitle: danger ? '这个操作不可撤销，请确认你了解影响。' : '',
      iconName: danger ? 'alert' : 'shield',
      body,
      footer,
      size: 'sm',
      onMount: (panelEl) => {
        const input = panelEl.querySelector('#confirm-input');
        const confirmButton = panelEl.querySelector('[data-confirm]');
        if (requireText && input) {
          input.addEventListener('input', () => {
            confirmButton.disabled = input.value.trim() !== requireText;
          });
          setTimeout(() => input.focus(), 50);
        }
        confirmButton.addEventListener('click', () => finish(true));
        panelEl.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
        const closeButton = panelEl.querySelector('.modal-close');
        closeButton?.addEventListener('click', () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        });
        const backdrop = panelEl.previousElementSibling;
        backdrop?.addEventListener('click', () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        });
      },
    });
    const observer = new MutationObserver(() => {
      if (!document.body.contains(panel) && !settled) {
        settled = true;
        resolve(false);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
    void close;
  });
}

export function openDrawer({
  title = '',
  subtitle = '',
  body = '',
  width = '560px',
  onMount = null,
} = {}) {
  closeDrawer();
  const root = qs('#drawer-root');
  const layer = document.createElement('div');
  layer.className = 'drawer-layer';
  layer.innerHTML = `
    <div class="drawer-backdrop"></div>
    <aside class="drawer-panel" style="--drawer-width:${width}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="drawer-head">
        <div>
          <h2>${esc(title)}</h2>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
        </div>
        <button class="icon-btn drawer-close" type="button" aria-label="关闭">${icon('x')}</button>
      </header>
      <div class="drawer-body"></div>
    </aside>
  `;
  root.appendChild(layer);
  const panel = layer.querySelector('.drawer-panel');
  const bodyEl = layer.querySelector('.drawer-body');
  if (body instanceof HTMLElement) bodyEl.appendChild(body);
  else bodyEl.innerHTML = body;
  document.body.classList.add('drawer-open');
  requestAnimationFrame(() => layer.classList.add('open'));
  const close = () => {
    layer.classList.remove('open');
    document.body.classList.remove('drawer-open');
    setTimeout(() => {
      layer.remove();
      if (activeDrawer === layer) activeDrawer = null;
    }, 200);
  };
  activeDrawer = layer;
  layer.querySelector('.drawer-close')?.addEventListener('click', close);
  layer.querySelector('.drawer-backdrop')?.addEventListener('click', close);
  const keyHandler = (event) => {
    if (event.key === 'Escape') {
      close();
      document.removeEventListener('keydown', keyHandler);
    }
  };
  document.addEventListener('keydown', keyHandler);
  if (onMount) onMount(panel, close);
  return { panel, close };
}

export function closeDrawer() {
  const root = qs('#drawer-root');
  if (root) root.innerHTML = '';
  document.body.classList.remove('drawer-open');
  activeDrawer = null;
}

export async function copyText(text) {
  const value = String(text ?? '');
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export async function copyWithToast(text, label = '已复制到剪贴板') {
  const ok = await copyText(text);
  toast(ok ? label : '复制失败，请手动选择文本', ok ? 'success' : 'error');
  return ok;
}

export function jsonHighlight(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let output = '';
  let last = 0;
  let match;
  while ((match = pattern.exec(text))) {
    output += esc(text.slice(last, match.index));
    if (match[1]) {
      output += `<span class="${match[2] ? 'tok-key' : 'tok-string'}">${esc(match[1])}</span>`;
      if (match[2]) output += esc(match[2]);
    } else if (match[3]) {
      output += `<span class="tok-bool">${esc(match[3])}</span>`;
    } else {
      output += `<span class="tok-num">${esc(match[4])}</span>`;
    }
    last = pattern.lastIndex;
  }
  output += esc(text.slice(last));
  return output;
}

const SQL_KEYWORDS = new Set(
  `SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP TRUNCATE JOIN LEFT RIGHT INNER OUTER ON GROUP BY ORDER HAVING LIMIT OFFSET ASC DESC AND OR NOT NULL IS IN EXISTS BETWEEN LIKE ILIKE AS DISTINCT UNION ALL CASE WHEN THEN ELSE END WITH RETURNING PRIMARY KEY FOREIGN REFERENCES INDEX UNIQUE DEFAULT CONSTRAINT INT INTEGER TEXT VARCHAR CHAR BOOLEAN BOOL DATE DATETIME TIMESTAMP NUMERIC DECIMAL JSON JSONB SERIAL BEGIN COMMIT ROLLBACK EXPLAIN ANALYZE SHOW DESCRIBE PRAGMA ATTACH DETACH VACUUM GRANT REVOKE COPY CALL`.split(/\s+/)
);
const SQL_FUNCTIONS = new Set(
  `COUNT SUM AVG MIN MAX COALESCE IFNULL NOW CURRENT_TIMESTAMP CURRENT_DATE LOWER UPPER LENGTH SUBSTR CONCAT ROUND CAST JSON_EXTRACT JSONB_ARRAY_LENGTH ROW_NUMBER RANK DENSE_RANK`.split(/\s+/)
);

export function sqlHighlight(sql) {
  const source = String(sql || '');
  const pattern = /(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|\\.|[^'])*'|"(?:[^"]|"")*"|`[^`]*`|\b[A-Za-z_][A-Za-z0-9_]*\b|\b\d+(?:\.\d+)?\b)/g;
  let output = '';
  let last = 0;
  let match;
  while ((match = pattern.exec(source))) {
    output += esc(source.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('--') || token.startsWith('/*')) {
      output += `<span class="tok-comment">${esc(token)}</span>`;
    } else if (/^['"`]/.test(token)) {
      output += `<span class="tok-string">${esc(token)}</span>`;
    } else if (/^\d/.test(token)) {
      output += `<span class="tok-num">${esc(token)}</span>`;
    } else if (SQL_KEYWORDS.has(token.toUpperCase())) {
      output += `<span class="tok-keyword">${esc(token)}</span>`;
    } else if (SQL_FUNCTIONS.has(token.toUpperCase())) {
      output += `<span class="tok-fn">${esc(token)}</span>`;
    } else {
      output += esc(token);
    }
    last = pattern.lastIndex;
  }
  output += esc(source.slice(last));
  return output;
}

export function emptyState({ iconName = 'box', title = '这里还空着', description = '', action = '' } = {}) {
  return `
    <div class="empty-state">
      <div class="empty-orb">${icon(iconName)}</div>
      <h3>${esc(title)}</h3>
      ${description ? `<p>${description}</p>` : ''}
      ${action ? `<div class="empty-action">${action}</div>` : ''}
    </div>
  `;
}

export function skeleton(lines = 4) {
  return `<div class="skeleton-block">${Array.from({ length: lines }).map(() => '<span class="skeleton-line"></span>').join('')}</div>`;
}

export function setBusy(button, busy, label = '处理中…') {
  if (!button) return;
  if (busy) {
    button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span><span>${esc(label)}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.original) button.innerHTML = button.dataset.original;
  }
}

export function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function escapeSelector(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}
