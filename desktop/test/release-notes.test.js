const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../../tools/release-notes');

const changelog = fs.readFileSync(path.join(__dirname, '..', '..', 'CHANGELOG.md'), 'utf8');
const version = require('../package.json').version;

test('the release title and description come from this version’s changelog section', () => {
  assert.ok(R.title(changelog, 'v' + version).startsWith(`Vayun v${version} — `) && R.title(changelog, 'v' + version).length > `Vayun v${version} — `.length, 'a tagline follows the version');
  const text = R.notes(changelog, 'v' + version);
  assert.match(text, /^### \S/, 'starts with the tagline');
  assert.ok(text.includes('## What is new') && text.includes('## Which file do I download?'));
  assert.ok(text.includes(`Vayun-Setup-${version}.exe`) && text.includes(`Vayun-${version}-universal.dmg`));
  assert.ok(!text.includes('## v' + version), 'the changelog heading itself is not repeated');
});

test('a section stops at the next version', () => {
  const s = R.section('## v2.0.0 — 2027-01-01\n> Big\n- a\n\n## v1.0.0 — 2026-01-01\n> Old\n- b\n', 'v2.0.0');
  assert.deepStrictEqual([s.date, s.tagline, s.bullets], ['2027-01-01', 'Big', '- a']);
});

test('tagging a version with no changelog entry fails instead of publishing an empty release', () => {
  assert.throws(() => R.notes(changelog, 'v9.9.9'), /no section for v9\.9\.9/);
  assert.strictEqual(R.title(changelog, 'v9.9.9'), 'Vayun v9.9.9');
});

test('every released version in the changelog has a tagline', () => {
  const heads = [...changelog.matchAll(/^## (v\d+\.\d+\.\d+) — \d{4}-\d{2}-\d{2}$/gm)].map(m => m[1]);
  assert.ok(heads.length >= 7);
  for (const v of heads) assert.ok(R.section(changelog, v).tagline, v + ' has a tagline');
});
