const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu } = require('electron');

function setupApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    {
      label: app.name || 'Vayun',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Quick Search',
          accelerator: 'Cmd+Alt+K',
          click: () => toggleQuickSearch(),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Page',
          accelerator: 'Cmd+N',
          click: () => mainWin?.webContents.send('page:new'),
        },
        {
          label: 'Close Window',
          accelerator: 'Cmd+W',
          role: 'close',
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
const path = require('node:path');
const fs = require('node:fs');
const { pdfToBlocks } = require('./pdf-import');
const { importNotionZip } = require('./notion-import');

// The app was renamed from Pages to Vayun; keep reading and writing the existing data folder.
// An explicit --user-data-dir (used by tests and separate profiles) still wins.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'Pages'));

// Works from any app, like Notion's quickSearchShortcut preference. Ctrl+K stays the in-window shortcut.
const QUICK_SEARCH_SHORTCUT = 'CommandOrControl+Alt+K';
const TITLEBAR_H = 40; // matches the tab bar height in style.css
const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true };
let data, mainWin, quickWin;

// Workspaces: a registry lists them; each has its own data file. The first one is the old workspace.json.
const registryFile = () => path.join(app.getPath('userData'), 'workspaces.json');
function readRegistry() {
  let r = null;
  if (fs.existsSync(registryFile())) {
    try { r = JSON.parse(fs.readFileSync(registryFile(), 'utf8').replace(/^\uFEFF/, '')); } catch { r = null; }
  }
  if (!r || !Array.isArray(r.workspaces) || !r.workspaces.length) {
    r = { active: 'main', workspaces: [{ id: 'main', name: 'My workspace', file: 'workspace.json', created: Date.now(), opened: 0 }] };
  }
  return r;
}
function writeRegistry() { fs.writeFileSync(registryFile(), JSON.stringify(registry, null, 2)); }
let registry = readRegistry();
const activeEntry = () => registry.workspaces.find(w => w.id === registry.active) || registry.workspaces[0];
const dataFile = () => path.join(app.getPath('userData'), activeEntry().file);

// v1 files (pages + recent only) are upgraded in place; existing pages keep their content.
function migrate(d) {
  d.version = 2;
  d.theme = ['system', 'light', 'dark'].includes(d.theme) ? d.theme : 'dark';
  d.pages = d.pages.map(p => (p.kind ? p : { ...p, kind: undefined }));
  return d;
}

function loadData() {
  const file = dataFile();
  if (fs.existsSync(file)) {
    try { return migrate(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))); }
    catch { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } // keep the broken file instead of overwriting it
  }
  return migrate({
    version: 2, theme: 'dark',
    pages: [{ id: 'welcome', title: 'Welcome', parentId: null, blocks: [
      { id: 'w1', type: 'h1', text: 'Your pages' },
      { id: 'w2', type: 'text', text: 'Start a line with "# ", "## ", "- " or "[] " for headings, lists and to-dos.' },
      { id: 'w3', type: 'todo', text: 'Press Ctrl+K to search this window', checked: false },
      { id: 'w4', type: 'todo', text: 'Press Ctrl+Alt+K from any app for Quick Search', checked: false },
    ] }],
    recent: [],
  });
}

function saveData(next) {
  if (!Array.isArray(next?.pages) || !Array.isArray(next?.recent)) return false;
  if (next.pages.some(p => !p || typeof p.id !== 'string' || !Array.isArray(p.blocks))) return false;
  data = next;
  const tmp = dataFile() + '.tmp';
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data));
  // Atomic replace: a crash never leaves a half-written file. On Windows the rename can fail
  // while another process (antivirus, sync tool, a reader) has the file open, so retry briefly.
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(tmp, dataFile()); return true; }
    catch (err) {
      if (attempt >= 60 || !['EPERM', 'EBUSY'].includes(err.code)) throw err; // about 2 s in total
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
}

function sendWhenLoaded(win, channel, ...args) {
  const send = () => win.webContents.send(channel, ...args);
  win.webContents.isLoading() ? win.webContents.once('did-finish-load', send) : send();
}

function showMain(pageId) {
  if (!mainWin) {
    const isMac = process.platform === 'darwin';
    mainWin = new BrowserWindow({
      width: 1100, height: 750, title: 'Vayun', icon: path.join(__dirname, 'app', 'brand', 'vayun-icon.png'),
      titleBarStyle: 'hidden',
      ...(isMac
        ? { trafficLightPosition: { x: 16, y: 12 } }
        : { titleBarOverlay: { color: '#080909', symbolColor: '#C8D2C5', height: TITLEBAR_H } }),
      backgroundColor: '#0C0D0D', webPreferences,
    });
    mainWin.on('closed', () => {
      mainWin = null;
      if (process.platform !== 'darwin') app.quit(); // on macOS keep running in dock
    });
    mainWin.loadFile(path.join(__dirname, 'app', 'start.html')); // the start page lists and creates workspaces
  }
  if (pageId) sendWhenLoaded(mainWin, 'page:open', pageId);
  mainWin.show();
  mainWin.focus();
}

// Created on first use, like Notion's ensureQuickSearchInitialized().
function toggleQuickSearch() {
  if (!quickWin) {
    quickWin = new BrowserWindow({
      width: 640, height: 440, show: false, frame: false, resizable: false,
      alwaysOnTop: true, skipTaskbar: true, fullscreenable: false,
      ...(process.platform === 'darwin' && { type: 'panel' }),
      webPreferences,
    });
    quickWin.loadFile(path.join(__dirname, 'app', 'quick.html'));
    quickWin.on('blur', () => quickWin.hide());
  }
  if (quickWin.isVisible()) return quickWin.hide();
  sendWhenLoaded(quickWin, 'quick:shown');
  quickWin.center();
  quickWin.show();
  quickWin.focus();
}

// PDFs are converted here (Node); HTML goes back as text for the renderer's DOMParser.
async function importFile(file) {
  const name = path.basename(file, path.extname(file));
  try {
    if (/\.pdf$/i.test(file)) {
      const { title, blocks } = await pdfToBlocks(new Uint8Array(fs.readFileSync(file)));
      if (!blocks.length) throw new Error('No text found. Scanned PDFs need OCR.');
      return { name, title, blocks };
    }
    return { name, html: fs.readFileSync(file, 'utf8') };
  } catch (err) {
    return { name, error: err.message };
  }
}

function onQuickSearchShortcut() {
  // A focused main window gets its own search modal instead of the panel, as in Notion.
  if (mainWin?.isFocused()) mainWin.webContents.send('search:open');
  else toggleQuickSearch();
}

app.whenReady().then(() => {
  setupApplicationMenu();
  data = loadData();
  ipcMain.handle('data:load', () => data);
  ipcMain.on('win:titlebar', (e, { color, symbolColor } = {}) => {
    const hex = v => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : null;
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win === mainWin && hex(color) && hex(symbolColor)) {
      if (typeof win.setTitleBarOverlay === 'function') {
        win.setTitleBarOverlay({ color: hex(color), symbolColor: hex(symbolColor), height: TITLEBAR_H });
      }
    }
  });
  const ai = require('./ai');
  ipcMain.handle('ai:status', () => ai.status());
  ipcMain.handle('ai:setKey', (_e, { key, model }) => ai.setKey(key, model));
  ipcMain.handle('ai:clearKey', () => ai.clearKey());
  ipcMain.handle('ai:chat', (_e, messages) => ai.chat(messages));

  const auth = require('./auth');
  const gcal = require('./gcal');
  ipcMain.handle('auth:status', () => auth.status());
  // The Google Calendar link belongs to whoever is signed in to Vayun: signing out, or a different
  // person signing in, unlinks it, so the next person never sees someone else's events.
  ipcMain.handle('auth:signIn', async () => {
    const before = auth.getUser()?.uid;
    const r = await auth.signIn();
    if (r?.ok && before && r.user?.uid !== before) await gcal.disconnect();
    return r;
  });
  ipcMain.handle('auth:signOut', async () => {
    const r = auth.signOut();
    await gcal.disconnect();
    return r;
  });
  ipcMain.handle('auth:setConfig', (_e, cfg) => auth.setConfig(cfg));
  ipcMain.handle('auth:clearConfig', () => auth.clearConfig());
  ipcMain.handle('gcal:status', () => gcal.status());
  ipcMain.handle('gcal:connect', () => gcal.connect());
  ipcMain.handle('gcal:disconnect', () => gcal.disconnect());
  ipcMain.handle('gcal:list', (_e, range) => gcal.list(range));
  ipcMain.handle('gcal:create', (_e, arg, calId) => {
    if (arg && typeof arg === 'object' && arg.event) return gcal.create(arg.event, arg.calendarId || calId);
    return gcal.create(arg, calId);
  });
  ipcMain.handle('gcal:update', (_e, arg, evt, calId) => {
    if (arg && typeof arg === 'object' && arg.googleId) return gcal.update(arg.googleId, arg.event, arg.calendarId || calId);
    return gcal.update(arg, evt, calId);
  });
  ipcMain.handle('gcal:delete', (_e, arg, calId) => {
    if (arg && typeof arg === 'object' && arg.googleId) return gcal.remove(arg.googleId, arg.calendarId || calId);
    return gcal.remove(arg, calId);
  });
  ipcMain.on('gcal:open', (_e, link) => gcal.openLink(link));
  // Dictation: opens native voice typing (Win+H on Windows; Edit > Start Dictation on macOS).
  ipcMain.handle('voice:start', () => new Promise(resolve => {
    if (process.platform === 'win32') {
      const ps = [
        "$s = '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);'",
        '$k = Add-Type -MemberDefinition $s -Name K -Namespace PagesVoice -PassThru',
        '$k::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero); $k::keybd_event(0x48, 0, 0, [UIntPtr]::Zero)',
        '$k::keybd_event(0x48, 0, 2, [UIntPtr]::Zero); $k::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)',
      ].join('; ');
      const encoded = Buffer.from(ps, 'utf16le').toString('base64');
      require('node:child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true },
        err => resolve(err ? { error: 'Could not start voice typing.' } : { ok: true }));
    } else if (process.platform === 'darwin') {
      require('node:child_process').execFile('osascript', ['-e', 'tell application "System Events" to tell (first process whose frontmost is true) to click menu item "Start Dictation…" of menu "Edit" of menu bar 1'],
        err => resolve(err ? { error: 'Could not trigger macOS dictation. Press Fn twice or enable Dictation in System Settings.' } : { ok: true }));
    } else {
      resolve({ error: 'Voice typing is not supported on this platform.' });
    }
  }));
  ipcMain.on('data:save', (e, next) => {
    try { e.returnValue = saveData(next); }
    catch (err) { console.error('Save failed', err); e.returnValue = false; }
  });
  ipcMain.on('quick:open', (_e, id) => { quickWin?.hide(); showMain(id); });
  // Workspaces: list, create (blank or Tasks starter), open, and back to the start page.
  ipcMain.handle('ws:list', () => ({
    active: registry.active,
    workspaces: registry.workspaces.map(w => ({ id: w.id, name: w.name, created: w.created, opened: w.opened })),
  }));
  ipcMain.handle('ws:active', () => activeEntry().name);
  ipcMain.handle('ws:create', (_e, { name, template }) => {
    const clean = String(name || '').trim().slice(0, 60);
    if (!clean) return { error: 'Give the workspace a name.' };
    const id = 'w' + require('node:crypto').randomUUID().slice(0, 8);
    registry.workspaces.push({ id, name: clean, file: path.join('workspaces', `${id}.json`), created: Date.now(), opened: 0 });
    registry.active = id;
    data = { version: 2, theme: 'dark', pages: [], recent: [] };
    if (template === 'tasks') data.pages.push(require('./app/model').makeDatabase(require('node:crypto').randomUUID().slice(0, 8), 'Tasks'));
    saveData(data);
    writeRegistry();
    return { id };
  });
  ipcMain.handle('ws:open', (_e, id) => {
    const entry = registry.workspaces.find(w => w.id === id);
    if (!entry) return { error: 'Workspace not found.' };
    registry.active = id;
    entry.opened = Date.now();
    writeRegistry();
    data = loadData();
    mainWin.loadFile(path.join(__dirname, 'app', 'index.html'));
    return { ok: true };
  });
  ipcMain.handle('ws:back', () => {
    mainWin.loadFile(path.join(__dirname, 'app', 'start.html'));
    return true;
  });  ipcMain.on('quick:close', () => quickWin?.hide());
  // Export: the renderer builds the file text; the user picks where it goes.
  ipcMain.handle('export:save', async (_e, { name, ext, content }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
      defaultPath: `${String(name).replace(/[\\/:*?"<>|]/g, '_') || 'Untitled'}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  });
  ipcMain.handle('import:notion', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWin, {
      title: 'Import Notion export (Markdown & CSV .zip)',
      properties: ['openFile'],
      filters: [{ name: 'Notion export', extensions: ['zip'] }],
    });
    if (canceled || !filePaths[0]) return null;
    try { return importNotionZip(fs.readFileSync(filePaths[0])); }
    catch (err) { return { error: err.message }; }
  });
  ipcMain.handle('import:pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWin, {
      title: 'Import HTML or PDF',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'HTML or PDF', extensions: ['html', 'htm', 'pdf'] }],
    });
    return canceled ? [] : Promise.all(filePaths.map(importFile));
  });

  if (!globalShortcut.register(QUICK_SEARCH_SHORTCUT, onQuickSearchShortcut)) {
    console.warn(`Could not register ${QUICK_SEARCH_SHORTCUT}; another app may own it.`);
  }
  showMain();
  app.on('activate', () => showMain());
});

app.on('will-quit', () => globalShortcut.unregisterAll());
