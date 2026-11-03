// The desktop Assistant's engine (main process). The person pastes a key from any supported service (OpenAI, Claude,
// Gemini, Groq, NVIDIA, OpenRouter, xAI, AI/ML API); the service is worked out from the key. Several keys can be kept,
// one is active, and if it runs out or is down the Assistant quietly tries the others.
// Keys are encrypted with Electron safeStorage and never leave the main process.
const fs = require('node:fs');
const path = require('node:path');
const P = require('./app/ai-providers');

const DEFAULT_MODEL = P.PROVIDERS.nvidia.smart;
const TIERS = ['auto', 'fast', 'smart'];

// Tests may point the assistant at a local fake server; only loopback hosts are accepted so a key can't be sent elsewhere.
function endpointOverride() {
  const o = process.env.PAGES_AI_ENDPOINT;
  if (o) { try { const u = new URL(o); if (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)) return o; } catch { /* ignore */ } }
  return '';
}

// deps: file (where the settings live), safeStorage (isEncryptionAvailable / encryptString / decryptString),
//       fetch (for tests), timeoutMs
function createAi({ file, safeStorage, fetch: fetchImpl = (...a) => fetch(...a), timeoutMs = 60000 }) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const write = c => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(c)); };
  const seal = text => safeStorage.encryptString(text).toString('base64');
  const unseal = b64 => safeStorage.decryptString(Buffer.from(b64, 'base64'));

  // Older versions kept one NVIDIA key as { key, model }. Move it into the new shape the first time it is read.
  function load() {
    const c = read();
    if (c.key && !c.keys) {
      let last4 = '';
      try { last4 = P.last4(unseal(c.key)); } catch { /* unreadable key: shown without its last characters */ }
      c.keys = { nvidia: { cipher: c.key, last4 } };
      c.active = { provider: 'nvidia', tier: 'auto', ...(c.model && c.model !== DEFAULT_MODEL ? { model: c.model } : {}) };
      delete c.key; delete c.model;
      write(c);
    }
    c.keys = c.keys || {};
    const saved = Object.keys(c.keys).filter(id => P.PROVIDERS[id]);
    const a = c.active || {};
    c.active = {
      provider: saved.includes(a.provider) ? a.provider : saved[0] || '',
      tier: TIERS.includes(a.tier) ? a.tier : 'auto',
      ...(a.model ? { model: String(a.model).slice(0, 120) } : {}),
    };
    return c;
  }

  function status() {
    const c = load();
    const saved = Object.keys(c.keys).filter(id => P.PROVIDERS[id]);
    const a = c.active;
    const ap = P.PROVIDERS[a.provider];
    return {
      hasKey: saved.length > 0,
      keys: saved.map(id => ({ provider: id, name: P.PROVIDERS[id].name, last4: c.keys[id].last4 || '' })),
      active: { provider: a.provider, name: ap ? ap.name : '', tier: a.tier, model: a.model || '' },
      // what the model picker offers: only the services that have a key
      choices: saved.map(id => ({ provider: id, name: P.PROVIDERS[id].name, fast: P.PROVIDERS[id].fast, smart: P.PROVIDERS[id].smart, models: P.PROVIDERS[id].models.slice() })),
      providers: P.list(),
      model: ap ? (a.model || P.pickModel(ap, { tier: a.tier })) : '', // the model in use right now, for display
      models: ap ? ap.models.slice() : [],
    };
  }

  async function ask(provider, key, { model, messages, maxTokens = 2000 }) {
    const req = P.buildRequest(provider, { key, model, messages, maxTokens, temperature: 0.2 });
    const over = endpointOverride();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(over || req.url, { method: 'POST', headers: req.headers, body: req.body, signal: ctrl.signal });
      const text = await res.text().catch(() => '');
      if (!res.ok) return { ok: false, kind: P.classifyError(res.status, text), status: res.status };
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      const out = P.parseResponse(provider, json);
      return out ? { ok: true, text: out } : { ok: false, kind: 'bad' };
    } catch (e) {
      return { ok: false, kind: e && e.name === 'AbortError' ? 'timeout' : 'offline' };
    } finally { clearTimeout(timer); }
  }

  // Pasting a key: find out whose it is, prove it works with one tiny request, then keep it encrypted.
  async function setKey(raw) {
    const provider = P.detectProvider(raw);
    if (!provider) return { error: 'I could not tell which service that key is for. Check that you copied the whole key.' };
    if (!safeStorage.isEncryptionAvailable()) return { error: 'Secure storage is not available on this PC, so the key was not saved.' };
    const key = P.cleanKey(raw);
    const test = await ask(provider, key, { model: provider.fast, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 120 });
    if (!test.ok && test.kind === 'auth') return { error: `${provider.name} rejected that key. Check that it is switched on and copied in full.` };
    const c = load();
    c.keys[provider.id] = { cipher: seal(key), last4: P.last4(key) };
    if (!c.active.provider) c.active.provider = provider.id;
    write(c);
    const warning = test.ok ? '' : test.kind === 'offline' || test.kind === 'timeout'
      ? `Saved, but I could not reach ${provider.name} to test it.`
      : test.kind === 'quota' ? `${provider.name} says this key is out of allowance right now, but it was saved.` : '';
    return { ...status(), added: { provider: provider.id, name: provider.name, last4: P.last4(key) }, warning };
  }

  function removeKey(providerId) {
    const c = load();
    delete c.keys[String(providerId || '')];
    if (!c.keys[c.active.provider]) c.active.provider = Object.keys(c.keys)[0] || '';
    delete c.active.model;
    write(c);
    return status();
  }

  // The service, answer style and (optionally) an exact model to use. A model typed by hand is kept as given.
  function select({ provider, tier, model } = {}) {
    const c = load();
    if (provider && c.keys[provider] && P.PROVIDERS[provider]) { if (provider !== c.active.provider) delete c.active.model; c.active.provider = provider; }
    if (TIERS.includes(tier)) { c.active.tier = tier; if (model === undefined) delete c.active.model; }
    if (model !== undefined) { const m = String(model || '').trim().slice(0, 120); if (m) c.active.model = m; else delete c.active.model; }
    write(c);
    return status();
  }

  // messages: [{ role: 'system' | 'user' | 'assistant', content }] from the renderer; checked before sending.
  async function chat(messages) {
    if (!Array.isArray(messages) || !messages.length || messages.length > 30) return { error: 'Bad request.' };
    const clean = messages.map(m => ({ role: ['system', 'user', 'assistant'].includes(m && m.role) ? m.role : 'user', content: String((m && m.content) ?? '').slice(0, 24000) }));
    const c = load();
    const order = [c.active.provider, ...Object.keys(c.keys).filter(id => id !== c.active.provider)].filter(id => c.keys[id] && P.PROVIDERS[id]);
    if (!order.length) return { error: 'Add an API key first.' };
    const chars = clean.reduce((n, m) => n + m.content.length, 0);
    let firstProblem = '';
    for (const id of order) {
      const provider = P.PROVIDERS[id];
      let key;
      try { key = unseal(c.keys[id].cipher); } catch { firstProblem = firstProblem || `The saved ${provider.name} key could not be read. Add it again.`; continue; }
      const model = id === c.active.provider && c.active.model ? c.active.model : P.pickModel(provider, { tier: c.active.tier, chars });
      const r = await ask(provider, key, { model, messages: clean });
      if (r.ok) return { content: r.text, provider: id, model, ...(id !== c.active.provider ? { switchedFrom: c.active.provider } : {}) };
      if (!firstProblem) {
        firstProblem = r.kind === 'auth' ? `${provider.name} rejected the key. Check it or add a new one.`
          : r.kind === 'model' ? `${provider.name} does not have a model called "${model}". Pick another model.`
          : r.kind === 'quota' ? `${provider.name} says the key is out of allowance.`
          : r.kind === 'timeout' ? 'The request took too long and was stopped.'
          : r.kind === 'offline' ? `Could not reach ${provider.name}. Check your internet connection.`
          : `${provider.name} could not answer just now.`;
      }
    }
    return { error: firstProblem };
  }

  return { status, setKey, removeKey, select, chat };
}

// The real one, built the first time it is needed (Electron is only available inside the app).
let real = null;
function app() {
  if (!real) {
    const { app: electronApp, safeStorage } = require('electron');
    real = createAi({ file: path.join(electronApp.getPath('userData'), 'ai.json'), safeStorage });
  }
  return real;
}

module.exports = {
  createAi,
  status: () => app().status(),
  setKey: key => app().setKey(key),
  removeKey: provider => app().removeKey(provider),
  select: sel => app().select(sel),
  chat: messages => app().chat(messages),
  DEFAULT_MODEL,
};
