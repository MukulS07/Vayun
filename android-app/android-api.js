// Vayun on Android: Phase 3 Mobile Bridge exposing window.api
// 100% compatible with desktop/app screens and web-api, with Android-native integration
(function () {
  const DB_NAME = 'vayun-android';
  const STORE = 'kv';
  const nowDefaults = () => ({ active: 'main', workspaces: [{ id: 'main', name: 'My workspace', created: Date.now(), opened: 0 }] });

  // ---- Key-Value Store on IndexedDB (Local-First Persistence with Fail-Safe Fallbacks) ----
  let dbPromise = null;
  const memory = new Map();

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(resolve => {
        try {
          if (typeof indexedDB === 'undefined') return resolve(null);
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
    try {
      const d = await db();
      if (!d) {
        try {
          const raw = localStorage.getItem('vayun:' + key);
          return raw ? JSON.parse(raw) : memory.get(key);
        } catch { return memory.get(key); }
      }
      return new Promise(resolve => {
        const tx = d.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(undefined);
      });
    } catch {
      return memory.get(key);
    }
  }

  async function kvSet(key, value) {
    try {
      const d = await db();
      if (!d) {
        memory.set(key, value);
        try { localStorage.setItem('vayun:' + key, JSON.stringify(value)); } catch {}
        return true;
      }
      return new Promise(resolve => {
        const tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
      });
    } catch {
      memory.set(key, value);
      return true;
    }
  }

  // ---- Workspaces Registry ----
  let registry = null;
  const ready = (async () => {
    const r = await kvGet('registry');
    registry = r && Array.isArray(r.workspaces) && r.workspaces.length ? r : nowDefaults();
  })();
  const activeEntry = () => registry.workspaces.find(w => w.id === registry.active) || registry.workspaces[0];
  const saveRegistry = () => kvSet('registry', registry);
  const uid8 = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));

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
    // 1. Close slide-over navigation drawer if open
    const sidebar = document.querySelector('.side, .sidebar');
    const sideBackdrop = document.querySelector('.sidebar-backdrop');
    if (sidebar && sidebar.classList.contains('mobile-open')) {
      sidebar.classList.remove('mobile-open');
      if (sideBackdrop) sideBackdrop.classList.remove('active');
      return true;
    }

    // 2. Dismiss any active modal backdrops (Calendar event form, Search, Settings, Ask dialog)
    const backdrops = Array.from(document.querySelectorAll('.backdrop.visible, .modal.visible, .dialog.visible, .settings-backdrop.visible'));
    if (backdrops.length > 0) {
      const topBackdrop = backdrops[backdrops.length - 1];
      if (topBackdrop.id === 'backdrop') {
        topBackdrop.classList.remove('visible');
      } else {
        const escEvent = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
        topBackdrop.dispatchEvent(escEvent);
        if (topBackdrop.parentNode) topBackdrop.remove();
      }
      return true;
    }

    // 3. Close popovers, slash menus, or pickers
    const popovers = document.querySelectorAll('.slash, .picker, .popover, .menu-dropdown');
    for (const p of popovers) {
      if (p.offsetParent !== null) {
        p.remove();
        return true;
      }
    }

    // 4. In-page navigation: if not on Home screen, go back to Home
    const isHome = document.querySelector('.homepage') !== null;
    const homeBtn = document.getElementById('home-btn') || document.querySelector('.mobile-tab-btn[data-target="home"]');
    if (!isHome && homeBtn) {
      homeBtn.click();
      return true;
    }

    return false; // let Android exit or go back in system stack
  };

  function haptic() {
    if (window.VayunAndroid && typeof window.VayunAndroid.hapticFeedback === 'function') {
      window.VayunAndroid.hapticFeedback();
    } else if (navigator.vibrate) {
      navigator.vibrate(14);
    }
  }

  function download(name, ext, content) {
    const clean = String(name).replace(/[\\/:*?"<>|]/g, '_') || 'Untitled';
    const file = `${clean}.${ext}`;
    const type = { md: 'text/markdown', html: 'text/html', csv: 'text/csv', json: 'application/json' }[ext] || 'text/plain';
    if (window.VayunAndroid && typeof window.VayunAndroid.shareFile === 'function') {
      window.VayunAndroid.shareFile(file, content, type);
      return file;
    }
    if (window.VayunAndroid && typeof window.VayunAndroid.shareText === 'function') {
      window.VayunAndroid.shareText(file, content);
      return file;
    }
    const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
    const a = Object.assign(document.createElement('a'), { href: url, download: file });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return file;
  }

  const desktopOnly = what => ({ error: `${what} works in the Vayun desktop app for now.` });
  const hasCfg = () => Boolean(window.VAYUN_WEB_CONFIG && window.VAYUN_WEB_CONFIG.apiKey);
  const signedOut = () => ({ isConfigured: hasCfg(), missing: [], user: null, canSync: false, config: { projectId: window.VAYUN_WEB_CONFIG?.projectId || '', authDomain: window.VAYUN_WEB_CONFIG?.authDomain || '' } });
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
    importFiles: async () => {
      return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.html,.htm,.md,.markdown,.txt,.json';
        input.onchange = async () => {
          const files = Array.from(input.files || []);
          const results = [];
          for (const file of files) {
            try {
              const text = await file.text();
              const baseName = file.name.replace(/\.[^/.]+$/, '');
              if (/\.json$/i.test(file.name)) {
                try {
                  const parsed = JSON.parse(text);
                  if (parsed.blocks && Array.isArray(parsed.blocks)) {
                    results.push({ name: baseName, title: parsed.title || baseName, blocks: parsed.blocks });
                  } else {
                    results.push({ name: baseName, html: `<p>${text.replace(/[<>&]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[s])}</p>` });
                  }
                } catch {
                  results.push({ name: baseName, html: `<p>${text}</p>` });
                }
              } else if (/\.(html|htm)$/i.test(file.name)) {
                results.push({ name: baseName, html: text });
              } else {
                // Plain text or Markdown: wrap in paragraphs for htmlToBlocks
                const lines = text.split(/\r?\n/).map(line => `<p>${line.replace(/[<>&]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[s]) || '<br>'}</p>`).join('');
                results.push({ name: baseName, html: lines });
              }
            } catch (err) {
              results.push({ name: file.name, error: err.message });
            }
          }
          resolve(results);
        };
        input.oncancel = () => resolve([]);
        input.click();
      });
    },
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
    exportWorkspaceBackup: async () => {
      await ready;
      const ws = activeEntry();
      const data = current || await kvGet('ws:' + ws.id) || welcome();
      const date = new Date().toISOString().slice(0, 10);
      const fileName = `${ws.name.replace(/[^\w-]/g, '_')}-backup-${date}`;
      return download(fileName, 'json', JSON.stringify(data, null, 2));
    },
    shareCurrentNote: async () => {
      const titleEl = document.querySelector('.title, #title, .page-title');
      const title = (titleEl ? (titleEl.value || titleEl.textContent) : '').trim() || 'Note';
      const blockEls = Array.from(document.querySelectorAll('.block .text, .block .content, #blocks [contenteditable]'));
      const textLines = blockEls.map(el => (el.value || el.innerText || '').trim()).filter(Boolean);
      const content = `${title}\n\n${textLines.join('\n\n')}`;

      if (window.VayunAndroid && typeof window.VayunAndroid.shareText === 'function') {
        window.VayunAndroid.shareText(title, content);
      } else if (navigator.share) {
        try {
          await navigator.share({ title, text: content });
        } catch { /* cancelled */ }
      } else {
        download(title, 'md', content);
      }
    },
    copyToClipboard: async (text) => {
      if (window.VayunAndroid && typeof window.VayunAndroid.copyToClipboard === 'function') {
        window.VayunAndroid.copyToClipboard(text);
        return true;
      }
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch { /* fallback */ }
      }
      return false;
    },
    isOnline: () => {
      if (window.VayunAndroid && typeof window.VayunAndroid.isNetworkAvailable === 'function') {
        return window.VayunAndroid.isNetworkAvailable();
      }
      return navigator.onLine;
    },
    getAppVersion: () => {
      if (window.VayunAndroid && typeof window.VayunAndroid.getAppVersion === 'function') {
        return window.VayunAndroid.getAppVersion();
      }
      return '1.0.0';
    },
    aiStatus: async () => ({ hasKey: false, model: '', models: [], unavailable: true }),
    aiSetKey: async () => desktopOnly('The assistant'),
    aiClearKey: async () => ({ hasKey: false, model: '', models: [], unavailable: true }),
    aiChat: async () => desktopOnly('The assistant'),
    authStatus: async () => signedOut(),
    authSignIn: async () => ({ error: 'Sign-in is not configured yet.' }),
    authSignOut: async () => ({ ok: true }),
    authSetConfig: async () => ({ error: 'Not used on mobile.' }),
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
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && queued) flush(); });
})();
