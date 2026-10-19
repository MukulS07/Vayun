// Runs in <head> before first paint, so the saved theme never flashes. Reads the per-viewer cache
// that app.js keeps in localStorage (the workspace file is loaded later over IPC).
(function () {
  try {
    const a = FolioTheme.sanitizeAppearance(JSON.parse(localStorage.getItem('folio-appearance')));
    applyTheme(a);
  } catch {
    applyTheme(FolioTheme.DEFAULT_APPEARANCE);
  }
  function applyTheme(a) {
    const info = (window.FOLIO_APP_THEMES || {})[a.theme] || { dark: true };
    const root = document.documentElement;
    root.dataset.appTheme = a.theme;
    root.dataset.theme = info.dark ? 'dark' : 'light';
    for (const [k, v] of Object.entries(FolioTheme.appearanceVars(a, info))) root.style.setProperty(k, v);
  }
})();
