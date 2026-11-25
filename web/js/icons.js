// Inline stroke icon set. Keep it dependency-free so MockFast works offline.
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
  terminal: '<rect x="2.5" y="4" width="19" height="16" rx="3"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>',
  activity: '<path d="M3 12h3l2.5-6 4 12L15.5 12H21"/>',
  sliders: '<path d="M4 6h9"/><path d="M17 6h3"/><circle cx="15" cy="6" r="2"/><path d="M4 12h3"/><path d="M11 12h9"/><circle cx="9" cy="12" r="2"/><path d="M4 18h9"/><path d="M17 18h3"/><circle cx="15" cy="18" r="2"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  x: '<path d="m6 6 12 12"/><path d="M18 6 6 18"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.1"/><path d="M20 4v7h-7"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V7"/><path d="M6.5 7l.8 12.2A2 2 0 0 0 9.3 21h5.4a2 2 0 0 0 2-1.8L17.5 7"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18"/><path d="M9 9.5V20"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.4-3.6 2.8-5.6 6-5.6s5.6 2 6 5.6"/><path d="M16 5.4a3 3 0 0 1 0 5.2"/><path d="M17.5 14.8c2.1.6 3.3 2.4 3.5 5.2"/>',
  shopping: '<path d="M5 7h14l-1 13H6L5 7Z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h3"/>',
  file: '<path d="M7 3h7l4 4v14H7V3Z"/><path d="M14 3v5h4"/><path d="M10 13h5"/><path d="M10 17h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  spark: '<path d="M12 3.5 13.7 9l5.3 1.7-5.3 1.8L12 18l-1.7-5.5L5 10.7 10.3 9 12 3.5Z"/><path d="M19 16.5v4"/><path d="M17 18.5h4"/>',
  link: '<path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8A4 4 0 0 0 12.8 5l-1.3 1.3"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8A4 4 0 0 0 11.2 19l1.3-1.3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>',
  zap: '<path d="M13 2 4.5 13H11l-1 9 8.5-11H12l1-9Z"/>',
  code: '<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m13.5 5-3 14"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.9 4.9 6.3 6.3"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/>',
  moon: '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/><path d="M12 14.5v2.5"/>',
  alert: '<path d="M12 3.5 21 20H3L12 3.5Z"/><path d="M12 9v5"/><circle cx="12" cy="17.2" r=".9" fill="currentColor" stroke="none"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><circle cx="7.5" cy="7.5" r=".9" fill="currentColor" stroke="none"/><circle cx="7.5" cy="16.5" r=".9" fill="currentColor" stroke="none"/><path d="M12 7.5h5"/><path d="M12 16.5h5"/>',
  'arrow-right': '<path d="M4 12h16"/><path d="m14 6 6 6-6 6"/>',
  'arrow-up-right': '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  dots: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8"/><path d="m16 4 3 3"/><path d="m14 6 3 3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19v1h16v-1"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>',
  braces: '<path d="M8 4c-2 0-2.5 1-2.5 3v3c0 1.5-.8 2-2 2 1.2 0 2 .5 2 2v3c0 2 .5 3 2.5 3"/><path d="M16 4c2 0 2.5 1 2.5 3v3c0 1.5.8 2 2 2-1.2 0-2 .5-2 2v3c0 2-.5 3-2.5 3"/>',
  send: '<path d="m21 3-9.5 18-2.2-7.3L2 11.5 21 3Z"/><path d="M9.3 13.7 21 3"/>',
  filter2: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5"/><path d="M12 12v9"/>',
  wand: '<path d="m15 4 1.5 3L20 8.5 16.5 10 15 13l-1.5-3L10 8.5 13.5 7 15 4Z"/><path d="m4 20 8-8"/>',
  shield: '<path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
};

export function icon(name, className = '') {
  const body = ICONS[name] || ICONS.dots;
  return `<svg class="ico ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}
