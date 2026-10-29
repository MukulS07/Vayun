// Vayun on Android: The mobile bridge exposing window.api
// 100% compatible with desktop/app screens and web-api, with Android-native integration
(function () {
  const DB_NAME = 'vayun-android';
  const STORE = 'kv';
  const nowDefaults = () => ({ active: 'main', workspaces: [{ id: 'main', name: 'My workspace', created: Date.now(), opened: 0 }] });

  // ---- Key-Value Store on IndexedDB (Local-First Persistence) ----
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

  // ---- Workspaces Registry ----
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
    d.pages = Array.isArray(d.pages) ? d.pages.map(p => (p.kind ? p : { ...p, kind: undefined })) : [];
    return d;
  };

  const welcome = () => migrate({
    version: 2, theme: 'dark', recent: [],
    pages: [{ id: 'welcome', title: 'Welcome to Vayun', parentId: null, blocks: [
      { id: 'w1', type: 'h1', text: '🍃 Vayun on Mobile' },
      { id: 'w2', type: 'text', text: '100% private, offline-ready, and stored directly on your phone.' },
      { id: 'w3', type: 'todo', text: 'Tap any line to edit or create blocks', checked: true },
      { id: 'w4', type: 'todo', text: 'Use the bottom navigation bar to switch between Home, Calendar and Notes', checked: false },
      { id: 'w5', type: 'text', text: 'Start a line with "# ", "## ", "- " or "[] " for headings, lists and tasks.' },
    ] }],
  });

  let current = null;
  let writing = false, queued = null;
  async function flush() {
    if (writing) return;
    writing = true;
    try { while (queued) { const job = queued; queued = null; await kvSet(job.key, job.value); } } finally { writing = false; }
  }
  const validPages = next => Array.isArray(next?.pages) && Array.isArray(next?.recent) && !next.pages.some(p => !p || typeof p.id !== 'string' || !Array.isArray(p.blocks));

  // ---- Events & Handlers ----
  const listeners = {};
  const emit = (channel, ...args) => (listeners[channel] || []).forEach(fn => { try { fn(...args); } catch (e) { console.error(e); } });

  // Android Native Back Button Handler
  window.handleAndroidBackPressed = function () {
    const sidebar = document.querySelector('.side, .sidebar');
    const backdrop = document.querySelector('.sidebar-backdrop');
    if (sidebar && sidebar.classList.contains('mobile-open')) {
      sidebar.classList.remove('mobile-open');
      if (backdrop) backdrop.classList.remove('active');
      return true;
    }
    const modal = document.querySelector('.modal, .dialog, .picker, .slash-menu');
    if (modal && !modal.hidden) {
      modal.hidden = true;
      return true;
    }
    return false;
  };

  function haptic() {
    if (window.VayunAndroid && typeof window.VayunAndroid.hapticFeedback === 'function') {
      window.VayunAndroid.hapticFeedback();
    } else if (navigator.vibrate) {
      navigator.vibrate(12);
    }
  }

  function download(name, ext, content) {
    const clean = String(name).replace(/[\\/:*?"<>|]/g, '_') || 'Untitled';
    const file = `${clean}.${ext}`;
    if (window.VayunAndroid && typeof window.VayunAndroid.shareText === 'function') {
      window.VayunAndroid.shareText(file, content);
      return file;
    }
    const type = { md: 'text/markdown', html: 'text/html', csv: 'text/csv', json: 'application/json' }[ext] || 'text/plain';
    const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
    const a = Object.assign(document.createElement('a'), { href: url, download: file });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return file;
  }

  const desktopOnly = what => ({ error: `${what} works in the Vayun desktop app for now.` });
  const signedOut = () => ({ isConfigured: false, missing: [], user: null, canSync: false, config: { projectId: '', authDomain: '' } });
  const noTeam = () => ({ signedIn: false, canSync: false, teams: [], team: null, role: null, tasks: [], events: [], uid: '', syncedAt: null, error: null });

  const base = {
    platform: 'android',
    isMac: false,
    isWeb: true, // enables web-compatible fallbacks in shared scripts
    isAndroid: true,
    load: async () => {
      await ready;
      let d = await kvGet('ws:' + activeEntry().id);
      d = d && Array.isArray(d.pages) ? migrate(d) : welcome();
      current = d;
      return d;
    },
    save: next => {
      if (!validPages(next)) return false;
      current = next;
      queued = { key: 'ws:' + activeEntry().id, value: next };
      flush();
      return true;
    },
    openFromQuickSearch: () => {},
    closeQuickSearch: () => {},
    importFiles: async () => [],
    importNotion: async () => desktopOnly('Notion import'),
    listWorkspaces: async () => {
      await ready;
      return {
        active: registry.active,
        workspaces: registry.workspaces.map(w => ({
          id: w.id,
          name: w.name,
          created: w.created,
          opened: w.opened
        }))
      };
    },
    activeWorkspaceName: async () => {
      await ready;
      return activeEntry().name;
    },
    createWorkspace: async (name, template) => {
      await ready;
      const clean = String(name || '').trim().slice(0, 60);
      if (!clean) return { error: 'Give the workspace a name.' };
      const id = 'w' + uid8();
      registry.workspaces.push({ id, name: clean, created: Date.now(), opened: Date.now() });
      registry.active = id;
      const data = welcome();
      data.pages[0].title = clean;
      data.pages[0].blocks[0].text = `🍃 ${clean}`;
      await kvSet('ws:' + id, data);
      await saveRegistry();
      return { id };
    },
    openWorkspace: async id => {
      await ready;
      const entry = registry.workspaces.find(w => w.id === id);
      if (!entry) return { error: 'Workspace not found.' };
      registry.active = id;
      entry.opened = Date.now();
      await saveRegistry();
      location.href = 'index.html';
      return { ok: true };
    },
    backToStart: async () => {
      location.href = 'start.html';
      return true;
    },
    exportFile: async (name, ext, content) => download(name, ext, content),
    aiStatus: async () => ({ hasKey: false, model: '', models: [], unavailable: true }),
    aiSetKey: async () => desktopOnly('The assistant'),
    aiClearKey: async () => ({ hasKey: false, model: '', models: [], unavailable: true }),
    aiChat: async () => desktopOnly('The assistant'),
    authStatus: async () => signedOut(),
    authSignIn: async () => ({ error: 'Sign-in is not configured yet.' }),
    authSignOut: async () => ({ ok: true }),
    authSetConfig: async () => ({ error: 'Not used on mobile.' }),
    authClearConfig: async () => ({ ok: true }),
    gcalStatus: async () => ({ isConfigured: false, connected: false, email: '' }),
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
    startDictation: async () => ({ error: 'Use your phone keyboard microphone for voice typing.' }),
    setTitleBar: (color, symbolColor) => {
      if (window.VayunAndroid && typeof window.VayunAndroid.setStatusBarColor === 'function') {
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        window.VayunAndroid.setStatusBarColor(color || '#161616', isDark);
      }
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'theme-color';
        document.head.appendChild(meta);
      }
      meta.content = color || '#161616';
    },
    on: (channel, fn) => {
      listeners[channel] = listeners[channel] || [];
      listeners[channel].push(fn);
    },
  };

  // Expose both namespaces so cloud plugins and mobile tools find their methods
  window.api = base;
  window.__vayunWeb = { emit, kvGet, kvSet, ready };
  window.__vayunAndroid = { emit, haptic, kvGet, kvSet, ready };
  addEventListener('pagehide', () => { if (queued) flush(); });
})();
