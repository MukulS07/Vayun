const test = require('node:test');
const assert = require('node:assert');
const T = require('../app/theme');

test('theme fallback: page setting beats app mode beats OS preference', () => {
  assert.strictEqual(T.resolveTheme({ pageTheme: 'light', appMode: 'dark', prefersDark: true }), 'light');
  assert.strictEqual(T.resolveTheme({ pageTheme: null, appMode: 'dark', prefersDark: false }), 'dark');
  assert.strictEqual(T.resolveTheme({ pageTheme: undefined, appMode: 'system', prefersDark: true }), 'dark');
  assert.strictEqual(T.resolveTheme({ pageTheme: undefined, appMode: 'system', prefersDark: false }), 'light');
  assert.strictEqual(T.resolveTheme({ pageTheme: 'bogus', appMode: 'light', prefersDark: true }), 'light');
});

test('sanitizeAppearance keeps known values and falls back for the rest', () => {
  const a = T.sanitizeAppearance({ theme: 'sepia', accent: '#B5541C', font: 'serif', density: 'huge', radius: 'round', width: 'full' });
  assert.deepStrictEqual(a, { theme: 'sepia', accent: '#B5541C', font: 'serif', density: 'comfy', radius: 'round', width: 'full' });
  assert.deepStrictEqual(T.sanitizeAppearance(null), T.DEFAULT_APPEARANCE);
  assert.strictEqual(T.sanitizeAppearance({ accent: 'red; background:url(x)' }).accent, null, 'rejects CSS injection in accent');
  assert.strictEqual(T.sanitizeAppearance({ theme: '../x' }).theme, T.DEFAULT_APPEARANCE.theme, 'rejects odd theme ids');
});

test('appearanceVars maps density, corners, width and font', () => {
  const v = T.appearanceVars({ ...T.DEFAULT_APPEARANCE, density: 'compact', radius: 'sharp', width: 'full', font: 'mono' }, { dark: true });
  assert.strictEqual(v['--row'], '3px');
  assert.strictEqual(v['--radius'], '3px');
  assert.strictEqual(v['--page-w'], '100%');
  assert.strictEqual(v['--doc-size'], '14.5px');
  const accent = T.appearanceVars({ ...T.DEFAULT_APPEARANCE, accent: '#3D5AFE' }, { dark: false });
  assert.strictEqual(accent['--accent'], '#3D5AFE');
  assert.strictEqual(accent['--accent-soft'], 'rgba(61,90,254,0.1)');
});
