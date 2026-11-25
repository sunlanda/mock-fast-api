const BASE = '';

export class ApiError extends Error {
  constructor(message, { kind = 'error', status = 0, reasons = [], detail = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.reasons = reasons;
    this.detail = detail;
  }
}

async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const options = { method, headers: { Accept: 'application/json', ...headers } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(BASE + path, options);
  } catch (error) {
    throw new ApiError('无法连接到 MockFast 服务，请确认本地服务仍在运行。', {
      kind: 'network_error',
      status: 0,
    });
  }

  if (response.status === 204) return null;
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const detail = data && data.detail !== undefined ? data.detail : data;
    let message = `请求失败（HTTP ${response.status}）`;
    let kind = 'http_error';
    let reasons = [];
    if (typeof detail === 'string') {
      message = detail;
    } else if (detail && typeof detail === 'object') {
      message = detail.message || detail.error || message;
      kind = detail.kind || kind;
      reasons = detail.reasons || [];
      if (Array.isArray(detail.errors) && detail.errors.length) {
        const first = detail.errors[0];
        message = `${message}：${first.msg || '字段不合法'}${first.loc ? ` (${first.loc.join('.')})` : ''}`;
      }
    }
    throw new ApiError(message, { kind, status: response.status, reasons, detail });
  }
  return raw ? { data, response } : data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path, body) => request(path, { method: 'DELETE', body }),
  raw: request,
};

export function apiPath(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, value);
  });
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export function errorText(error) {
  if (!error) return '未知错误';
  if (error.reasons && error.reasons.length) {
    return `${error.message}\n· ${error.reasons.join('\n· ')}`;
  }
  return error.message || String(error);
}
