const $ = s => document.querySelector(s);

function ago(ts) {
  if (!ts) return 'Never opened';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'Opened just now';
  if (s < 3600) return `Opened ${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `Opened ${Math.floor(s / 3600)} h ago`;
  return `Opened ${Math.floor(s / 86400)} d ago`;
}

async function openWorkspace(id) {
  const r = await api.openWorkspace(id);
  if (r.error) showError(r.error);
}

function showError(text) {
  const e = $('#new-error');
  e.textContent = text;
  e.hidden = false;
}

async function render() {
  const { workspaces, active } = await api.listWorkspaces();
  const grid = $('#ws-grid');
  grid.innerHTML = '';
  // Most recently opened first; never-opened workspaces last, in creation order.
  const sorted = [...workspaces].sort((a, b) => (b.opened || 0) - (a.opened || 0) || a.created - b.created);
  for (const w of sorted) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'ws-card' + (w.id === active ? ' current' : '');
    const mark = document.createElement('span');
    mark.className = 'ws-card-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = (w.name.trim()[0] || 'W').toUpperCase();
    const text = document.createElement('span');
    text.className = 'ws-card-text';
    const name = document.createElement('span');
    name.className = 'ws-card-name';
    name.textContent = w.name;
    const meta = document.createElement('span');
    meta.className = 'muted small';
    meta.textContent = w.id === active ? (w.opened ? `Last used · ${ago(w.opened)}` : 'Last used') : ago(w.opened);
    text.append(name, meta);
    const go = document.createElement('span');
    go.className = 'ws-card-go';
    go.setAttribute('aria-hidden', 'true');
    go.textContent = 'Open →';
    card.append(mark, text, go);
    card.onclick = () => openWorkspace(w.id);
    grid.append(card);
  }
}

$('#new-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#new-name').value.trim();
  if (!name) return showError('Give the workspace a name.');
  const r = await api.createWorkspace(name, $('#new-template').value);
  if (r.error) return showError(r.error);
  await openWorkspace(r.id);
});

render();
// Window buttons match the start page background.
{ const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim(); api.setTitleBar?.(css('--bg'), css('--muted')); }
