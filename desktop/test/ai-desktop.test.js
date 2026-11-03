const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAi } = require('../ai');

// Fake keys are built at run time so this file never contains a key-shaped string (see no-secrets.test.js).
const K = {
  nvidia: 'nv' + 'api-' + 'a'.repeat(30),
  groq: 'gs' + 'k_' + 'b'.repeat(40),
  openai: 'sk' + '-proj-' + 'c'.repeat(40),
};
const fakeSafe = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from('enc:' + s), decryptString: b => String(b).replace(/^enc:/, '') };
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vayun-ai-')), 'ai.json');
const ok = text => ({ status: 200, body: { choices: [{ message: { content: text } }] } });

function network(scripts) {
  const calls = [];
  const f = async (url, init) => {
    const key = String(init.headers.authorization || '').replace('Bearer ', '');
    const body = JSON.parse(init.body);
    calls.push({ url, key, model: body.model });
    const s = scripts[key];
    const r = typeof s === 'function' ? s(calls.filter(c => c.key === key).length) : s;
    if (!r) return { ok: false, status: 401, text: async () => 'no such key' };
    return { ok: r.status === 200, status: r.status, text: async () => JSON.stringify(r.body) };
  };
  f.calls = calls;
  return f;
}

test('desktop ai: a pasted key is recognised, tested and saved encrypted; the settings never hold it in plain text', async () => {
  const file = tmp();
  const ai = createAi({ file, safeStorage: fakeSafe, fetch: network({ [K.groq]: ok('OK') }) });
  assert.strictEqual(ai.status().hasKey, false);
  const r = await ai.setKey(`  "${K.groq}" `);
  assert.deepStrictEqual([r.added.provider, r.added.last4, r.hasKey], ['groq', 'bbbb', true]);
  assert.strictEqual(r.active.provider, 'groq');
  assert.ok(!fs.readFileSync(file, 'utf8').includes(K.groq));
  assert.deepStrictEqual(r.choices.map(c => c.provider), ['groq']);
});

test('desktop ai: an unknown key or one the service rejects is refused and not stored', async () => {
  const ai = createAi({ file: tmp(), safeStorage: fakeSafe, fetch: network({ [K.openai]: { status: 401, body: {} } }) });
  assert.ok((await ai.setKey('not a key')).error.includes('could not tell'));
  assert.ok((await ai.setKey(K.openai)).error.includes('rejected'));
  assert.strictEqual(ai.status().hasKey, false);
  const noStore = createAi({ file: tmp(), safeStorage: { ...fakeSafe, isEncryptionAvailable: () => false }, fetch: network({}) });
  assert.ok((await noStore.setKey(K.groq)).error.includes('Secure storage'));
});

test('desktop ai: several services can be kept; the active one and the answer style can be changed', async () => {
  const fetch = network({ [K.groq]: ok('g'), [K.nvidia]: ok('n') });
  const ai = createAi({ file: tmp(), safeStorage: fakeSafe, fetch });
  await ai.setKey(K.groq);
  await ai.setKey(K.nvidia);
  assert.deepStrictEqual(ai.status().keys.map(k => k.provider).sort(), ['groq', 'nvidia']);
  assert.strictEqual(ai.status().active.provider, 'groq');
  ai.select({ provider: 'nvidia', tier: 'smart' });
  assert.deepStrictEqual([ai.status().active.provider, ai.status().active.tier, ai.status().model], ['nvidia', 'smart', 'nvidia/nemotron-3.5-super-vl-120b-a12b']);
  const r = await ai.chat([{ role: 'user', content: 'hi' }]);
  assert.deepStrictEqual([r.content, r.provider, r.model], ['n', 'nvidia', 'nvidia/nemotron-3.5-super-vl-120b-a12b']);
  // a model typed by hand wins; changing the service clears it; a bad name is not stored empty
  ai.select({ model: 'my-model' });
  assert.strictEqual(ai.status().model, 'my-model');
  ai.select({ provider: 'groq' });
  assert.strictEqual(ai.status().active.model, '');
  assert.strictEqual(ai.select({ provider: 'nope' }).active.provider, 'groq'); // an unknown service is ignored
});

test('desktop ai: when the active service runs out, the next saved key answers, and the person is told which', async () => {
  const fetch = network({ [K.groq]: s => (s === 1 ? ok('OK') : { status: 429, body: {} }), [K.nvidia]: ok('from nvidia') });
  const ai = createAi({ file: tmp(), safeStorage: fakeSafe, fetch });
  await ai.setKey(K.groq);
  await ai.setKey(K.nvidia);
  const r = await ai.chat([{ role: 'user', content: 'hi' }]);
  assert.deepStrictEqual([r.content, r.provider, r.switchedFrom], ['from nvidia', 'nvidia', 'groq']);
});

test('desktop ai: clear problems come back as plain words', async () => {
  const none = createAi({ file: tmp(), safeStorage: fakeSafe, fetch: network({}) });
  assert.strictEqual((await none.chat([{ role: 'user', content: 'hi' }])).error, 'Add an API key first.');
  assert.strictEqual((await none.chat([])).error, 'Bad request.');
  const fetch = network({ [K.groq]: s => (s === 1 ? ok('OK') : { status: 401, body: {} }) });
  const ai = createAi({ file: tmp(), safeStorage: fakeSafe, fetch });
  await ai.setKey(K.groq);
  assert.ok((await ai.chat([{ role: 'user', content: 'hi' }])).error.includes('rejected the key'));
});

test('desktop ai: removing the active key moves to another saved one; the old single-key file is carried over', async () => {
  const ai = createAi({ file: tmp(), safeStorage: fakeSafe, fetch: network({ [K.groq]: ok('g'), [K.nvidia]: ok('n') }) });
  await ai.setKey(K.groq);
  await ai.setKey(K.nvidia);
  assert.strictEqual(ai.removeKey('groq').active.provider, 'nvidia');
  assert.strictEqual(ai.removeKey('nvidia').hasKey, false);

  const file = tmp();
  fs.writeFileSync(file, JSON.stringify({ key: Buffer.from('enc:' + K.nvidia).toString('base64'), model: 'nvidia/some-other-model' }));
  const old = createAi({ file, safeStorage: fakeSafe, fetch: network({ [K.nvidia]: ok('n') }) });
  const s = old.status();
  assert.deepStrictEqual([s.hasKey, s.active.provider, s.keys[0].last4, s.model], [true, 'nvidia', 'aaaa', 'nvidia/some-other-model']);
  assert.strictEqual((await old.chat([{ role: 'user', content: 'hi' }])).model, 'nvidia/some-other-model');
});
