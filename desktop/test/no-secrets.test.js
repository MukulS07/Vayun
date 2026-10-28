const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { scanText, scanFiles, scanRepo } = require('../../tools/secret-scan');

// Fake keys are built at run time so this file never contains a key-shaped string itself.
const fake = {
  google: 'AIza' + 'x'.repeat(35),
  oauth: 'GOCSPX-' + 'y'.repeat(28),
  nvidia: 'nvapi-' + 'z'.repeat(40),
  github: 'ghp_' + 'a'.repeat(36),
  pem: '-----BEGIN ' + 'PRIVATE KEY-----',
};

test('scanText flags key-shaped strings and reports the rule and line, not the value', () => {
  for (const [name, value] of Object.entries(fake)) {
    const hits = scanText(`line one\nconst k = '${value}';`);
    assert.strictEqual(hits.length, 1, name);
    assert.strictEqual(hits[0].line, 2, name);
    assert.ok(!JSON.stringify(hits).includes(value), name);
  }
});

test('scanText ignores placeholders, short test values and docs', () => {
  const ok = ['GOCSPX-…', "clientSecret: 'GOCSPX-x'", 'placeholder="AIzaSy..."', 'NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key', 'starts with "nvapi-"'];
  for (const line of ok) assert.deepStrictEqual(scanText(line), [], line);
});

test('scanFiles refuses local credential files but allows the .example templates', () => {
  const read = () => '';
  const files = ['desktop/gcal-client.json', 'desktop/firebase-config.json', 'desktop/.env.local', '.env', 'desktop/.env.local.example'];
  const bad = scanFiles(files, read).map(f => f.file);
  assert.deepStrictEqual(bad, ['desktop/gcal-client.json', 'desktop/firebase-config.json', 'desktop/.env.local', '.env']);
});

test('no credentials are tracked in this repository', t => {
  let findings;
  try { findings = scanRepo(path.resolve(__dirname, '..', '..')); }
  catch { return t.skip('git is not available here'); }
  assert.deepStrictEqual(findings.map(f => `${f.file}:${f.line} ${f.rule}`), []);
});
