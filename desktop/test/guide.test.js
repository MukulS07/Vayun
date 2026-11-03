const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appDir = path.join(__dirname, '..', 'app');
const win = {};
vm.runInNewContext(fs.readFileSync(path.join(appDir, 'guide.js'), 'utf8'), { window: win, document: {} });
const G = win.FolioGuide;
const html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');

test('guide: only a brand new workspace gets the tour', () => {
  assert.strictEqual(G.isNewWorkspace({ pages: [{ id: 'welcome' }, { id: 'h', kind: 'home' }] }), true);
  assert.strictEqual(G.isNewWorkspace({ pages: [{ id: 'welcome' }, { id: 'mine' }] }), false);
});

test('guide: every button the tour points at exists, and the steps have words', () => {
  // the mind map button and map are drawn by the app when a page is open, the rest sit in index.html
  const drawn = new Set(['#mm-btn', '.mm-view']);
  for (const s of G.STEPS) {
    assert.ok(s.title && s.body, 'step needs a title and text');
    if (s.target && !drawn.has(s.target)) assert.ok(html.includes(`id="${s.target.slice(1)}"`), `${s.target} is not in index.html`);
  }
  assert.ok(html.includes('id="tour-btn"') && html.includes('guide.js'));
});

test('guide: the Getting started page is made of headings and lines, so it maps well', () => {
  const heads = G.GUIDE_BLOCKS.filter(b => b.type === 'h1');
  assert.ok(heads.length >= 4);
  assert.ok(G.GUIDE_BLOCKS.every(b => ['h1', 'bullet', 'text'].includes(b.type) && b.text));
});
