// The server side of the Assistant, with nothing Firebase-specific in it so it can be tested with fakes.
//   - a person's own key: saved encrypted (after a test call) and used only for their requests
//   - the shared pool: keys the owner holds on the server; several can be listed and the next one is used when one
//     runs out of allowance, with a daily message limit per person
// Keys never leave this file in plain text: not in answers, not in logs, not in errors.
const P = require('./ai-providers');

const MAX_CHARS = 24000;   // all messages together
const MAX_MESSAGES = 14;
const MAX_TOKENS = 2000;
const COOL_DOWN_MS = 5 * 60 * 1000; // a pool key that just ran out is left alone for a while

class AiError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; Object.assign(this, extra || {}); }
}

// deps:
//   store   { listKeys(uid), putKey(uid, rec), deleteKey(uid, provider), usage(uid, day), addUsage(uid, day, n) }
//   crypto  { encrypt(text), decrypt(text) }
//   fetch   fetch-like function
//   pool    [{ provider, key }]            keys held on the server (may be empty), tried first
//   mode    'round-robin' | 'priority'     spread requests over the keys, or always start with the first one
//   fallback async ({ model, messages, maxTokens }) => text   the project's own Gemini (no key); used only when every pool key failed
//   limit   free messages per person per day when the pool is used
//   now     () => ms
function createAiCore({ store, crypto, fetch: fetchImpl, pool = [], mode = 'round-robin', fallback = null, limit = 20, now = Date.now }) {
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const cooling = new Map(); // pool index -> time it may be used again
  let rotate = 0;            // spreads load over the pool keys

  const poolKeys = pool
    .map(p => ({ provider: P.PROVIDERS[p.provider], key: P.cleanKey(p.key) }))
    .filter(p => p.provider && p.key);

  async function call(provider, key, { model, messages, maxTokens }) {
    const req = P.buildRequest(provider, { key, model, messages, maxTokens: Math.min(maxTokens || 1500, MAX_TOKENS) });
    let res;
    try { res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: req.body }); }
    catch { return { ok: false, kind: 'busy' }; }
    const text = await res.text().catch(() => '');
    if (!res.ok) return { ok: false, kind: P.classifyError(res.status, text), status: res.status };
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    const out = P.parseResponse(provider, json);
    return out ? { ok: true, text: out } : { ok: false, kind: 'bad' };
  }

  function checkMessages(messages) {
    if (!Array.isArray(messages) || !messages.length) throw new AiError('bad', 'Nothing to send.');
    if (messages.length > MAX_MESSAGES) throw new AiError('bad', 'That conversation is too long. Start a new one.');
    const clean = messages.map(m => ({ role: ['system', 'user', 'assistant'].includes(m && m.role) ? m.role : 'user', content: String((m && m.content) ?? '') }));
    if (clean.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS) throw new AiError('bad', 'That request is too long.');
    return clean;
  }

  // ---- a person's own key ----
  async function saveKey(uid, raw) {
    const provider = P.detectProvider(raw);
    if (!provider) throw new AiError('unknown', 'I could not tell which service that key is for. Check that you copied the whole key.');
    const key = P.cleanKey(raw);
    // One tiny request proves the key works before it is stored.
    const test = await call(provider, key, { model: provider.fast, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 120 });
    if (!test.ok && test.kind === 'auth') throw new AiError('rejected', `${provider.name} rejected that key. Check that it is switched on and copied in full.`, { provider: provider.id });
    const warning = !test.ok ? (test.kind === 'quota' ? `${provider.name} says this key is out of allowance right now, but it was saved.` : `Saved, but I could not test it just now (${provider.name} did not answer).`) : '';
    await store.putKey(uid, { provider: provider.id, cipher: crypto.encrypt(key), last4: P.last4(key), savedAt: now() });
    return { provider: provider.id, name: provider.name, last4: P.last4(key), warning };
  }

  async function removeKey(uid, providerId) {
    await store.deleteKey(uid, String(providerId || ''));
    return { ok: true };
  }

  // ---- what the app shows ----
  async function status(uid) {
    const own = (await store.listKeys(uid)).map(k => ({ provider: k.provider, name: (P.PROVIDERS[k.provider] || {}).name || k.provider, last4: k.last4 }));
    const used = await store.usage(uid, day());
    return {
      own,
      pool: { available: poolKeys.length > 0 || Boolean(fallback), limit, used, left: Math.max(0, limit - used) },
      providers: P.list(),
    };
  }

  // ---- chat ----
  async function chat(uid, req = {}) {
    const messages = checkMessages(req.messages);
    const chars = messages.reduce((n, m) => n + m.content.length, 0);
    const tier = ['auto', 'fast', 'smart'].includes(req.tier) ? req.tier : 'auto';
    const maxTokens = Math.min(Number(req.maxTokens) || 1500, MAX_TOKENS);

    // 1. their own key, when they have one (their cost, so no daily limit)
    const own = await store.listKeys(uid);
    const pick = own.find(k => k.provider === req.provider) || own[0];
    let ownFailure = null;
    if (pick && P.PROVIDERS[pick.provider]) {
      const provider = P.PROVIDERS[pick.provider];
      const model = P.pickModel(provider, { tier, chars, model: req.model });
      const r = await call(provider, crypto.decrypt(pick.cipher), { model, messages, maxTokens });
      if (r.ok) return { text: r.text, provider: provider.id, model, source: 'own' };
      if (r.kind === 'auth') throw new AiError('rejected', `${provider.name} rejected your saved key. Add a new one on the Vayun website.`, { provider: provider.id });
      if (r.kind === 'model') throw new AiError('model', `${provider.name} does not have a model called "${model}".`, { provider: provider.id });
      ownFailure = r.kind; // out of allowance or busy: fall back to the shared pool below
    }

    // 2. the shared pool, with the daily limit
    if (!poolKeys.length && !fallback) {
      throw new AiError(ownFailure ? 'own-failed' : 'no-key', ownFailure ? 'Your key could not answer just now, and there is no shared allowance to fall back on.' : 'The Assistant needs an API key. Add one on the Vayun website.');
    }
    const d = day();
    const used = await store.addUsage(uid, d, 1); // reserve first so two quick requests cannot slip past the limit
    if (used > limit) {
      await store.addUsage(uid, d, -1);
      throw new AiError('limit', `You have used today's ${limit} free messages. They reset tomorrow, or add your own key on the Vayun website for no limit.`, { limit, used: limit });
    }
    const t = now();
    for (let n = 0; n < poolKeys.length; n++) {
      const i = ((mode === 'priority' ? 0 : rotate) + n) % poolKeys.length;
      if ((cooling.get(i) || 0) > t) continue;
      const entry = poolKeys[i];
      const model = P.pickModel(entry.provider, { tier, chars });
      const r = await call(entry.provider, entry.key, { model, messages, maxTokens });
      if (r.ok) {
        rotate = (i + 1) % poolKeys.length; // the next request starts at the next key
        return { text: r.text, provider: entry.provider.id, model, source: 'pool', limit, used, left: Math.max(0, limit - used) };
      }
      if (r.kind === 'quota' || r.kind === 'auth') cooling.set(i, t + COOL_DOWN_MS);
      // quota, auth, busy, model, bad: all move on to the next key
    }
    // 3. every pool key failed: the project's own Gemini (Vertex AI), billed to the Firebase project
    if (fallback) {
      const model = P.pickModel('gemini', { tier, chars });
      try {
        const text = await fallback({ model, messages, maxTokens });
        if (text) return { text, provider: 'firebase', model, source: 'firebase', limit, used, left: Math.max(0, limit - used) };
      } catch { /* fall through to the busy message */ }
    }
    await store.addUsage(uid, d, -1); // nothing was answered, so it does not count against them
    throw new AiError('busy', 'The Assistant is very busy right now. Please try again in a few minutes.');
  }

  return { saveKey, removeKey, status, chat, AiError };
}

module.exports = { createAiCore, AiError, MAX_CHARS, MAX_MESSAGES, MAX_TOKENS };
