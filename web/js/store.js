import { api } from './api.js';

export const state = {
  view: 'workbench',
  connections: [],
  projects: [],
  templates: [],
  formats: [],
  settings: null,
  health: null,
  activeConnectionId: localStorage.getItem('mf.connection') || null,
  theme: localStorage.getItem('mf.theme') || 'dark',
};

export const bus = {
  emit(name, detail = null) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  },
  on(name, handler) {
    window.addEventListener(name, handler);
    return () => window.removeEventListener(name, handler);
  },
};

export function activeConnection() {
  return state.connections.find((item) => item.id === state.activeConnectionId) || null;
}

export function setActiveConnection(id, { persist = true } = {}) {
  state.activeConnectionId = id;
  if (persist) {
    if (id) localStorage.setItem('mf.connection', id);
    else localStorage.removeItem('mf.connection');
  }
}

export function connectionById(id) {
  return state.connections.find((item) => item.id === id) || null;
}

export function projectById(id) {
  return state.projects.find((item) => item.id === id) || null;
}

export async function refreshConnections() {
  const data = await api.get('/api/connections');
  state.connections = data.items || [];
  if (!state.connections.some((item) => item.id === state.activeConnectionId)) {
    setActiveConnection(state.connections[0]?.id || null);
  }
  return state.connections;
}

export async function refreshProjects() {
  const data = await api.get('/api/projects');
  state.projects = data.items || [];
  return state.projects;
}

export async function loadBootstrap() {
  const [health, connections, projects, templates, formats, settings] = await Promise.all([
    api.get('/api/health'),
    api.get('/api/connections'),
    api.get('/api/projects'),
    api.get('/api/templates'),
    api.get('/api/formats'),
    api.get('/api/settings'),
  ]);
  state.health = health;
  state.connections = connections.items || [];
  state.projects = projects.items || [];
  state.templates = templates.items || [];
  state.formats = formats.items || [];
  state.settings = settings;
  if (!state.connections.some((item) => item.id === state.activeConnectionId)) {
    setActiveConnection(state.connections[0]?.id || null);
  }
  if (!state.formats.some((item) => item.id === 'result.data.pagination')) {
    // Server always returns formats; this is a defensive fallback for older data.
    state.formats = [];
  }
  return state;
}

export function formatMeta(id) {
  return state.formats.find((item) => item.id === id) || null;
}

export function connectionKindLabel(kind) {
  return (
    {
      sqlite: 'SQLite',
      postgres: 'PostgreSQL',
      mysql: 'MySQL',
      mongodb: 'MongoDB',
    }[kind] || kind || 'Database'
  );
}
