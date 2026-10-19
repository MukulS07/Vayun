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
    const name = document.createElement('div');
    name.className = 'ws-card-name';
    name.textContent = w.name;
    const meta = document.createElement('div');
    meta.className = 'muted small';
    meta.textContent = w.id === active ? `${ago(w.opened)} · last used` : ago(w.opened);
    card.append(name, meta);
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
