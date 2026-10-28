const $ = s => document.querySelector(s);
const uid = () => crypto.randomUUID().slice(0, 8);
const byId = id => data.pages.find(p => p.id === id);
const isDb = p => p?.kind === 'database';
// Typing "# " etc. at the start of a plain block converts it.
const SHORTCUTS = [['# ', 'h1'], ['## ', 'h2'], ['### ', 'h3'], ['- ', 'bullet'], ['[] ', 'todo'], ['1. ', 'numbered'], ['> ', 'quote'], ['``` ', 'code']];
// Block types offered by the "/" menu and the + buttons: [type, label, hint, icon].
const BLOCK_MENU = [
  ['text', 'Text', 'Plain paragraph', 'T'],
  ['h1', 'Heading 1', 'Big section heading', 'H1'],
  ['h2', 'Heading 2', 'Medium section heading', 'H2'],
  ['h3', 'Heading 3', 'Small section heading', 'H3'],
  ['todo', 'To-do list', 'Track tasks with a checkbox', '☐'],
  ['bullet', 'Bulleted list', 'A simple list', '•'],
  ['numbered', 'Numbered list', 'A list with numbers', '1.'],
  ['quote', 'Quote', 'Capture a quote', '❝'],
  ['callout', 'Callout', 'Make a note stand out', '💡'],
  ['code', 'Code', 'Monospace code', '</>'],
  ['divider', 'Divider', 'Separate sections', '—'],
];
const CONTINUES = ['bullet', 'todo', 'numbered']; // Enter on these starts another of the same type
let lastBlockId = null; // block that last had focus, where dictation types

let data, current, mode = 'doc', saveTimer, pendingPageId;
let openTabs = [];

function save() {
  if (current) current.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
// A failed write (file briefly locked by another process) is retried, not dropped.
let saveRetries = 0;
function flush() {
  if (api.save(data)) return saveRetries = 0;
  if (saveRetries++ < 20) saveTimer = setTimeout(flush, 500);
}
window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); api.save(data); });

// Appearance: the shell theme, accent, font, density, corners and width. Mirrors into localStorage so
// theme-boot.js can paint the right theme before the workspace file loads.
function applyTheme() {
  if (!data.appearance) data.appearance = { theme: data.theme === 'light' ? 'paper' : 'vayun' };
  // One time: workspaces still on the old default dark theme move to the Vayun brand theme.
  if (!data.brandTheme) { if (data.appearance.theme === 'midnight') data.appearance.theme = 'vayun'; data.brandTheme = 1; }
  const a = (data.appearance = FolioTheme.sanitizeAppearance(data.appearance));
  const info = FOLIO_APP_THEMES[a.theme] || { dark: true };
  const root = document.documentElement;
  root.dataset.appTheme = a.theme;
  root.dataset.theme = info.dark ? 'dark' : 'light';
  for (const [k, v] of Object.entries(FolioTheme.appearanceVars(a, info))) root.style.setProperty(k, v);
  try { localStorage.setItem('folio-appearance', JSON.stringify(a)); } catch { /* private window: skip the cache */ }
  const css = v => getComputedStyle(root).getPropertyValue(v).trim();
  api.setTitleBar?.(css('--side'), css('--muted')); // window buttons match the tab bar
}
/* Pages */

function openPage(id, nextMode = 'doc') {
  current = byId(id) || data.pages[0];
  if (!current) return createPage(null);
  mode = nextMode;
  if (!openTabs.includes(current.id)) openTabs.push(current.id);
  data.recent = [current.id, ...data.recent.filter(r => r !== current.id)].slice(0, 5);
  render();
  save();
}

function createPage(parentId) {
  const page = { id: uid(), title: '', parentId, blocks: [{ id: uid(), type: 'text', text: '' }] };
  data.pages.push(page);
  openPage(page.id);
  $('#title').focus();
}

// The workspace calendar is one page; the sidebar button opens it, creating it the first time.
function openCalendar() {
  let cal = data.pages.find(p => p.kind === 'calendar');
  if (!cal) {
    cal = { id: uid(), title: 'Calendar', parentId: null, kind: 'calendar', events: [], blocks: [] };
    data.pages.push(cal);
  }
  openPage(cal.id);
}

// The team page, like the calendar, is one page per workspace; the sidebar button opens it.
function openTeam() {
  let page = data.pages.find(p => p.kind === 'team');
  if (!page) {
    page = { id: uid(), title: 'Team', parentId: null, kind: 'team', blocks: [] };
    data.pages.push(page);
  }
  openPage(page.id);
}

function createDatabase() {
  const db = makeDatabase(uid(), '', TASK_SCHEMA);
  db.blocks = [];
  data.pages.push(db);
  openPage(db.id);
  $('#title').focus();
}

function deletePage() {
  const ids = [current.id];
  for (let i = 0; i < ids.length; i++) data.pages.forEach(p => { if (p.parentId === ids[i]) ids.push(p.id); });
  const extra = ids.length > 1 ? ` and ${ids.length - 1} item(s) inside` : '';
  if (!confirm(`Delete "${current.title || 'Untitled'}"${extra}? This cannot be undone.`)) return;
  const parentId = current.parentId;
  data.pages = data.pages.filter(p => !ids.includes(p.id));
  data.recent = data.recent.filter(r => !ids.includes(r));
  openPage(parentId && byId(parentId) ? parentId : data.pages[0]?.id);
}

// Template pages (Life OS, Study OS) render in their own container with their own widgets.
let activeTemplate = null;
function unmountTemplate() {
  if (activeTemplate) activeTemplate.destroy();
  activeTemplate = null;
}
function renderTemplate() {
  for (const id of ['#title', '#props', '#doc', '#dbview', '#mindmap']) $(id).hidden = true;
  const host = $('#tpl');
  host.hidden = false;
  unmountTemplate();
  const appDark = (FOLIO_APP_THEMES[data.appearance && data.appearance.theme] || { dark: true }).dark;
  const resolved = FolioTheme.resolveTheme({
    pageTheme: current.theme, appMode: appDark ? 'dark' : 'light',
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
  });
  if (current.template === 'life') {
    current.state = FolioTemplates.sanitizeLife(current.state);
    activeTemplate = FolioLife.mount(host, current, { resolvedTheme: resolved, onChange: () => save() });
  } else if (current.template === 'study') {
    current.state = FolioTemplates.sanitizeStudy(current.state);
    activeTemplate = FolioStudy.mount(host, current, { resolvedTheme: resolved, onChange: () => save() });
  } else if (current.kind === 'calendar') {
    activeTemplate = FolioCalendar.mount(host, current, { getPages: () => data.pages, dateProp, openRow: id => openPage(id), onChange: () => save(), openTeam });
  } else if (current.kind === 'team') {
    activeTemplate = FolioTeam.mount(host, current, { onChange: () => save() });
  }
}
function render() {
  renderSidebar();
  renderCrumb();
  renderTabs();
  renderMeta();
  renderFavs();
  renderToolbar();
  if (current.kind === 'template' || current.kind === 'calendar' || current.kind === 'team') { renderTemplate(); return; }
  unmountTemplate();
  $('#tpl').hidden = true;
  $('#title').hidden = false;
  $('#title').textContent = current.title;
  const db = isDb(current);
  $('#mindmap').hidden = mode !== 'mindmap';
  $('#dbview').hidden = !db || mode === 'mindmap';
  $('#doc').hidden = db || mode === 'mindmap';
  $('#props').hidden = true;
  if (mode === 'mindmap') return renderMindmap();
  if (db) return renderDatabase();
  const parent = byId(current.parentId);
  if (isDb(parent)) renderProps(parent);
  renderBlocks();
}

function renderTabs() {
  const bar = $('#tabs');
  bar.innerHTML = '';
  openTabs = openTabs.filter(id => byId(id));
  for (const id of openTabs) {
    const p = byId(id);
    const tab = document.createElement('div');
    tab.className = 'tab' + (p === current ? ' on' : '');
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'tab-label';
    label.textContent = (isDb(p) ? '▦ ' : '') + (p.title || 'Untitled');
    label.onclick = () => openPage(p.id);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'tab-x';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Close tab');
    x.onclick = e => { e.stopPropagation(); closeTab(p.id); };
    tab.append(label, x);
    bar.append(tab);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tab-add';
  add.textContent = '+';
  add.title = 'New page (Ctrl+N)';
  add.setAttribute('aria-label', 'New page');
  add.onclick = () => createPage(null);
  bar.append(add);
}

function closeTab(id) {
  const i = openTabs.indexOf(id);
  if (i >= 0) openTabs.splice(i, 1);
  if (current.id !== id) return renderTabs();
  const next = openTabs[i] || openTabs[i - 1];
  openPage(next || data.pages[0]?.id);
}

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function renderMeta() {
  const edited = typeof current.updatedAt === 'number' ? current.updatedAt : Date.parse(current.updatedAt);
  $('#edited').textContent = Number.isFinite(edited) ? `Edited ${ago(edited)}` : '';
  const star = $('#star-btn');
  star.textContent = current.starred ? '★' : '☆';
  star.classList.toggle('on', !!current.starred);
  star.title = current.starred ? 'Remove from favorites' : 'Add to favorites';
}

function toggleStar() {
  current.starred = !current.starred;
  save();
  render();
}

function renderFavs() {
  const nav = $('#favs');
  nav.innerHTML = '';
  for (const p of data.pages.filter(p => p.starred)) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = (isDb(p) ? '▦ ' : '') + (p.title || 'Untitled');
    if (p === current) a.className = 'active';
    a.onclick = e => { e.preventDefault(); openPage(p.id); };
    nav.append(a);
  }
  $('#favs-group').hidden = !nav.children.length;
}
// Pages made from templates (Life OS, Study OS) and the ⌘K commands that create them.
function createTemplatePage({ template, theme, sample }) {
  const id = uid();
  data.pages.push(FolioTemplates.makeTemplatePage(id, template, { theme, sample }));
  openPage(id);
}

function toggleLightDark() {
  const dark = (FOLIO_APP_THEMES[data.appearance && data.appearance.theme] || { dark: true }).dark;
  data.appearance = { ...(data.appearance || {}), theme: dark ? 'paper' : 'vayun' };
  applyTheme();
  save();
}

function commandItems() {
  const cmd = (title, run) => ({ id: 'cmd:' + title, kind: 'command', title, blocks: [], run });
  return [
    cmd('Ask the assistant', () => FolioAssistantUI.open()),
    cmd('Open calendar', openCalendar),
    cmd('Open team', openTeam),
    cmd('Toggle light / dark', toggleLightDark),
    cmd('Change theme…', () => $('#theme-btn').click()),
    cmd('New Life OS page', () => FolioPicker.open(createTemplatePage, { template: 'life' })),
    cmd('New Study OS page', () => FolioPicker.open(createTemplatePage, { template: 'study' })),
  ];
}
function renderCrumb() {
  const el = $('#crumb');
  el.innerHTML = '';
  const path = [];
  for (let p = current, depth = 0; p && depth < 50; p = byId(p.parentId), depth++) path.unshift(p); // depth cap guards against cycles
  path.forEach((p, i) => {
    if (i) { const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '/'; el.append(sep); }
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.title || 'Untitled';
    b.disabled = p === current;
    b.onclick = () => openPage(p.id);
    el.append(b);
  });
}
function renderSidebar() {
  const tree = $('#tree');
  tree.innerHTML = '';
  const walk = (parentId, depth) => data.pages.filter(p => p.parentId === parentId).forEach(p => {
    const a = document.createElement('a');
    a.href = '#';
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = p.title || 'Untitled';
    a.append(icon(isDb(p) ? 'table' : p.kind === 'template' ? p.template : p.kind === 'calendar' ? 'calendar' : p.kind === 'team' ? 'team' : 'page'), label);
    a.style.paddingLeft = `${12 + depth * 14}px`;
    if (p === current) { a.className = 'active'; a.setAttribute('aria-current', 'page'); }
    a.onclick = e => { e.preventDefault(); openPage(p.id); };
    tree.append(a);
    walk(p.id, depth + 1);
  });
  walk(null, 0);
}

// Stroke icons (24px grid) for the page tree.
const ICONS = {
  page: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5',
  table: 'M4 5h16v14H4z M4 10h16 M10 5v14',
  life: 'M3 19l6-9 4 6 3-4 5 7z',
  study: 'M5 5a2 2 0 0 1 2-2h12v16H7a2 2 0 0 0-2 2z M5 19V5',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5',
  team: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M2 20c0-3.3 3-5 7-5s7 1.7 7 5 M17 11a2.5 2.5 0 1 0 0-5 M18 15c2.5 0 4 1.5 4 4',
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || ICONS.page);
  svg.append(path);
  return svg;
}

function button(label, onClick, extra = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (extra.id) b.id = extra.id;
  if (extra.active) b.className = 'on';
  b.onclick = onClick;
  return b;
}

function renderToolbar() {
  const bar = $('#toolbar');
  bar.innerHTML = '';
  const add = (...els) => els.forEach(el => bar.append(el));
  const more = [];
  if (current.kind !== 'template' && current.kind !== 'calendar' && current.kind !== 'team') {
    if (isDb(current)) {
      const v = viewOf(current);
      for (const t of VIEW_TYPES) add(button(t[0].toUpperCase() + t.slice(1), () => { current.view = { ...v, type: t }; render(); save(); }, { active: v.type === t, id: `view-${t}` }));
      add(button('+ Row', addRow, { id: 'add-row' }), button('+ Property', addProperty, { id: 'add-prop' }));
    }
    if (!isDb(current) && mode === 'doc') {
      const mic = button('🎙 Dictate', dictate, { id: 'dictate-btn' });
      mic.title = 'Speak to type into the page (Windows voice typing)';
      mic.onmousedown = e => e.preventDefault(); // keep the caret in the block being edited
      add(mic);
    }
    add(button('Mindmap', () => { mode = mode === 'mindmap' ? 'doc' : 'mindmap'; render(); }, { id: 'mm-btn', active: mode === 'mindmap' }));
    more.push(button('Add subpage', () => createPage(current.id), { id: 'sub-btn' }));
    const exp = isDb(current) ? [['CSV', 'csv']] : [['HTML', 'html'], ['Markdown', 'md']];
    for (const [label, ext] of exp) more.push(button(`Export ${label}`, () => exportCurrent(ext), { id: `exp-${ext}` }));
    more.push(button('Duplicate', duplicatePage, { id: 'dup-btn' }), button('Move to…', movePage, { id: 'move-btn' }));
  }
  more.push(button('Delete page', deletePage, { id: 'del-btn' }));
  add(moreMenu(more));
}

// "•••" button with a dropdown of secondary page actions. Closes on pick, outside click or Escape.
function moreMenu(items) {
  const wrap = document.createElement('div');
  wrap.className = 'more';
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const toggle = button('•••', () => setOpen(menu.hidden), { id: 'more-btn' });
  toggle.setAttribute('aria-label', 'More page actions');
  toggle.setAttribute('aria-haspopup', 'menu');
  toggle.setAttribute('aria-expanded', 'false');
  const outside = e => { if (!wrap.contains(e.target)) setOpen(false); };
  function setOpen(open) {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) { document.addEventListener('mousedown', outside); menu.querySelector('button')?.focus(); }
    else document.removeEventListener('mousedown', outside);
  }
  for (const b of items) {
    const run = b.onclick;
    b.setAttribute('role', 'menuitem');
    b.onclick = e => { setOpen(false); run(e); };
    menu.append(b);
  }
  menu.addEventListener('keydown', e => { if (e.key === 'Escape') { setOpen(false); toggle.focus(); } });
  wrap.append(toggle, menu);
  return wrap;
}

async function exportCurrent(ext) {
  const content = ext === 'csv' ? toCsv(current, rowsOf(current, data.pages))
    : ext === 'html' ? toHtml(current) : toMarkdown(current);
  const path = await api.exportFile(current.title || 'Untitled', ext, content);
  if (path) alert(`Saved ${path}`);
}

/* Blocks (plain pages and database rows) */

function caretOffset(el) {
  const sel = getSelection();
  if (!sel.rangeCount) return 0;
  const r = sel.getRangeAt(0), pre = r.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}

function setCaret(el, pos) {
  el.focus();
  const node = el.firstChild, r = document.createRange();
  node ? r.setStart(node, Math.min(pos, node.length)) : r.setStart(el, 0);
  r.collapse(true);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
}

function renderBlocks(focusId, caret = 0) {
  closeSlash();
  const box = $('#blocks');
  box.innerHTML = '';
  let n = 0;
  current.blocks.forEach(b => {
    const row = document.createElement('div');
    row.className = `block ${b.type}`;
    row.dataset.id = b.id;
    n = b.type === 'numbered' ? n + 1 : 0;
    if (n) row.dataset.n = n;
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'block-add';
    plus.textContent = '+';
    plus.title = 'Add a block below';
    plus.setAttribute('aria-label', 'Add a block below');
    plus.onclick = () => insertSlashBlock(current.blocks.indexOf(b) + 1);
    row.append(plus);
    if (b.type === 'divider') {
      row.tabIndex = 0;
      row.setAttribute('role', 'separator');
      row.setAttribute('aria-label', 'Divider. Press Delete to remove.');
      row.append(document.createElement('hr'));
      row.onkeydown = e => {
        if (e.key !== 'Backspace' && e.key !== 'Delete') return;
        e.preventDefault();
        const i = current.blocks.indexOf(b);
        current.blocks.splice(i, 1);
        if (!current.blocks.length) current.blocks.push({ id: uid(), type: 'text', text: '' });
        renderBlocks(current.blocks[Math.min(i, current.blocks.length - 1)].id);
        save();
      };
      box.append(row);
      if (b.id === focusId) row.focus();
      return;
    }
    if (b.type === 'callout') {
      const ico = document.createElement('span');
      ico.className = 'callout-icon';
      ico.setAttribute('aria-hidden', 'true');
      ico.textContent = '💡';
      row.append(ico);
    }
    if (b.type === 'todo') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!b.checked;
      cb.setAttribute('aria-label', 'Done');
      cb.onchange = () => { b.checked = cb.checked; row.classList.toggle('done', cb.checked); save(); };
      row.classList.toggle('done', !!b.checked);
      row.append(cb);
    }
    const t = document.createElement('div');
    t.className = 'text';
    t.contentEditable = 'plaintext-only';
    t.textContent = b.text;
    const label = (BLOCK_MENU.find(m => m[0] === b.type) || BLOCK_MENU[0])[1];
    t.dataset.placeholder = b.type === 'text' ? "Type '/' for commands" : label;
    t.oninput = () => onInput(b, t);
    t.onkeydown = e => onKey(e, b, t);
    t.onfocus = () => { lastBlockId = b.id; };
    t.onblur = () => setTimeout(() => { if (slash && slash.b === b && document.activeElement !== t) closeSlash(); }, 120);
    row.append(t);
    box.append(row);
    if (b.id === focusId) setCaret(t, caret);
  });
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'add-block';
  more.textContent = '+ Add a block';
  more.onclick = () => insertSlashBlock(current.blocks.length);
  box.append(more);
}

// Puts the caret in the last edited block (or a new one at the end) and opens Windows voice typing there.
async function dictate() {
  let b = current.blocks.find(x => x.id === lastBlockId && x.type !== 'divider');
  if (!b) {
    const last = current.blocks.at(-1);
    b = last && last.type === 'text' && !last.text ? last : { id: uid(), type: 'text', text: '' };
    if (b !== last) { current.blocks.push(b); save(); }
    renderBlocks(b.id, Infinity);
  }
  const t = document.querySelector(`#blocks [data-id="${b.id}"] .text`);
  if (t && document.activeElement !== t) setCaret(t, Infinity);
  const r = await api.startDictation();
  if (r?.error) $('#dictate-btn').title = r.error;
}

// Inserts an empty block holding "/" at index, so the command menu opens on it.
function insertSlashBlock(index) {
  const b = { id: uid(), type: 'text', text: '/' };
  current.blocks.splice(index, 0, b);
  renderBlocks(b.id, 1);
  const t = [...$('#blocks').children].find(r => r.contains(document.activeElement))?.querySelector('.text');
  if (t) openSlash(b, t, 0, '');
}

function onInput(b, t) {
  b.text = t.textContent;
  if (b.type === 'text' && b.text === '---') {
    b.type = 'divider';
    b.text = '';
    const next = { id: uid(), type: 'text', text: '' };
    current.blocks.splice(current.blocks.indexOf(b) + 1, 0, next);
    renderBlocks(next.id);
    return save();
  }
  const match = b.type === 'text' && SHORTCUTS.find(([prefix]) => b.text.startsWith(prefix));
  if (match) {
    const caret = caretOffset(t) - match[0].length;
    b.type = match[1];
    b.text = b.text.slice(match[0].length);
    renderBlocks(b.id, Math.max(0, caret));
    return save();
  }
  // "/" at the start or after a space opens the command menu; the text after it filters the list.
  const before = b.text.slice(0, caretOffset(t));
  const m = b.type !== 'code' && /(^|\s)\/([^\s/]*)$/.exec(before);
  if (m) openSlash(b, t, before.length - m[2].length - 1, m[2]);
  else closeSlash();
  save();
}

/* "/" command menu */

let slash = null; // { b, t, start, query, items, active, el }

function openSlash(b, t, start, query) {
  const q = query.toLowerCase();
  const items = BLOCK_MENU.filter(([type, label]) => !q || label.toLowerCase().includes(q) || type.includes(q));
  if (!slash) {
    const el = document.createElement('div');
    el.className = 'slash-menu';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Block types');
    document.body.append(el);
    slash = { el };
  }
  Object.assign(slash, { b, t, start, query, items, active: Math.min(slash.b === b ? slash.active || 0 : 0, Math.max(0, items.length - 1)) });
  drawSlash();
  const range = getSelection().rangeCount ? getSelection().getRangeAt(0).getBoundingClientRect() : null;
  const r = range && range.height ? range : t.getBoundingClientRect();
  const below = r.bottom + 6 + slash.el.offsetHeight < innerHeight;
  slash.el.style.left = `${Math.min(r.left, innerWidth - slash.el.offsetWidth - 12)}px`;
  slash.el.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - slash.el.offsetHeight - 6)}px`;
}

function drawSlash() {
  const { el, items, active } = slash;
  el.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'slash-head';
  head.textContent = 'Basic blocks';
  el.append(head);
  if (!items.length) {
    const none = document.createElement('div');
    none.className = 'slash-empty';
    none.textContent = 'No matching blocks';
    return el.append(none);
  }
  items.forEach(([type, label, hint, ico], i) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'slash-item' + (i === active ? ' on' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(i === active));
    item.dataset.type = type;
    const icon = document.createElement('span');
    icon.className = 'slash-ico';
    icon.textContent = ico;
    const text = document.createElement('span');
    const l = document.createElement('div');
    l.className = 'slash-label';
    l.textContent = label;
    const hnt = document.createElement('div');
    hnt.className = 'slash-hint';
    hnt.textContent = hint;
    text.append(l, hnt);
    item.append(icon, text);
    item.onmousedown = e => { e.preventDefault(); pickSlash(type); };
    el.append(item);
    if (i === active) item.scrollIntoView({ block: 'nearest' });
  });
}

function closeSlash() {
  if (!slash) return;
  slash.el.remove();
  slash = null;
}

// Applies the picked type: an empty block changes type, otherwise a new block goes below it.
function pickSlash(type) {
  const { b, start, query } = slash;
  closeSlash();
  b.text = (b.text.slice(0, start) + b.text.slice(start + 1 + query.length)).trimEnd();
  const i = current.blocks.indexOf(b);
  let target = b;
  if (b.text.trim()) {
    target = { id: uid(), type, text: '' };
    current.blocks.splice(i + 1, 0, target);
  } else {
    b.type = type;
    b.text = '';
  }
  if (type === 'todo') target.checked = false;
  if (type === 'divider') {
    const next = { id: uid(), type: 'text', text: '' };
    current.blocks.splice(current.blocks.indexOf(target) + 1, 0, next);
    target = next;
  }
  renderBlocks(target.id, Infinity);
  save();
}

// Nearest block in direction dir (+1 / -1) that has editable text.
function textNeighbour(i, dir) {
  for (let j = i + dir; j >= 0 && j < current.blocks.length; j += dir) if (current.blocks[j].type !== 'divider') return current.blocks[j];
  return null;
}

function onKey(e, b, t) {
  if (slash && slash.b === b) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const len = slash.items.length || 1;
      slash.active = (slash.active + (e.key === 'ArrowDown' ? 1 : len - 1)) % len;
      return drawSlash();
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && slash.items.length) { e.preventDefault(); return pickSlash(slash.items[slash.active][0]); }
    if (e.key === 'Escape') { e.preventDefault(); return closeSlash(); }
  }
  const i = current.blocks.indexOf(b);
  const atStart = getSelection().isCollapsed && caretOffset(t) === 0;
  if (e.key === 'Enter' && b.type === 'code' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault(); // Enter adds a line inside code; Ctrl+Enter leaves the block
    document.execCommand('insertText', false, '\n');
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!b.text && b.type !== 'text') { b.type = 'text'; renderBlocks(b.id); return save(); } // Enter on an empty list item ends the list
    const pos = b.type === 'code' ? b.text.length : caretOffset(t);
    const next = { id: uid(), type: CONTINUES.includes(b.type) ? b.type : 'text', text: b.text.slice(pos) };
    b.text = b.text.slice(0, pos);
    current.blocks.splice(i + 1, 0, next);
    renderBlocks(next.id);
    save();
  } else if (e.key === 'Backspace' && atStart) {
    if (b.type !== 'text') { e.preventDefault(); b.type = 'text'; renderBlocks(b.id); save(); }
    else if (i > 0 && current.blocks[i - 1].type === 'divider') {
      e.preventDefault();
      current.blocks.splice(i - 1, 1);
      renderBlocks(b.id);
      save();
    } else if (i > 0) {
      e.preventDefault();
      const prev = current.blocks[i - 1], at = prev.text.length;
      prev.text += b.text;
      current.blocks.splice(i, 1);
      renderBlocks(prev.id, at);
      save();
    }
  } else if (e.key === 'ArrowUp' && atStart && textNeighbour(i, -1)) {
    e.preventDefault();
    renderBlocks(textNeighbour(i, -1).id, Infinity);
  } else if (e.key === 'ArrowDown' && caretOffset(t) === b.text.length && textNeighbour(i, 1)) {
    e.preventDefault();
    renderBlocks(textNeighbour(i, 1).id, 0);
  }
}

/* Cells: one editor per property type, shared by table rows and row pages */

function cellEditor(row, prop, onChange) {
  const v = row.props?.[prop.id];
  let el;
  if (prop.type === 'checkbox') {
    el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = v === true;
    el.onchange = () => { row.props[prop.id] = el.checked; onChange(); };
  } else if (prop.type === 'select') {
    el = document.createElement('select');
    el.append(new Option('', ''));
    (prop.options || []).forEach(o => el.append(new Option(o, o)));
    el.value = textOf(v);
    el.onchange = () => { row.props[prop.id] = el.value; onChange(); };
  } else {
    el = document.createElement('input');
    el.type = prop.type === 'date' ? 'date' : prop.type === 'number' ? 'number' : 'text';
    el.value = prop.type === 'date' ? textOf(v).slice(0, 10) : textOf(v);
    el.onchange = () => { row.props[prop.id] = prop.type === 'number' && el.value !== '' ? Number(el.value) : el.value; onChange(); };
  }
  el.setAttribute('aria-label', prop.name);
  el.className = `cell ${prop.type}`;
  return el;
}

function renderProps(db) {
  const box = $('#props');
  box.innerHTML = '';
  box.hidden = false;
  for (const prop of db.schema) {
    const label = document.createElement('label');
    label.className = 'prop';
    label.textContent = prop.name;
    label.append(cellEditor(current, prop, () => { save(); renderSidebar(); }));
    box.append(label);
  }
}

/* Database views */

function renderDatabase() {
  const box = $('#dbview');
  box.innerHTML = '';
  const db = current, v = viewOf(db);

  // Filter and sort controls live above the view and update it in place.
  const bar = document.createElement('div');
  bar.className = 'dbbar';
  const flt = document.createElement('input');
  flt.type = 'search';
  flt.placeholder = 'Filter…';
  flt.value = v.filter?.value || '';
  const fProp = propSelect(db, v.filter?.propId || 'title', true);
  const sProp = propSelect(db, v.sort?.propId || '', true, 'Sort by…');
  const sDir = document.createElement('select');
  sDir.append(new Option('Ascending', 'asc'), new Option('Descending', 'desc'));
  sDir.value = v.sort?.dir || 'asc';
  const gProp = propSelect(db, v.group || '', true, 'No grouping', 'select');
  const apply = () => {
    db.view = { ...viewOf(db),
      filter: flt.value ? { propId: fProp.value || 'title', value: flt.value } : null,
      sort: sProp.value ? { propId: sProp.value, dir: sDir.value } : null,
      group: gProp.value || null };
    save();
    drawRows();
  };
  [flt, fProp, sProp, sDir, gProp].forEach(el => el.addEventListener(el === flt ? 'input' : 'change', apply));
  bar.append(flt, fProp, sProp, sDir, gProp);
  box.append(bar);

  const body = document.createElement('div');
  box.append(body);
  drawRows();

  function drawRows() {
    body.innerHTML = '';
    const rows = visibleRows(db, data.pages);
    const groups = groupRows(db, rows);
    if (v.type === 'table') body.append(table(groups));
    else if (v.type === 'board') body.append(board(groups));
    else if (v.type === 'calendar') body.append(calendar(rows));
    else body.append(cards(rows, v.type === 'list'));
    if (!rows.length) body.insertAdjacentHTML('beforeend', '<p class="empty">No rows.</p>');
  }
}

function propSelect(db, selected, allowTitle, placeholder = 'Filter by…', only) {
  const s = document.createElement('select');
  if (placeholder) s.append(new Option(placeholder, ''));
  if (allowTitle && !only) s.append(new Option('Name', 'title'));
  db.schema.filter(p => !only || p.type === only).forEach(p => s.append(new Option(p.name, p.id)));
  s.value = selected;
  return s;
}

function openRow(row) { openPage(row.id); }

function titleLink(row) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rowlink';
  b.textContent = row.title || 'Untitled';
  b.onclick = () => openRow(row);
  return b;
}

function table(groups) {
  const db = current;
  const t = document.createElement('table');
  t.className = 'table';
  const head = t.createTHead().insertRow();
  ['Name', ...db.schema.map(p => p.name)].forEach((h, i) => {
    const th = document.createElement('th');
    if (i) th.append(button(h, () => editProperty(db.schema[i - 1])));
    else th.textContent = h;
    head.append(th);
  });
  head.append(document.createElement('th'));
  for (const g of groups) {
    if (viewOf(db).group) {
      const tr = t.insertRow();
      const td = tr.insertCell();
      td.colSpan = db.schema.length + 2;
      td.className = 'group';
      td.textContent = `${g.label} (${g.rows.length})`;
    }
    for (const row of g.rows) {
      const tr = t.insertRow();
      tr.insertCell().append(titleLink(row));
      for (const prop of db.schema) {
        tr.insertCell().append(cellEditor(row, prop, () => { save(); renderDatabase(); }));
      }
      tr.insertCell().append(button('Delete', () => deleteRow(row)));
    }
  }
  return t;
}

function board(groups) {
  const db = current;
  const grp = viewOf(db).group || db.schema.find(p => p.type === 'select')?.id;
  if (!grp) return msg('Add a select property (for example Status) to use the board.');
  const cols = groupRows({ ...db, view: { ...viewOf(db), group: grp } }, visibleRows(db, data.pages));
  const wrap = document.createElement('div');
  wrap.className = 'board';
  for (const g of cols) {
    const col = document.createElement('div');
    col.className = 'col';
    const h = document.createElement('h3');
    h.textContent = `${g.label} (${g.rows.length})`;
    col.append(h);
    g.rows.forEach(r => { const c = document.createElement('div'); c.className = 'card'; c.append(titleLink(r), cellEditor(r, db.schema.find(p => p.id === grp), () => { save(); renderDatabase(); })); col.append(c); });
    wrap.append(col);
  }
  return wrap;
}

function cards(rows, asList) {
  const db = current;
  const wrap = document.createElement('div');
  wrap.className = asList ? 'listview' : 'gallery';
  for (const r of rows) {
    const c = document.createElement('div');
    c.className = 'card';
    c.append(titleLink(r));
    const summary = db.schema.map(p => textOf(r.props?.[p.id])).filter(Boolean).join(' · ');
    if (summary) { const s = document.createElement('div'); s.className = 'snippet'; s.textContent = summary; c.append(s); }
    wrap.append(c);
  }
  return wrap;
}

// Month grid of the rows by their date property. Clicking a day adds a row on that date.
let dbCalAnchor = null;
function calendar(rows) {
  const db = current, dp = dateProp(db);
  if (!dp) return msg('Add a date property (for example Due) to use the calendar.');
  const anchor = dbCalAnchor || FolioCalLogic.dayKey(new Date());
  const events = rows.map(r => {
    const d = textOf(r.props?.[dp.id]).slice(0, 10);
    return { id: r.id, rowId: r.id, source: 'row', title: r.title || 'Untitled', startDate: d, endDate: d, allDay: true, notes: db.title || '' };
  }).filter(e => FolioCalLogic.isDate(e.startDate));
  const wrap = document.createElement('div');
  wrap.className = 'calpage dbcal';
  const go = n => { dbCalAnchor = n ? FolioCalLogic.shiftMonth(anchor, n) : null; renderDatabase(); };
  const bar = document.createElement('div');
  bar.className = 'cal-bar';
  const nav = document.createElement('div');
  nav.className = 'cal-nav';
  const title = document.createElement('h2');
  title.className = 'cal-title';
  title.textContent = FolioCalendar.monthLabel(anchor);
  nav.append(button('‹', () => go(-1)), button('Today', () => go(0)), button('›', () => go(1)), title);
  const undated = rows.length - events.length;
  const note = document.createElement('span');
  note.className = 'cal-note';
  if (undated) note.textContent = `${undated} row(s) without a ${dp.name} date`;
  bar.append(nav, note);
  wrap.append(bar, FolioCalendar.grid({
    view: 'month', anchor, events,
    onEvent: e => openRow(byId(e.rowId)),
    onMore: null,
    onDay: d => { const row = makeRow(uid(), db, '', { [dp.id]: d }); data.pages.push(row); save(); renderDatabase(); },
  }));
  return wrap;
}

function msg(text) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = text; return p; }

function isDescendant(pageId, ancestorId) {
  for (let p = byId(byId(pageId)?.parentId), d = 0; p && d < 50; p = byId(p.parentId), d++) if (p.id === ancestorId) return true;
  return false;
}

// Removes a page and everything under it. Returns nothing; callers decide where to go next.
function removeSubtree(id) {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) data.pages.forEach(p => { if (p.parentId === ids[i]) ids.push(p.id); });
  data.pages = data.pages.filter(p => !ids.includes(p.id));
  data.recent = data.recent.filter(r => !ids.includes(r));
  openTabs = openTabs.filter(t => !ids.includes(t));
}

function deleteRow(row) {
  if (!confirm(`Delete "${row.title || 'Untitled'}"? This cannot be undone.`)) return;
  removeSubtree(row.id);
  save();
  renderDatabase();
}

async function editProperty(prop) {
  const f = await askForm('Edit property', [
    { name: 'name', label: 'Name', type: 'text', value: prop.name },
    { name: 'type', label: 'Type', type: 'select', options: PROP_TYPES, value: prop.type },
    { name: 'options', label: 'Options, comma separated (select only)', type: 'text', value: (prop.options || []).join(', ') },
    { name: 'del', label: 'Property', type: 'select', options: ['Keep it', 'Delete it and its values'], value: 'Keep it' },
  ]);
  if (!f) return;
  if (f.del !== 'Keep it') {
    if (!confirm(`Delete property "${prop.name}" from every row? This cannot be undone.`)) return;
    current.schema = current.schema.filter(p => p.id !== prop.id);
    data.pages.forEach(p => { if (p.props) delete p.props[prop.id]; });
  } else {
    if (!f.name.trim()) return;
    prop.name = f.name.trim();
    prop.type = f.type;
    if (f.type === 'select') prop.options = f.options.split(',').map(s => s.trim()).filter(Boolean);
    else delete prop.options;
  }
  save();
  render();
}

function cloneBlocks(blocks) { return blocks.map(b => ({ ...b, id: uid() })); }

// Copies the page; a database also copies its rows.
function duplicatePage() {
  const copy = { ...JSON.parse(JSON.stringify(current)), id: uid(), title: `${current.title || 'Untitled'} (copy)`, starred: false, updatedAt: Date.now() };
  copy.blocks = cloneBlocks(current.blocks);
  data.pages.push(copy);
  if (isDb(current)) {
    for (const row of data.pages.filter(p => p.parentId === current.id)) {
      data.pages.push({ ...JSON.parse(JSON.stringify(row)), id: uid(), parentId: copy.id, blocks: cloneBlocks(row.blocks) });
    }
  }
  save();
  openPage(copy.id);
}

async function movePage() {
  const options = [{ value: '', label: 'Top level' }, ...data.pages
    .filter(p => p.id !== current.id && !isDescendant(p.id, current.id))
    .map(p => ({ value: p.id, label: `${isDb(p) ? '▦ ' : ''}${p.title || 'Untitled'}` }))];
  const f = await askForm('Move to', [{ name: 'parent', label: 'Parent page', type: 'select', options, value: current.parentId || '' }]);
  if (!f) return;
  current.parentId = f.parent || null;
  save();
  render();
}

function addChild(parentId) {
  data.pages.push({ id: uid(), title: '', parentId, blocks: [{ id: uid(), type: 'text', text: '' }] });
  if (byId(parentId)) byId(parentId).collapsed = false;
  save();
  renderSidebar();
  renderMindmap();
}

async function renameNode(id) {
  const page = byId(id);
  const f = await askForm('Rename', [{ name: 'title', label: 'Title', type: 'text', value: page.title || '' }]);
  if (!f) return;
  page.title = f.title.trim();
  save();
  render();
}

function deleteNode(id) {
  const page = byId(id);
  const inside = data.pages.filter(p => isDescendant(p.id, id)).length;
  if (!confirm(`Delete "${page.title || 'Untitled'}"${inside ? ` and ${inside} item(s) inside` : ''}? This cannot be undone.`)) return;
  const parentId = page.parentId;
  removeSubtree(id);
  if (!byId(current.id)) return openPage(parentId && byId(parentId) ? parentId : data.pages[0]?.id);
  save();
  render();
}
function addRow() {
  const row = makeRow(uid(), current, '', {});
  data.pages.push(row);
  save();
  renderDatabase();
}

async function addProperty() {
  const f = await askForm('New property', [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'type', label: 'Type', type: 'select', options: PROP_TYPES },
    { name: 'options', label: 'Options, comma separated (select only)', type: 'text' },
  ]);
  if (!f || !f.name.trim()) return;
  const prop = { id: 'p' + uid(), name: f.name.trim(), type: f.type };
  if (f.type === 'select') prop.options = f.options.split(',').map(s => s.trim()).filter(Boolean);
  current.schema.push(prop);
  save();
  render();
}

/* Mindmap: the current page and its subpages as a tree */

// Mindmap: the current page and its subpages on a canvas. Drag nodes, pan, zoom, and edit from the keyboard.
// Positions are saved per page (mm); pages without one sit in the automatic tidy layout.
const MM_COLORS = ['#8ea2ff', '#f2b35c', '#6fd3a0', '#e97b8f', '#b59cff'];
const MM_W = 200, MM_H = 40, MM_GAPX = 80, MM_GAPY = 16;
let mmSel = null, mmView = { x: 40, y: 40, k: 1 }, mmDrag = null, mmShownFor = null, mmLast = { pos: new Map(), edges: [] };

// Tidy tree: children sit to the right of their parent, leaves stack top to bottom, parents centre on their children.
function mmLayout(tree) {
  const pos = new Map();
  let row = 0;
  const place = (node, depth) => {
    const kids = byId(node.id).collapsed ? [] : node.children;
    const ys = kids.map(k => place(k, depth + 1));
    const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : row++ * (MM_H + MM_GAPY);
    pos.set(node.id, { x: depth * (MM_W + MM_GAPX), y });
    return y;
  };
  if (tree) place(tree, 0);
  return pos;
}

function mmPositions(tree) {
  const auto = mmLayout(tree);
  const pos = new Map();
  const edges = [];
  const walk = (node, parent) => {
    const p = byId(node.id);
    pos.set(node.id, p.mm ? { ...p.mm } : auto.get(node.id));
    if (parent) edges.push([parent.id, node.id]);
    if (!p.collapsed) node.children.forEach(c => walk(c, node));
  };
  if (tree) walk(tree, null);
  return { pos, edges };
}

function applyMmView() {
  const c = document.querySelector('.mm-canvas');
  if (c) c.style.transform = `translate(${mmView.x}px, ${mmView.y}px) scale(${mmView.k})`;
  const z = document.getElementById('mm-fit');
  if (z) z.textContent = `${Math.round(mmView.k * 100)}%`;
}

// Fit all visible nodes in the view.
function mmFit() {
  const box = document.querySelector('.mm-view');
  if (!box || !mmLast.pos.size) return;
  const xs = [...mmLast.pos.values()].map(p => p.x), ys = [...mmLast.pos.values()].map(p => p.y);
  const w = Math.max(...xs) + MM_W - Math.min(...xs), h = Math.max(...ys) + MM_H - Math.min(...ys);
  const k = Math.max(0.3, Math.min(1.2, Math.min((box.clientWidth - 80) / w, (box.clientHeight - 80) / h)));
  mmView = { k, x: (box.clientWidth - w * k) / 2 - Math.min(...xs) * k, y: (box.clientHeight - h * k) / 2 - Math.min(...ys) * k };
  applyMmView();
}

function mmZoomAt(factor, cx, cy) {
  const k0 = mmView.k, k1 = Math.min(2.5, Math.max(0.3, k0 * factor));
  mmView.x = cx - (cx - mmView.x) * (k1 / k0);
  mmView.y = cy - (cy - mmView.y) * (k1 / k0);
  mmView.k = k1;
  applyMmView();
}

function mmSelect(id) { mmSel = id; renderMindmap(); }

function mmAddChild(parentId) {
  const id = uid();
  data.pages.push({ id, title: '', parentId, blocks: [{ id: uid(), type: 'text', text: '' }] });
  byId(parentId).collapsed = false;
  save();
  mmSel = id;
  renderMindmap();
  mmRename(id, true);
}

function mmAddSibling(id) {
  const parent = byId(id).parentId;
  if (!parent) return mmAddChild(id);
  mmAddChild(parent);
}

function mmRename(id, fresh = false) {
  const el = document.querySelector(`.mm-node[data-id="${id}"] .mm-title`);
  if (!el) return;
  const old = byId(id).title;
  el.contentEditable = 'plaintext-only';
  if (fresh) el.textContent = '';
  el.focus();
  if (!fresh) getSelection().selectAllChildren(el);
  const done = commit => {
    el.contentEditable = 'false';
    if (commit && byId(id)) byId(id).title = el.textContent.trim();
    else if (byId(id)) el.textContent = old;
    save();
    renderSidebar();
    renderMindmap();
  };
  el.onkeydown = e => {
    e.stopPropagation(); // keep Enter/Escape from reaching the mindmap's own key handler
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); done(false); }
  };
  el.onblur = () => { if (el.isContentEditable) done(true); };
}

function mmSetColor(id, color) {
  byId(id).mmColor = color;
  save();
  renderMindmap();
}

function mmAutoLayout() {
  for (const p of data.pages) if (isDescendant(p.id, current.id) || p.id === current.id) delete p.mm;
  save();
  renderMindmap();
}

function mmToolbar() {
  const bar = document.createElement('div');
  bar.className = 'mm-tools';
  const sel = mmSel && byId(mmSel) ? mmSel : null;
  const b = (label, fn, extra) => button(label, fn, extra);
  bar.append(
    b('+ Child', () => sel && mmAddChild(sel), { id: 'mm-add' }),
    b('+ Sibling', () => sel && mmAddSibling(sel), { id: 'mm-sib' }),
    b('Rename', () => sel && mmRename(sel), { id: 'mm-rename' }),
    b('Open', () => sel && openPage(sel), { id: 'mm-open' }),
    b('Delete', () => sel && deleteNode(sel), { id: 'mm-del' }),
  );
  for (const c of MM_COLORS) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'mm-sw';
    sw.style.background = c;
    sw.title = 'Node colour';
    sw.onclick = () => sel && mmSetColor(sel, c);
    bar.append(sw);
  }
  bar.append(
    b('Auto layout', mmAutoLayout, { id: 'mm-auto' }),
    b('−', () => mmZoomAt(1 / 1.2, document.querySelector('.mm-view').clientWidth / 2, document.querySelector('.mm-view').clientHeight / 2), { id: 'mm-out' }),
    b('100%', mmFit, { id: 'mm-fit' }),
    b('+', () => mmZoomAt(1.2, document.querySelector('.mm-view').clientWidth / 2, document.querySelector('.mm-view').clientHeight / 2), { id: 'mm-in' }),
  );
  return bar;
}

function renderMindmap() {
  const box = $('#mindmap');
  box.innerHTML = '';
  const tree = mindmapTree(data.pages, current.id);
  if (mmShownFor !== current.id) { mmShownFor = current.id; mmSel = null; mmView = { x: 40, y: 40, k: 1 }; }
  mmLast = mmPositions(tree);
  box.append(mmToolbar());

  const view = document.createElement('div');
  view.className = 'mm-view';
  const canvas = document.createElement('div');
  canvas.className = 'mm-canvas';
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'mm-lines');
  for (const [a, b] of mmLast.edges) {
    const p1 = mmLast.pos.get(a), p2 = mmLast.pos.get(b);
    if (!p1 || !p2) continue;
    const x1 = p1.x + MM_W, y1 = p1.y + MM_H / 2, x2 = p2.x, y2 = p2.y + MM_H / 2, mid = (x2 - x1) / 2;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', `M${x1} ${y1} C${x1 + mid} ${y1} ${x2 - mid} ${y2} ${x2} ${y2}`);
    svg.append(path);
  }
  canvas.append(svg);

  for (const [id, p] of mmLast.pos) {
    const page = byId(id);
    const node = document.createElement('div');
    node.className = 'mm-node' + (id === mmSel ? ' sel' : '') + (id === current.id ? ' root' : '');
    node.dataset.id = id;
    node.style.left = `${p.x}px`;
    node.style.top = `${p.y}px`;
    node.style.borderLeftColor = page.mmColor || 'var(--line)';
    const title = document.createElement('span');
    title.className = 'mm-title';
    title.textContent = page.title || 'Untitled';
    node.append(title);
    const kids = byId(id) && data.pages.filter(c => c.parentId === id).length;
    if (kids) {
      const t = button(page.collapsed ? `▸ ${kids}` : '▾', () => { page.collapsed = !page.collapsed; save(); renderMindmap(); });
      t.className = 'mm-count';
      t.onpointerdown = e => e.stopPropagation();
      node.append(t);
    }
    node.onpointerdown = e => {
      if (e.button !== 0 || title.isContentEditable) return;
      e.stopPropagation();
      mmSel = id;
      mmDrag = { type: 'node', id, px: e.clientX, py: e.clientY, x: p.x, y: p.y, moved: false };
      node.classList.add('sel');
    };
    node.ondblclick = () => openPage(id);
    canvas.append(node);
  }
  view.append(canvas);
  box.append(view);
  view.addEventListener('pointerdown', e => {
    if (e.target !== view && e.target !== canvas && e.target !== svg) return;
    mmSel = null;
    mmDrag = { type: 'pan', px: e.clientX, py: e.clientY, vx: mmView.x, vy: mmView.y };
    view.classList.add('panning');
    renderMindmap();
  });
  view.addEventListener('wheel', e => {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    mmZoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  applyMmView();
  if (mmView.x === 40 && mmView.y === 40 && mmView.k === 1 && mmLast.pos.size > 1) mmFit();
}

// Drag and pan are tracked on the window so the pointer can leave a node.
window.addEventListener('pointermove', e => {
  if (!mmDrag) return;
  if (mmDrag.type === 'pan') {
    mmView.x = mmDrag.vx + (e.clientX - mmDrag.px);
    mmView.y = mmDrag.vy + (e.clientY - mmDrag.py);
    return applyMmView();
  }
  const dx = (e.clientX - mmDrag.px) / mmView.k, dy = (e.clientY - mmDrag.py) / mmView.k;
  if (!mmDrag.moved && Math.hypot(dx, dy) < 4) return;
  mmDrag.moved = true;
  byId(mmDrag.id).mm = { x: mmDrag.x + dx, y: mmDrag.y + dy };
  const node = document.querySelector(`.mm-node[data-id="${mmDrag.id}"]`);
  if (node) { node.style.left = `${mmDrag.x + dx}px`; node.style.top = `${mmDrag.y + dy}px`; }
  mmLast.pos.set(mmDrag.id, { ...byId(mmDrag.id).mm });
  renderLinesOnly();
});
window.addEventListener('pointerup', () => {
  if (!mmDrag) return;
  const was = mmDrag;
  mmDrag = null;
  document.querySelector('.mm-view')?.classList.remove('panning');
  if (was.type === 'node' && was.moved) save();
  if (was.type === 'node' && !was.moved) renderMindmap();
});

// Redraws connector lines only, while a node is being dragged.
function renderLinesOnly() {
  const svg = document.querySelector('.mm-lines');
  if (!svg) return;
  svg.innerHTML = '';
  const svgNS = 'http://www.w3.org/2000/svg';
  for (const [a, b] of mmLast.edges) {
    const p1 = mmLast.pos.get(a), p2 = mmLast.pos.get(b);
    if (!p1 || !p2) continue;
    const x1 = p1.x + MM_W, y1 = p1.y + MM_H / 2, x2 = p2.x, y2 = p2.y + MM_H / 2, mid = (x2 - x1) / 2;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', `M${x1} ${y1} C${x1 + mid} ${y1} ${x2 - mid} ${y2} ${x2} ${y2}`);
    svg.append(path);
  }
}

// Keyboard editing on the mindmap: Tab child, Enter sibling, F2 rename, Delete remove.
document.addEventListener('keydown', e => {
  if (mode !== 'mindmap' || !mmSel || !byId(mmSel)) return;
  const t = e.target;
  if (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
  if (e.key === 'Tab') { e.preventDefault(); mmAddChild(mmSel); }
  else if (e.key === 'Enter') { e.preventDefault(); mmAddSibling(mmSel); }
  else if (e.key === 'F2') { e.preventDefault(); mmRename(mmSel); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteNode(mmSel); }
});
/* Search modal (in-window, like Notion's openSearchModalInNotion) */

const backdrop = $('#backdrop');
const hideSearch = () => backdrop.classList.remove('visible');
const searchUi = mountSearch({
  input: $('#q'), list: $('#results'), label: $('#label'),
  getPages: () => [...data.pages, ...commandItems()],
  getRecent: () => data.recent.map(byId).filter(Boolean),
  onOpen: p => { hideSearch(); if (p.kind === 'command') p.run(); else openPage(p.id); },
  onClose: hideSearch,
});
function toggleSearch() {
  if (backdrop.classList.toggle('visible')) searchUi.reset();
}
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'k' || e.key === 'p')) { e.preventDefault(); toggleSearch(); }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'n') { e.preventDefault(); createPage(null); }
});
backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) hideSearch(); });
$('#search-btn').onclick = toggleSearch;

/* Small form dialog (Electron does not support window.prompt) */
function askForm(title, fields) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'backdrop visible';
    const form = document.createElement('form');
    form.className = 'panel form';
    const h = document.createElement('h2');
    h.textContent = title;
    form.append(h);
    const inputs = {};
    for (const f of fields) {
      const label = document.createElement('label');
      label.textContent = f.label;
      const el = f.type === 'select' ? document.createElement('select') : document.createElement('input');
      if (f.type === 'select') f.options.forEach(o => el.append(typeof o === 'string' ? new Option(o, o) : new Option(o.label, o.value)));
      else el.type = 'text';
      el.name = f.name;
      if (f.value != null) el.value = f.value;
      inputs[f.name] = el;
      label.append(el);
      form.append(label);
    }
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.textContent = 'OK';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const done = value => { wrap.remove(); resolve(value); };
    cancel.onclick = () => done(null);
    wrap.onmousedown = e => { if (e.target === wrap) done(null); };
    form.onkeydown = e => { if (e.key === 'Escape') done(null); };
    form.onsubmit = e => {
      e.preventDefault();
      done(Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])));
    };
    form.append(ok, cancel);
    wrap.append(form);
    document.body.append(wrap);
    Object.values(inputs)[0].focus();
  });
}

/* Sidebar actions */

$('#title').addEventListener('input', e => { current.title = e.target.textContent; renderSidebar(); save(); });
$('#title').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !isDb(current)) { e.preventDefault(); renderBlocks(current.blocks[0]?.id); }
});
$('#new-btn').onclick = () => createPage(null);
$('#new-db-btn').onclick = createDatabase;
$('#cal-btn').onclick = openCalendar;
$('#team-btn').onclick = openTeam;
$('#templates-btn').onclick = () => FolioPicker.open(createTemplatePage);
$('#theme-btn').onclick = () => FolioAppearance.open(() => data.appearance, a => { data.appearance = a; applyTheme(); save(); });

// Each imported file becomes a top-level page.
function addImportedPages(files) {
  const failed = [];
  let last;
  for (const f of files) {
    if (f.error) { failed.push(`${f.name}: ${f.error}`); continue; }
    const { title, blocks } = f.html != null ? htmlToBlocks(f.html) : f;
    last = { id: uid(), title: title || f.name, parentId: null, blocks: blocks.length ? blocks : [{ id: uid(), type: 'text', text: '' }] };
    data.pages.push(last);
  }
  if (last) openPage(last.id);
  if (failed.length) alert(`Could not import:\n${failed.join('\n')}`);
}
$('#import-btn').onclick = async () => addImportedPages(await api.importFiles());

$('#notion-btn').onclick = async () => {
  const r = await api.importNotion();
  if (!r) return;
  if (r.error) return alert(`Could not import: ${r.error}`);
  data.pages.push(...r.pages);
  save();
  api.save(data);
  const top = r.pages.find(p => !p.parentId);
  openPage(top?.id);
  alert(`Imported ${r.pages.length} items (${r.databases} databases, ${r.rows} rows).` +
    (r.skipped.length ? `\nSkipped ${r.skipped.length} unsupported file(s).` : ''));
};

$('#star-btn').onclick = toggleStar;
api.on('search:open', toggleSearch);
api.on('page:open', id => (data ? openPage(id) : (pendingPageId = id)));
api.on('page:new', () => createPage(null));

if (api.isMac) {
  document.documentElement.classList.add('mac');
  const sub = document.querySelector('.ws-storage-note') || document.querySelector('.ws-sub');
  if (sub && sub.textContent.includes('PC')) sub.textContent = sub.textContent.replace('PC', 'Mac');
  document.querySelectorAll('kbd').forEach(k => {
    k.textContent = k.textContent.replace(/Ctrl/g, '⌘');
  });
}

(async () => {
  data = await api.load();
  applyTheme();
  openPage(pendingPageId || data.recent[0] || data.pages[0]?.id);
})();

// Workspace switcher: the sidebar header shows the active workspace and goes back to the start page.
api.activeWorkspaceName().then(name => { document.querySelector('.ws-name').textContent = name; });
document.querySelector('.ws').addEventListener('click', async e => {
  if (e.target.closest('#theme-btn')) return;
  await api.save(data);
  await api.backToStart();
});
document.querySelector('.ws').title = 'Switch workspace';
