// Theme logic. Pure functions are unit-tested; applyTheme/applyAppearance touch the DOM.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else root.FolioTheme = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const DEFAULT_APPEARANCE = { theme: 'vayun', accent: null, font: 'sans', density: 'comfy', radius: 'soft', width: 'default' };
  const OPTIONS = {
    font: ['sans', 'serif', 'mono'],
    density: ['comfy', 'compact'],
    radius: ['sharp', 'soft', 'round'],
    width: ['default', 'full'],
  };
  const FONTS = {
    sans: "'Geist', ui-sans-serif, system-ui, sans-serif",
    serif: "'Newsreader', Georgia, serif",
    mono: "'Geist Mono', ui-monospace, monospace",
  };

  // Page setting, then the user's app mode, then the OS preference.
  function resolveTheme({ pageTheme, appMode, prefersDark }) {
    if (pageTheme === 'dark' || pageTheme === 'light') return pageTheme;
    if (appMode === 'dark' || appMode === 'light') return appMode;
    return prefersDark ? 'dark' : 'light';
  }

  // Keeps only known values, so a bad file can never break the layout.
  function sanitizeAppearance(a) {
    const out = { ...DEFAULT_APPEARANCE };
    if (!a || typeof a !== 'object') return out;
    if (typeof a.theme === 'string' && /^[a-z]+$/.test(a.theme)) out.theme = a.theme;
    if (typeof a.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(a.accent)) out.accent = a.accent;
    for (const key of Object.keys(OPTIONS)) if (OPTIONS[key].includes(a[key])) out[key] = a[key];
    return out;
  }

  // Derived CSS variables for the chosen appearance. The theme's own colours come from tokens.css.
  function appearanceVars(a, themeInfo) {
    const vars = {
      '--app-font': FONTS[a.font],
      '--doc-size': a.font === 'mono' ? '14.5px' : a.font === 'serif' ? '17.5px' : '16px',
      '--row': a.density === 'compact' ? '3px' : '6px',
      '--gap': a.density === 'compact' ? '4px' : '10px',
      '--card-pad': a.density === 'compact' ? '10px' : '14px',
      '--radius': a.radius === 'sharp' ? '3px' : a.radius === 'round' ? '12px' : '7px',
      '--radius-lg': a.radius === 'sharp' ? '4px' : a.radius === 'round' ? '18px' : '12px',
      '--page-w': a.width === 'full' ? '100%' : '720px',
    };
    if (a.accent) {
      vars['--accent'] = a.accent;
      vars['--accent-soft'] = hexAlpha(a.accent, themeInfo && themeInfo.dark ? 0.16 : 0.1);
    }
    return vars;
  }

  function hexAlpha(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  return { DEFAULT_APPEARANCE, OPTIONS, FONTS, resolveTheme, sanitizeAppearance, appearanceVars, hexAlpha };
});
