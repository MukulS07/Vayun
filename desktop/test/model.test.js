const test = require('node:test');
const assert = require('node:assert');
const M = require('../app/model');
const { toMarkdown, toHtml, toCsv } = require('../app/export');

const db = () => M.makeDatabase('db', 'Tasks');
const rows = () => [
  M.makeRow('r1', db(), 'Write spec', { status: 'Doing', priority: 'High', due: '2026-03-02' }),
  M.makeRow('r2', db(), 'Ship build', { status: 'Done', priority: 'Low', due: '2026-01-15' }),
  M.makeRow('r3', db(), 'Hire', { status: 'To do', priority: 'High' }),
];

test('filter by title and by property, case-insensitive', () => {
  const r = rows();
  assert.deepStrictEqual(M.filterRows(r, { propId: 'title', value: 'SHIP' }).map(x => x.id), ['r2']);
  assert.deepStrictEqual(M.filterRows(r, { propId: 'priority', value: 'high' }).map(x => x.id), ['r1', 'r3']);
  assert.strictEqual(M.filterRows(r, null).length, 3);
});

test('sort ascending and descending; empty values always last', () => {
  // r1 2026-03-02, r2 2026-01-15, r3 and r4 have no date (kept in input order)
  const r = [...rows(), M.makeRow('r4', db(), 'No date', {})];
  assert.deepStrictEqual(M.sortRows(r, { propId: 'due', dir: 'asc' }).map(x => x.id), ['r2', 'r1', 'r3', 'r4']);
  assert.deepStrictEqual(M.sortRows(r, { propId: 'due', dir: 'desc' }).map(x => x.id), ['r1', 'r2', 'r3', 'r4']);
});

test('group by select keeps option order and shows empty options only with rows', () => {
  const d = db();
  d.view = { type: 'board', group: 'status' };
  const groups = M.groupRows(d, rows());
  assert.deepStrictEqual(groups.map(g => [g.label, g.rows.length]), [['To do', 1], ['Doing', 1], ['Done', 1]]);
});

test('visibleRows applies the view to only this database\'s rows', () => {
  const d = db();
  const other = M.makeDatabase('other', 'Other');
  const stray = M.makeRow('x', other, 'Other row', {});
  d.view = { type: 'table', filter: { propId: 'priority', value: 'High' }, sort: { propId: 'title', dir: 'asc' } };
  const out = M.visibleRows(d, [d, ...rows(), stray]).map(x => x.title);
  assert.deepStrictEqual(out, ['Hire', 'Write spec']);
});

test('calendar groups by date, with undated rows last', () => {
  const d = db();
  const groups = M.calendarGroups(d, rows().concat(M.makeRow('r4', d, 'Undated', {})));
  assert.deepStrictEqual(groups.map(([k]) => k), ['2026-01-15', '2026-03-02', 'No date']);
});

test('mindmap tree nests subpages and survives a cycle', () => {
  const pages = [
    { id: 'root', title: 'Root', parentId: null },
    { id: 'a', title: 'A', parentId: 'root' },
    { id: 'a1', title: 'A1', parentId: 'a' },
    { id: 'b', title: 'B', parentId: 'root' },
  ];
  const t = M.mindmapTree(pages, 'root');
  assert.deepStrictEqual(t.children.map(c => c.title), ['A', 'B']);
  assert.deepStrictEqual(t.children[0].children.map(c => c.title), ['A1']);
  pages[0].parentId = 'a1'; // cycle: root -> a -> a1 -> root
  assert.doesNotThrow(() => M.mindmapTree(pages, 'root'));
});

test('markdown export maps each block type', () => {
  const page = { title: 'Plan', blocks: [
    { type: 'h1', text: 'Goals' }, { type: 'text', text: 'Body.' },
    { type: 'bullet', text: 'Item' }, { type: 'todo', text: 'Done thing', checked: true }, { type: 'todo', text: 'Open' },
  ] };
  assert.strictEqual(toMarkdown(page), '# Plan\n\n## Goals\n\nBody.\n\n- Item\n- [x] Done thing\n- [ ] Open\n');
});

test('html export escapes text and groups list items', () => {
  const page = { title: 'A <b>', blocks: [{ type: 'bullet', text: '1 & 2' }, { type: 'bullet', text: 'x' }, { type: 'text', text: '<script>' }] };
  const html = toHtml(page);
  assert.ok(html.includes('<title>A &lt;b&gt;</title>'));
  assert.ok(html.includes('<ul>\n<li>1 &amp; 2</li>\n<li>x</li>\n</ul>'));
  assert.ok(html.includes('<p>&lt;script&gt;</p>'));
  assert.ok(!html.includes('<script>'));
});

test('csv export quotes commas, quotes and newlines', () => {
  const d = db();
  const r = M.makeRow('q', d, 'Hi, "there"', { status: 'Done', priority: 'Low', assignee: 'a\nb' });
  const csv = toCsv(d, [r]);
  assert.strictEqual(csv.split('\r\n')[0], 'Name,Status,Priority,Due,Assignee');
  assert.ok(csv.includes('"Hi, ""there"""'));
  assert.ok(csv.includes('"a\nb"'));
});

test('export: numbered, quote, callout, code, divider and h3 blocks', () => {
  const page = { title: 'Notes', blocks: [
    { type: 'h3', text: 'Small' }, { type: 'numbered', text: 'One' }, { type: 'numbered', text: 'Two' },
    { type: 'quote', text: 'Said' }, { type: 'callout', text: 'Tip' }, { type: 'code', text: 'x = 1' }, { type: 'divider', text: '' },
  ] };
  assert.strictEqual(toMarkdown(page), '# Notes\n\n#### Small\n\n1. One\n2. Two\n\n> Said\n\n> 💡 Tip\n\n```\nx = 1\n```\n\n---\n');
  const html = toHtml(page);
  assert.ok(html.includes('<h4>Small</h4><ol><li>One</li><li>Two</li></ol><blockquote>Said</blockquote>') || /<h4>Small<\/h4>\s*<ol>\s*<li>One<\/li>\s*<li>Two<\/li>\s*<\/ol>\s*<blockquote>Said<\/blockquote>/.test(html), html);
  assert.ok(/<pre><code>x = 1<\/code><\/pre>\s*<hr>/.test(html), html);
});
