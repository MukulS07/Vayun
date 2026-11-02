const test = require('node:test');
const assert = require('node:assert');
const { validatePool } = require('../../tools/set-pool-keys');

// Fake keys are built at run time so this file never contains a key-shaped string (see no-secrets.test.js).
const K = {
  nvidia: 'nv' + 'api-' + 'a'.repeat(30),
  groq: 'gs' + 'k_' + 'b'.repeat(40),
  openai: 'sk' + '-proj-' + 'c'.repeat(40),
};

test('pool tool: keys are matched to their service, in the order listed', () => {
  const r = validatePool([{ key: K.groq }, K.nvidia, { key: ` "${K.openai}" `, provider: 'OpenAI' }]);
  assert.deepStrictEqual(r.problems, []);
  assert.deepStrictEqual(r.entries.map(e => e.provider), ['groq', 'nvidia', 'openai']);
  assert.strictEqual(r.entries[2].key, K.openai);
});

test('pool tool: placeholders and repeats are skipped with a note; they are not errors', () => {
  const r = validatePool([{ key: 'PASTE_FIRST_KEY_HERE' }, { key: K.nvidia }, { key: K.nvidia }]);
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.entries.length, 1);
  assert.strictEqual(r.notes.length, 2);
});

test('pool tool: a wrong service name, an unrecognised key or a bad file is reported without printing the key', () => {
  const wrong = validatePool([{ key: K.groq, provider: 'openai' }]);
  assert.ok(wrong.problems[0].includes('looks like Groq'));
  const unknown = validatePool(['not-a-real-key-at-all']);
  assert.ok(unknown.problems[0].includes('could not tell'));
  assert.ok(!JSON.stringify(unknown).includes('not-a-real-key-at-all'));
  assert.ok(validatePool({}).problems[0].includes('list'));
  assert.ok(validatePool([]).problems[0].includes('No keys'));
  assert.ok(validatePool(Array.from({ length: 21 }, () => K.nvidia)).problems.some(p => p.includes('most is 20')));
});
