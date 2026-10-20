const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['search:open', 'page:open', 'quick:shown'];

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  // Sync so a save issued from beforeunload still lands before the window closes.
  save: data => ipcRenderer.sendSync('data:save', data),
  openFromQuickSearch: id => ipcRenderer.send('quick:open', id),
  closeQuickSearch: () => ipcRenderer.send('quick:close'),
  importFiles: () => ipcRenderer.invoke('import:pick'),
  importNotion: () => ipcRenderer.invoke('import:notion'),
  listWorkspaces: () => ipcRenderer.invoke('ws:list'),
  activeWorkspaceName: () => ipcRenderer.invoke('ws:active'),
  createWorkspace: (name, template) => ipcRenderer.invoke('ws:create', { name, template }),
  openWorkspace: id => ipcRenderer.invoke('ws:open', id),
  backToStart: () => ipcRenderer.invoke('ws:back'),
  exportFile: (name, ext, content) => ipcRenderer.invoke('export:save', { name, ext, content }),
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiSetKey: (key, model) => ipcRenderer.invoke('ai:setKey', { key, model }),
  aiClearKey: () => ipcRenderer.invoke('ai:clearKey'),
  aiChat: messages => ipcRenderer.invoke('ai:chat', messages),
  on: (channel, fn) => {
    if (EVENTS.includes(channel)) ipcRenderer.on(channel, (_e, ...args) => fn(...args));
  },
});
