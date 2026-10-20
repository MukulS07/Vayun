const { app, BrowserWindow, dialog, globalShortcut, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pdfToBlocks } = require('./pdf-import');
const { importNotionZip } = require('./notion-import');

// The app was renamed from Pages to Vayun; keep reading and writing the existing data folder.
// An explicit --user-data-dir (used by tests and separate profiles) still wins.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'Pages'));

// Works from any app, like Notion's quickSearchShortcut preference. Ctrl+K stays the in-window shortcut.
const QUICK_SEARCH_SHORTCUT = 'CommandOrControl+Alt+K';
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
    mainWin = new BrowserWindow({ width: 1100, height: 750, title: 'Vayun', icon: path.join(__dirname, 'app', 'brand', 'vayun-icon.png'), webPreferences });
    mainWin.on('closed', () => {
      mainWin = null;
      if (process.platform !== 'darwin') app.quit(); // no tray, so closing the main window quits
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
  data = loadData();
  ipcMain.handle('data:load', () => data);
  const ai = require('./ai');
  ipcMain.handle('ai:status', () => ai.status());
  ipcMain.handle('ai:setKey', (_e, { key, model }) => ai.setKey(key, model));
  ipcMain.handle('ai:clearKey', () => ai.clearKey());
  ipcMain.handle('ai:chat', (_e, messages) => ai.chat(messages));
  // Dictation: opens Windows voice typing (Win+H) in whatever field has focus. Fixed script, no user input.
  ipcMain.handle('voice:start', () => new Promise(resolve => {
    if (process.platform !== 'win32') return resolve({ error: 'Voice typing is only wired up on Windows.' });
    const ps = [
      "$s = '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);'",
      '$k = Add-Type -MemberDefinition $s -Name K -Namespace PagesVoice -PassThru',
      '$k::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero); $k::keybd_event(0x48, 0, 0, [UIntPtr]::Zero)',
      '$k::keybd_event(0x48, 0, 2, [UIntPtr]::Zero); $k::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)',
    ].join('; ');
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    require('node:child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true },
      err => resolve(err ? { error: 'Could not start voice typing.' } : { ok: true }));
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
