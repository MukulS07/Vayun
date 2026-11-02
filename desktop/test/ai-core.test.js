const test = require('node:test');
const assert = require('node:assert');
require('../../tools/sync-ai').sync();
const { createAiCore } = require('../../functions/ai-core');
const { createCryptoBox } = require('../../functions/crypto-box');

// Fake keys are built at run time so this file never contains a key-shaped string (see no-secrets.test.js).
const K = {
  openai: 'sk' + '-proj-' + 'a'.repeat(40),
  groq: 'gs' + 'k_' + 'b'.repeat(40),
  nvidia: 'nv' + 'api-' + 'c'.repeat(30),
  nvidia2: 'nv' + 'api-' + 'd'.repeat(30),
};
const secret = Buffer.alloc(32, 7).toString('base64');
const box = createCryptoBox(secret);

function memoryStore() {
  const keys = new Map(); const usage = new Map();
  return {
    async listKeys(uid) { return [...(keys.get(uid) || new Map()).values()]; },
    async putKey(uid, rec) { if (!keys.has(uid)) keys.set(uid, new Map()); keys.get(uid).set(rec.provider, rec); },
    async deleteKey(uid, p) { (keys.get(uid) || new Map()).delete(p); },
    async usage(uid, day) { return usage.get(uid + day) || 0; },
    async addUsage(uid, day, n) { const v = (usage.get(uid + day) || 0) + n; usage.set(uid + day, v); return v; },
    _keys: keys,
  };
}

// A fake network: each key maps to a script of answers. { status, body } or a thrown error.
function fakeFetch(scripts) {
  const calls = [];
  const f = async (url, init) => {
    const auth = init.headers.authorization || init.headers['x-api-key'] || init.headers['x-goog-api-key'] || '';
    const key = auth.replace('Bearer ', '');
    calls.push({ url, key });
    const s = scripts[key];
    const r = typeof s === 'function' ? s(calls.filter(c => c.key === key).length) : s;
    if (!r) return { ok: false, status: 401, text: async () => 'no such key' };
    if (r.throw) throw new Error('network');
    return { ok: r.status === 200, status: r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  f.calls = calls;
  return f;
}
const ok = text => ({ status: 200, body: { choices: [{ message: { content: text } }] } });
const msgs = [{ role: 'user', content: 'Plan my day' }];

test('server ai: saving a key tests it, encrypts it and never stores it in plain text', async () => {
  const store = memoryStore();
  const fetch = fakeFetch({ [K.openai]: ok('OK') });
  const core = createAiCore({ store, crypto: box, fetch });
  const r = await core.saveKey('u1', `  ${K.openai}\n`);
  assert.deepStrictEqual({ provider: r.provider, last4: r.last4 }, { provider: 'openai', last4: 'aaaa' });
  const saved = (await store.listKeys('u1'))[0];
  assert.ok(!JSON.stringify(saved).includes(K.openai));
  assert.strictEqual(box.decrypt(saved.cipher), K.openai);
  const st = await core.status('u1');
  assert.deepStrictEqual(st.own.map(o => [o.provider, o.last4]), [['openai', 'aaaa']]);
  assert.ok(!JSON.stringify(st).includes(K.openai));
});

test('server ai: an unknown or rejected key is refused and nothing is stored', async () => {
  const store = memoryStore();
  const core = createAiCore({ store, crypto: box, fetch: fakeFetch({ [K.openai]: { status: 401, body: 'bad key' } }) });
  await assert.rejects(core.saveKey('u1', 'not a key'), e => e.code === 'unknown');
  await assert.rejects(core.saveKey('u1', K.openai), e => e.code === 'rejected');
  assert.strictEqual((await store.listKeys('u1')).length, 0);
});

test('server ai: a key that is only out of allowance is still saved, with a note', async () => {
  const store = memoryStore();
  const core = createAiCore({ store, crypto: box, fetch: fakeFetch({ [K.groq]: { status: 429, body: 'rate limited' } }) });
  const r = await core.saveKey('u1', K.groq);
  assert.ok(r.warning);
  assert.strictEqual((await store.listKeys('u1')).length, 1);
});

test('server ai: a person with their own key uses it, with no daily limit counted', async () => {
  const store = memoryStore();
  const fetch = fakeFetch({ [K.openai]: ok('hello') });
  const core = createAiCore({ store, crypto: box, fetch, pool: [{ provider: 'nvidia', key: K.nvidia }], limit: 1 });
  await core.saveKey('u1', K.openai);
  for (let i = 0; i < 3; i++) {
    const r = await core.chat('u1', { messages: msgs });
    assert.strictEqual(r.source, 'own');
  }
  assert.strictEqual((await core.status('u1')).pool.used, 0);
});

test('server ai: the pool rotates, moves to the next key when one runs out, and rests the dead one', async () => {
  const store = memoryStore();
  let t = 1_000_000;
  const fetch = fakeFetch({ [K.nvidia]: { status: 429, body: 'quota' }, [K.groq]: ok('from groq') });
  const core = createAiCore({ store, crypto: box, fetch, now: () => t, limit: 50, pool: [{ provider: 'nvidia', key: K.nvidia }, { provider: 'groq', key: K.groq }] });
  const r = await core.chat('u1', { messages: msgs });
  assert.strictEqual(r.provider, 'groq');
  assert.strictEqual(r.source, 'pool');
  const first = fetch.calls.filter(c => c.key === K.nvidia).length;
  assert.strictEqual(first, 1);
  // the exhausted key is left alone for a few minutes
  await core.chat('u1', { messages: msgs });
  await core.chat('u1', { messages: msgs });
  assert.strictEqual(fetch.calls.filter(c => c.key === K.nvidia).length, 1);
  // after the rest period it is tried again
  t += 6 * 60 * 1000;
  await core.chat('u1', { messages: msgs });
  await core.chat('u1', { messages: msgs });
  assert.ok(fetch.calls.filter(c => c.key === K.nvidia).length >= 2);
});

test('server ai: the daily limit stops free use, per person, and refunds a request that got no answer', async () => {
  const store = memoryStore();
  const fetch = fakeFetch({ [K.nvidia]: ok('hi') });
  const core = createAiCore({ store, crypto: box, fetch, limit: 2, pool: [{ provider: 'nvidia', key: K.nvidia }] });
  await core.chat('u1', { messages: msgs });
  const second = await core.chat('u1', { messages: msgs });
  assert.strictEqual(second.left, 0);
  await assert.rejects(core.chat('u1', { messages: msgs }), e => e.code === 'limit');
  assert.strictEqual((await core.status('u1')).pool.used, 2);       // a refused request is not counted
  assert.strictEqual((await core.chat('u2', { messages: msgs })).left, 1); // someone else is unaffected

  const down = createAiCore({ store: memoryStore(), crypto: box, fetch: fakeFetch({ [K.nvidia]: { status: 503, body: '' } }), limit: 5, pool: [{ provider: 'nvidia', key: K.nvidia }] });
  await assert.rejects(down.chat('u1', { messages: msgs }), e => e.code === 'busy');
  assert.strictEqual((await down.status('u1')).pool.used, 0);        // nothing answered, nothing counted
});

test('server ai: a rejected own key is reported, an out-of-allowance own key falls back to the pool', async () => {
  const store = memoryStore();
  const fetch = fakeFetch({ [K.openai]: s => (s === 1 ? ok('OK') : { status: 401, body: 'revoked' }), [K.nvidia]: ok('pool answer') });
  const core = createAiCore({ store, crypto: box, fetch, pool: [{ provider: 'nvidia', key: K.nvidia }] });
  await core.saveKey('u1', K.openai); // first call is the test and works
  await assert.rejects(core.chat('u1', { messages: msgs }), e => e.code === 'rejected');

  const s2 = memoryStore();
  const f2 = fakeFetch({ [K.groq]: s => (s === 1 ? ok('OK') : { status: 429, body: 'quota' }), [K.nvidia]: ok('pool answer') });
  const c2 = createAiCore({ store: s2, crypto: box, fetch: f2, pool: [{ provider: 'nvidia', key: K.nvidia }] });
  await c2.saveKey('u1', K.groq);
  const r = await c2.chat('u1', { messages: msgs });
  assert.deepStrictEqual([r.source, r.text], ['pool', 'pool answer']);
});

test('server ai: no key anywhere, oversized and empty requests are refused clearly', async () => {
  const core = createAiCore({ store: memoryStore(), crypto: box, fetch: fakeFetch({}) });
  await assert.rejects(core.chat('u1', { messages: msgs }), e => e.code === 'no-key');
  await assert.rejects(core.chat('u1', { messages: [] }), e => e.code === 'bad');
  await assert.rejects(core.chat('u1', { messages: [{ role: 'user', content: 'x'.repeat(30000) }] }), e => e.code === 'bad');
  await assert.rejects(core.chat('u1', { messages: Array.from({ length: 30 }, () => ({ role: 'user', content: 'x' })) }), e => e.code === 'bad');
});

test('server ai: keys are encrypted with a fresh nonce and tampering is caught', () => {
  const a = box.encrypt('secret'), b = box.encrypt('secret');
  assert.notStrictEqual(a, b);
  assert.strictEqual(box.decrypt(a), 'secret');
  const bad = Buffer.from(a, 'base64'); bad[bad.length - 1] ^= 1;
  assert.throws(() => box.decrypt(bad.toString('base64')));
  assert.throws(() => createCryptoBox('short'));
});

test("server ai: when every pool key fails, the project's own Gemini answers, and it counts as one message", async () => {
  const store = memoryStore();
  const fetch = fakeFetch({ [K.nvidia]: { status: 429, body: "quota" }, [K.groq]: { status: 503, body: "" } });
  const asked = [];
  const fallback = async req => { asked.push(req.model); return "from firebase"; };
  const core = createAiCore({ store, crypto: box, fetch, fallback, limit: 5, pool: [{ provider: "nvidia", key: K.nvidia }, { provider: "groq", key: K.groq }] });
  const r = await core.chat("u1", { messages: msgs });
  assert.deepStrictEqual([r.source, r.provider, r.text, r.used], ["firebase", "firebase", "from firebase", 1]);
  assert.deepStrictEqual(asked, ["gemini-2.0-flash"]);
  assert.strictEqual((await core.status("u1")).pool.used, 1);
});

test("server ai: the fallback is the last resort, never used while a pool key can answer", async () => {
  let used = 0;
  const core = createAiCore({ store: memoryStore(), crypto: box, fetch: fakeFetch({ [K.nvidia]: ok("pool") }), fallback: async () => { used++; return "fb"; }, pool: [{ provider: "nvidia", key: K.nvidia }] });
  assert.strictEqual((await core.chat("u1", { messages: msgs })).source, "pool");
  assert.strictEqual(used, 0);
});

test("server ai: with only the fallback set up the Assistant still works; if it fails too, nothing is counted", async () => {
  const store = memoryStore();
  const only = createAiCore({ store, crypto: box, fetch: fakeFetch({}), fallback: async () => "fb only", limit: 3 });
  assert.strictEqual((await only.status("u1")).pool.available, true);
  assert.strictEqual((await only.chat("u1", { messages: msgs })).source, "firebase");

  const broken = createAiCore({ store: memoryStore(), crypto: box, fetch: fakeFetch({}), fallback: async () => { throw new Error("vertex 403"); }, limit: 3 });
  await assert.rejects(broken.chat("u1", { messages: msgs }), e => e.code === "busy");
  assert.strictEqual((await broken.status("u1")).pool.used, 0);
});

test("server ai: round-robin spreads requests over the keys; priority always starts with the first", async () => {
  const both = { [K.groq]: ok("g"), [K.nvidia]: ok("n") };
  const pool = [{ provider: "groq", key: K.groq }, { provider: "nvidia", key: K.nvidia }];
  const rr = createAiCore({ store: memoryStore(), crypto: box, fetch: fakeFetch(both), pool, limit: 50 });
  const a = await rr.chat("u1", { messages: msgs }), b = await rr.chat("u1", { messages: msgs });
  assert.deepStrictEqual([a.provider, b.provider], ["groq", "nvidia"]);
  const pr = createAiCore({ store: memoryStore(), crypto: box, fetch: fakeFetch(both), pool, mode: "priority", limit: 50 });
  const seq = [];
  for (let i = 0; i < 3; i++) seq.push((await pr.chat("u1", { messages: msgs })).provider);
  assert.deepStrictEqual(seq, ["groq", "groq", "groq"]);
});
