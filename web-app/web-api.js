// Vayun on the web: the same screens as the desktop app, with `window.api` rebuilt for a browser.
// On the desktop, preload.js gives the page an `api` that talks to the main process. Here this file gives it the same
// functions, backed by the browser: workspaces in IndexedDB, files saved by download, and "not in the browser yet"
// answers for the few things that need the desktop app. The screens (app/*.js) are the very same files.
(function () {
  const DB_NAME = 'vayun-web';
  const STORE = 'kv';
  const nowDefaults = () => ({ active: 'main', workspaces: [{ id: 'main', name: 'My workspace', created: Date.now(), opened: 0 }] });

  // ---- a tiny key-value store on IndexedDB; falls back to memory when the browser blocks it (private windows) ----
  let dbPromise = null;
  const memory = new Map();
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(resolve => {
        try {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(STORE);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
    }
    return dbPromise;
  }
  async function kvGet(key) {
    const d = await db();
    if (!d) return memory.get(key);
    return new Promise(resolve => {
      const r = d.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    });
  }
  async function kvSet(key, value) {
    const d = await db();
    if (!d) { memory.set(key, value); return true; }
    return new Promise(resolve => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    });
  }

  // ---- workspaces ----
  let registry = null;
  const ready = (async () => {
    const r = await kvGet('registry');
    registry = r && Array.isArray(r.workspaces) && r.workspaces.length ? r : nowDefaults();
  })();
  const activeEntry = () => registry.workspaces.find(w => w.id === registry.active) || registry.workspaces[0];
  const saveRegistry = () => kvSet('registry', registry);
  const uid8 = () => crypto.randomUUID().slice(0, 8);

  const migrate = d => {
    d.version = 2;
    d.theme = ['system', 'light', 'dark'].includes(d.theme) ? d.theme : 'dark';
    d.pages = d.pages.map(p => (p.kind ? p : { ...p, kind: undefined }));
    return d;
  };
  const welcome = () => migrate({
    version: 2, theme: 'dark', recent: [],
    pages: [{ id: 'welcome', title: 'Welcome', parentId: null, blocks: [
      { id: 'w1', type: 'h1', text: 'Your pages' },
      { id: 'w2', type: 'text', text: 'Start a line with "# ", "## ", "- " or "[] " for headings, lists and to-dos.' },
      { id: 'w3', type: 'todo', text: 'Press Ctrl+K to search this workspace', checked: false },
      { id: 'w4', type: 'text', text: 'This is Vayun on the web. Your pages are kept in this browser; the desktop app keeps its own copy on your computer.' },
    ] }],
  });

  let current = null;
  // Saves are written one after another, and the newest copy always wins.
  let writing = false, queued = null;
  async function flush() {
    if (writing) return;
    writing = true;
    try { while (queued) { const job = queued; queued = null; await kvSet(job.key, job.value); } } finally { writing = false; }
  }
  const validPages = next => Array.isArray(next?.pages) && Array.isArray(next?.recent) && !next.pages.some(p => !p || typeof p.id !== 'string' || !Array.isArray(p.blocks));

  // ---- events the desktop main process would send ----
  const listeners = {};
  const emit = (channel, ...args) => (listeners[channel] || []).forEach(fn => { try { fn(...args); } catch (e) { console.error(e); } });

  // ---- downloads and file pickers ----
  function download(name, ext, content) {
    const clean = String(name).replace(/[\\/:*?"<>|]/g, '_') || 'Untitled';
    const file = `${clean}.${ext}`;
    const type = { md: 'text/markdown', html: 'text/html', csv: 'text/csv', json: 'application/json' }[ext] || 'text/plain';
    const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
    const a = Object.assign(document.createElement('a'), { href: url, download: file });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return file;
  }
  function pickFiles(accept, multiple) {
    return new Promise(resolve => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
      input.style.display = 'none';
      input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
      input.addEventListener('cancel', () => { resolve([]); input.remove(); });
      document.body.append(input); input.click();
    });
  }

  const desktopOnly = what => ({ error: `${what} works in the Vayun desktop app for now. Download it from the Vayun website.` });
  const hasCfg = () => Boolean(window.VAYUN_WEB_CONFIG && window.VAYUN_WEB_CONFIG.apiKey);
  const signedOut = () => ({ isConfigured: hasCfg(), missing: [], user: null, canSync: false, config: { projectId: window.VAYUN_WEB_CONFIG?.projectId || '', authDomain: window.VAYUN_WEB_CONFIG?.authDomain || '' } });
  const noTeam = () => ({ signedIn: false, canSync: false, teams: [], team: null, role: null, tasks: [], events: [], uid: '', syncedAt: null, error: null });

  const base = {
    platform: 'web',
    isMac: false, // no traffic-light space is reserved in a browser tab
    isWeb: true,
    load: async () => {
      await ready;
      let d = await kvGet('ws:' + activeEntry().id);
      d = d && Array.isArray(d.pages) ? migrate(d) : welcome();
      current = d;
      return d;
    },
    // The app saves from beforeunload too, so this answers at once and writes in the background.
    save: next => {
      if (!validPages(next)) return false;
      current = next;
      queued = { key: 'ws:' + activeEntry().id, value: next };
      flush();
      return true;
    },
    openFromQuickSearch: () => {},
    closeQuickSearch: () => {},
    importFiles: async () => {
      const files = await pickFiles('.html,.htm,.pdf', true);
      return Promise.all(files.map(async f => {
        const name = f.name.replace(/\.[^.]+$/, '');
        if (/\.pdf$/i.test(f.name)) return { name, error: 'PDF import works in the Vayun desktop app for now.' };
        try { return { name, html: await f.text() }; } catch (e) { return { name, error: e.message }; }
      }));
    },
    importNotion: async () => desktopOnly('Notion import'),
    listWorkspaces: async () => {
      await ready;
      return { active: registry.active, workspaces: registry.workspaces.map(w => ({ id: w.id, name: w.name, created: w.created, opened: w.opened })) };
    },
    activeWorkspaceName: async () => { await ready; return activeEntry().name; },
    createWorkspace: async (name, template) => {
      await ready;
      const clean = String(name || '').trim().slice(0, 60);
      if (!clean) return { error: 'Give the workspace a name.' };
      const id = 'w' + uid8();
      registry.workspaces.push({ id, name: clean, created: Date.now(), opened: 0 });
      registry.active = id;
      const data = { version: 2, theme: 'dark', pages: [], recent: [] };
      if (template === 'tasks' && typeof makeDatabase === 'function') data.pages.push(makeDatabase(uid8(), 'Tasks'));
      await kvSet('ws:' + id, data);
      await saveRegistry();
      return { id };
    },
    openWorkspace: async id => {
      await ready;
      const entry = registry.workspaces.find(w => w.id === id);
      if (!entry) return { error: 'Workspace not found.' };
      registry.active = id; entry.opened = Date.now();
      await saveRegistry();
      location.href = 'index.html';
      return { ok: true };
    },
    backToStart: async () => { location.href = 'start.html'; return true; },
    exportFile: async (name, ext, content) => download(name, ext, content),
    // The assistant keeps its API key in the desktop app's encrypted storage; the browser has no such place.
    aiStatus: async () => ({ hasKey: false, model: '', models: [], unavailable: true }),
    aiSetKey: async () => desktopOnly('The assistant'),
    aiClearKey: async () => ({ hasKey: false, model: '', models: [], unavailable: true }),
    aiChat: async () => desktopOnly('The assistant'),
    // Sign-in, calendar and teams: replaced by web-cloud.js when it is loaded (Firebase in the browser).
    authStatus: async () => signedOut(),
    authSignIn: async () => ({ error: 'Sign-in is not available in this build.' }),
    authSignOut: async () => ({ ok: true }),
    authSetConfig: async () => ({ error: 'Not used on the web.' }),
    authClearConfig: async () => ({ ok: true }),
    gcalStatus: async () => ({ isConfigured: hasCfg(), connected: false, email: '' }),
    gcalConnect: async () => desktopOnly('Google Calendar'),
    gcalDisconnect: async () => ({ ok: true }),
    gcalList: async () => desktopOnly('Google Calendar'),
    gcalCreate: async () => desktopOnly('Google Calendar'),
    gcalUpdate: async () => desktopOnly('Google Calendar'),
    gcalDelete: async () => desktopOnly('Google Calendar'),
    gcalOpen: link => { try { const u = new URL(link); if (/^https:$/.test(u.protocol)) window.open(u.href, '_blank', 'noopener'); } catch { /* ignore */ } },
    teamState: async () => noTeam(),
    teamRefresh: async () => noTeam(),
    teamCreate: async () => desktopOnly('Teams'),
    teamJoin: async () => desktopOnly('Teams'),
    teamSelect: async () => desktopOnly('Teams'),
    teamLeave: async () => desktopOnly('Teams'),
    teamRotateInvite: async () => desktopOnly('Teams'),
    teamRemoveMember: async () => desktopOnly('Teams'),
    teamSetRole: async () => desktopOnly('Teams'),
    teamCreateTask: async () => desktopOnly('Teams'),
    teamUpdateTask: async () => desktopOnly('Teams'),
    teamCreateEvent: async () => desktopOnly('Teams'),
    teamUpdateEvent: async () => desktopOnly('Teams'),
    teamDeleteEvent: async () => desktopOnly('Teams'),
    startDictation: async () => ({ error: 'Use your browser or keyboard for voice typing.' }),
    setTitleBar: () => {},
    on: (channel, fn) => { (listeners[channel] = listeners[channel] || []).push(fn); },
  };

  // Plug-ins (web-cloud.js) replace the cloud parts; they get `emit` to tell the screens something changed.
  window.api = base;
  window.__vayunWeb = { emit, kvGet, kvSet, ready };
  addEventListener('pagehide', () => { if (queued) flush(); });
})();
