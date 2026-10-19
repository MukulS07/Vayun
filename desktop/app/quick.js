let data = { pages: [], recent: [] };

const ui = mountSearch({
  input: document.getElementById('q'),
  list: document.getElementById('results'),
  label: document.getElementById('label'),
  getPages: () => data.pages,
  getRecent: () => data.recent.map(id => data.pages.find(p => p.id === id)).filter(Boolean),
  onOpen: p => api.openFromQuickSearch(p.id),
  onClose: () => api.closeQuickSearch(),
});

// Reload each time it opens so pages edited in the main window show up.
api.on('quick:shown', async () => { data = await api.load(); ui.reset(); });
