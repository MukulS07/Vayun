const test = require('node:test');
const assert = require('node:assert');
const AdmZip = require('adm-zip');
const { importNotionZip, parseCsv, mdToBlocks, inferSchema } = require('../notion-import');

const ID = 'a'.repeat(32);
const ID2 = 'b'.repeat(32);

function zipOf(files) {
  const z = new AdmZip();
  for (const [name, text] of Object.entries(files)) z.addFile(name, Buffer.from(text, 'utf8'));
  return z.toBuffer();
}

test('csv parser handles quotes, embedded commas and CRLF', () => {
  assert.deepStrictEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepStrictEqual(parseCsv('a\n"multi\nline"\n'), [['a'], ['multi\nline']]);
});

test('markdown becomes blocks; leading title line is dropped', () => {
  const blocks = mdToBlocks('# Plan\n\n## Goals\nBody line\n- [x] done\n- item\n', 'Plan');
  assert.deepStrictEqual(blocks.map(b => [b.type, b.text, b.checked]), [
    ['h2', 'Goals', undefined], ['text', 'Body line', undefined], ['todo', 'done', true], ['bullet', 'item', undefined],
  ]);
});

test('column types inferred from values', () => {
  const s = inferSchema(['Name', 'Due', 'Done?', 'Score', 'Status', 'Notes'], [
    ['a', '2026-01-02', 'Yes', '3', 'Open', 'one'],
    ['b', '2026-02-03', 'No', '4.5', 'Closed', 'two'],
  ]);
  assert.deepStrictEqual(s.map(p => p.type), ['date', 'checkbox', 'number', 'select', 'select']);
  assert.deepStrictEqual(s[3].options, ['Open', 'Closed']);
});

test('notion export: pages nest by folder, database rows get props and bodies', () => {
  const buf = zipOf({
    [`Home ${ID}.md`]: `# Home\n\n- welcome\n`,
    [`Home ${ID}/Child ${ID2}.md`]: `# Child\n\nchild body\n`,
    [`Tasks ${ID2}.csv`]: 'Name,Status,Due\r\nWrite spec,Doing,2026-03-02\r\nShip,Done,2026-01-15\r\n',
    [`Tasks ${ID2}/Write spec ${'c'.repeat(32)}.md`]: `# Write spec\n\nspec body\n`,
    'images/logo.png': 'binary-ish',
  });
  const r = importNotionZip(buf);
  const byTitle = t => r.pages.find(p => p.title === t);

  const home = byTitle('Home');
  const child = byTitle('Child');
  const db = byTitle('Tasks');
  assert.ok(home && child && db);
  assert.strictEqual(child.parentId, home.id);
  assert.strictEqual(db.kind, 'database');
  assert.strictEqual(db.parentId, null);

  const spec = byTitle('Write spec');
  assert.strictEqual(spec.parentId, db.id);
  assert.strictEqual(spec.props[db.schema.find(p => p.name === 'Status').id], 'Doing');
  assert.strictEqual(spec.blocks[0].text, 'spec body', 'row body taken from the database folder');
  assert.strictEqual(r.pages.filter(p => p.title === 'Write spec').length, 1, 'no duplicate row page');
  assert.strictEqual(r.rows, 2);
  assert.deepStrictEqual(r.skipped, ['images/logo.png']);
});

test('entry names only become titles; nothing is written to disk', () => {
  const r = importNotionZip(zipOf({ '../evil.md': '# x', 'ok.md': '# ok' }));
  assert.deepStrictEqual(r.pages.map(p => p.title), ['evil', 'ok']);
  assert.deepStrictEqual(r.skipped, []);
});
