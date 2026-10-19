const test = require('node:test');
const assert = require('node:assert');
const L = require('../app/template-logic');

test('layout add: appends once, never duplicates', () => {
  const a = L.layoutAdd(L.LIFE_LAYOUT, 'notes', true);
  assert.strictEqual(a[a.length - 1].id, 'notes');
  assert.strictEqual(a[a.length - 1].wide, true);
  assert.strictEqual(L.layoutAdd(a, 'notes'), a, 'adding an existing widget changes nothing');
});

test('layout remove drops the widget and keeps the rest in order', () => {
  const r = L.layoutRemove(L.LIFE_LAYOUT, 'sound');
  assert.strictEqual(r.length, L.LIFE_LAYOUT.length - 1);
  assert.ok(!r.some(w => w.id === 'sound'));
  assert.deepStrictEqual(r.map(w => w.id).slice(0, 2), ['today', 'progress']);
});

test('layout move swaps with neighbour and stops at the edges', () => {
  const up = L.layoutMove(L.LIFE_LAYOUT, 'sound', -1);
  assert.deepStrictEqual(up.slice(0, 2).map(w => w.id), ['sound', 'today']);
  assert.strictEqual(L.layoutMove(L.LIFE_LAYOUT, 'today', -1), L.LIFE_LAYOUT, 'first widget cannot move up');
  const last = L.LIFE_LAYOUT[L.LIFE_LAYOUT.length - 1].id;
  assert.strictEqual(L.layoutMove(L.LIFE_LAYOUT, last, 1), L.LIFE_LAYOUT, 'last widget cannot move down');
});

test('layout width toggles without touching other widgets', () => {
  const t = L.layoutToggleWide(L.LIFE_LAYOUT, 'today');
  assert.strictEqual(t[0].wide, true);
  assert.strictEqual(t[1].wide, L.LIFE_LAYOUT[1].wide);
});

test('sanitizeLayout drops unknown and duplicate widgets and falls back when empty', () => {
  const s = L.sanitizeLayout([{ id: 'today' }, { id: 'nope' }, { id: 'today', wide: true }, { id: 'notes', wide: 1 }], L.LIFE_WIDGET_IDS, L.LIFE_LAYOUT);
  assert.deepStrictEqual(s, [{ id: 'today', wide: false }, { id: 'notes', wide: true }]);
  assert.strictEqual(L.sanitizeLayout([], L.LIFE_WIDGET_IDS, L.LIFE_LAYOUT).length, L.LIFE_LAYOUT.length);
  assert.strictEqual(L.sanitizeLayout(null, L.STUDY_WIDGET_IDS, L.STUDY_LAYOUT).length, L.STUDY_LAYOUT.length);
});

test('sanitizers keep layout, notes and to-dos', () => {
  const life = L.sanitizeLife({ notes: 'Plan Monday', todos: [{ id: 'x', text: 'Buy milk', done: true }], layout: [{ id: 'notes' }] });
  assert.strictEqual(life.notes, 'Plan Monday');
  assert.strictEqual(life.todos[0].done, true);
  assert.deepStrictEqual(life.layout, [{ id: 'notes', wide: false }]);
  const study = L.sanitizeStudy({ notes: 'Exam prep' });
  assert.strictEqual(study.notes, 'Exam prep');
  assert.strictEqual(study.layout.length, L.STUDY_LAYOUT.length);
});