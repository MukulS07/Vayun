// Vayun's Assistant server: one HTTPS function, "ai", with four calls (all need a signed-in person):
//   POST /ai/status      what the app shows: saved keys (last 4 only), the free allowance left, the provider list
//   POST /ai/saveKey     { key }  finds out which service it is for, tests it, saves it encrypted
//   POST /ai/removeKey   { provider }
//   POST /ai/chat        { messages, tier?, model?, provider? }  answers with the person's own key, or the shared pool
// Secrets (set with `firebase functions:secrets:set`, never in code):
//   ENC_KEY    32 random bytes, base64. Encrypts the saved keys.
//   POOL_KEYS  JSON list of the owner's own keys for the free allowance, for example [{"provider":"nvidia","key":"..."}]
// Setting (optional): AI_DAILY_LIMIT, free messages per person per day when the pool is used (default 20).
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { createAiCore, AiError } = require('./ai-core');
const { createCryptoBox } = require('./crypto-box');
const P = require('./ai-providers');

admin.initializeApp();
const db = admin.firestore();

const ENC_KEY = defineSecret('ENC_KEY');
const POOL_KEYS = defineSecret('POOL_KEYS');
const DAILY_LIMIT = defineString('AI_DAILY_LIMIT', { default: '20' });
const POOL_MODE = defineString('AI_POOL_MODE', { default: 'round-robin' }); // or 'priority'
const FALLBACK = defineString('AI_FALLBACK', { default: 'on' });            // Gemini through this Firebase project when every pool key failed
const VERTEX_LOCATION = defineString('AI_VERTEX_LOCATION', { default: 'us-central1' });

// Saved keys: users/{uid}/aiKeys/{provider}. Usage: aiUsage/{uid}_{day}. Both are closed to every app and website
// (see firestore.rules); only this function reads or writes them.
const store = {
  async listKeys(uid) { return (await db.collection('users').doc(uid).collection('aiKeys').get()).docs.map(d => d.data()); },
  async putKey(uid, rec) { await db.collection('users').doc(uid).collection('aiKeys').doc(rec.provider).set(rec); },
  async deleteKey(uid, provider) { if (provider) await db.collection('users').doc(uid).collection('aiKeys').doc(provider).delete(); },
  async usage(uid, day) { const s = await db.collection('aiUsage').doc(`${uid}_${day}`).get(); return s.exists ? s.data().count || 0 : 0; },
  async addUsage(uid, day, n) {
    const ref = db.collection('aiUsage').doc(`${uid}_${day}`);
    return db.runTransaction(async tx => {
      const s = await tx.get(ref);
      const count = Math.max(0, (s.exists ? s.data().count || 0 : 0) + n);
      tx.set(ref, { count, uid, day, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return count;
    });
  },
};

// The project's own Gemini (Vertex AI). The function's service account is the credential, so there is no key to hold.
// One-time: enable the Vertex AI API and give the function's service account the "Vertex AI User" role (docs/ai-setup.md).
let googleAuth = null;
async function vertexFallback({ model, messages, maxTokens }) {
  if (!googleAuth) { const { GoogleAuth } = require('google-auth-library'); googleAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }); }
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || (await googleAuth.getProjectId());
  const token = await googleAuth.getAccessToken();
  const req = P.buildVertexRequest({ project, location: VERTEX_LOCATION.value() || 'us-central1', model, messages, token, maxTokens });
  const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
  if (!res.ok) throw new Error('vertex ' + res.status);
  return P.parseResponse('gemini', await res.json());
}

let core = null;
function getCore() {
  if (!core) {
    let pool = [];
    try { pool = JSON.parse(POOL_KEYS.value() || '[]'); } catch { pool = []; }
    core = createAiCore({
      store, crypto: createCryptoBox(ENC_KEY.value()), fetch: (...a) => fetch(...a), pool: Array.isArray(pool) ? pool : [],
      mode: POOL_MODE.value() === 'priority' ? 'priority' : 'round-robin',
      fallback: FALLBACK.value() === 'off' ? null : vertexFallback,
      limit: Math.max(1, parseInt(DAILY_LIMIT.value(), 10) || 20),
    });
  }
  return core;
}

// A small per-person speed limit on top of the daily one, so a loop in someone's app cannot hammer the server.
const recent = new Map();
function tooFast(uid) {
  const now = Date.now(), list = (recent.get(uid) || []).filter(t => now - t < 60_000);
  list.push(now); recent.set(uid, list);
  if (recent.size > 5000) recent.clear();
  return list.length > 30;
}

const STATUS_OF = { unknown: 400, rejected: 400, bad: 400, model: 400, limit: 429, 'no-key': 402, 'own-failed': 503, busy: 503 };

exports.ai = onRequest({ region: 'us-central1', secrets: [ENC_KEY, POOL_KEYS], timeoutSeconds: 90, maxInstances: 10, invoker: 'public', cors: true }, async (req, res) => {
  const send = (status, body) => res.status(status).json(body);
  try {
    if (req.method === 'OPTIONS') return void res.status(204).send('');
    const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
    if (!m) return send(401, { error: { code: 'signin', message: 'Sign in to use the Assistant.' } });
    let uid;
    try { uid = (await admin.auth().verifyIdToken(m[1])).uid; } catch { return send(401, { error: { code: 'signin', message: 'Your sign-in has expired. Sign in again.' } }); }
    if (tooFast(uid)) return send(429, { error: { code: 'slow', message: 'Slow down a little and try again in a minute.' } });

    const action = (req.path || '').split('/').filter(Boolean).pop() || 'status';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const c = getCore();
    if (action === 'status') return send(200, await c.status(uid));
    if (action === 'saveKey') return send(200, await c.saveKey(uid, body.key));
    if (action === 'removeKey') return send(200, await c.removeKey(uid, body.provider));
    if (action === 'chat') return send(200, await c.chat(uid, body));
    return send(404, { error: { code: 'unknown', message: 'Unknown request.' } });
  } catch (e) {
    if (e instanceof AiError) return send(STATUS_OF[e.code] || 400, { error: { code: e.code, message: e.message, ...(e.limit ? { limit: e.limit } : {}) } });
    console.error('ai failed:', e && e.code, e && e.message); // never log request bodies: they hold keys and notes
    return send(500, { error: { code: 'server', message: 'Something went wrong on our side. Please try again.' } });
  }
});

// ---- Public forms: one more function, "forms" ----
// A form is published from the app (signed in), shared as a link, filled in by anyone on a plain web page, and pulled
// back into the owner's dashboard. Rules and Firestore cost: forms-core.js. Documents: publicForms/{id} (the form and its
// counters) and publicForms/{id}/responses/{n}; both are closed to every app and website (firestore.rules).
const { createFormsCore, FormsError } = require('./forms-core');
const { renderForm, noticePage } = require('./forms-page');
const crypto = require('node:crypto');

const formsStore = {
  col: () => db.collection('publicForms'),
  async getForm(id) { if (!/^[a-z0-9]{6,20}$/.test(id)) return null; const s = await this.col().doc(id).get(); return s.exists ? { id, ...s.data() } : null; },
  async createForm(id, data) { await this.col().doc(id).create(data); },
  async updateForm(id, patch) { await this.col().doc(id).update(patch); },
  async countForms(uid) { return (await this.col().where('ownerUid', '==', uid).count().get()).data().count; },
  async deleteForm(id) { await db.recursiveDelete(this.col().doc(id)); },
  // One transaction: read the counters, let the rules decide, then write the counters and the response together.
  async addResponse(id, admit) {
    const ref = this.col().doc(id);
    return db.runTransaction(async tx => {
      const s = await tx.get(ref);
      if (!s.exists) return { ok: false, code: 'missing' };
      const verdict = admit(s.data());
      if (!verdict.ok) return verdict;
      tx.update(ref, verdict.patch);
      tx.create(ref.collection('responses').doc(String(verdict.n)), verdict.response);
      return { ok: true };
    });
  },
  async listResponses(id, after, limit) {
    const q = await this.col().doc(id).collection('responses').where('n', '>', after).orderBy('n').limit(limit).get();
    return q.docs.map(d => d.data());
  },
};
const forms = createFormsCore({ store: formsStore });

// A per-visitor speed limit, kept in memory per server instance (a cheap guard, not a guarantee).
const hits = new Map();
function slow(key, max, windowMs) {
  const now = Date.now(), list = (hits.get(key) || []).filter(t => now - t < windowMs);
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}

const FORM_STATUS = { missing: 404, owner: 403, closed: 410, full: 429, busy: 429, big: 413, bad: 400, limit: 400 };

exports.forms = onRequest({ region: 'us-central1', timeoutSeconds: 30, maxInstances: 10, invoker: 'public', cors: true }, async (req, res) => {
  const json = (status, body) => res.status(status).json(body);
  const parts = (req.path || '').split('/').filter(Boolean);
  try {
    if (req.method === 'OPTIONS') return void res.status(204).send('');
    const ip = req.get('x-forwarded-for') ? String(req.get('x-forwarded-for')).split(',')[0].trim() : req.ip || 'x';

    // GET /f/<id>: the page people fill in.
    if (req.method === 'GET' && parts[0] === 'f') {
      if (slow('v:' + ip, 120, 60_000)) return void res.status(429).type('html').send(noticePage('Too many requests', 'Please wait a minute and try again.'));
      const nonce = crypto.randomBytes(12).toString('base64');
      res.set('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'`);
      res.set('Cache-Control', 'no-store');
      try { return void res.status(200).type('html').send(renderForm(parts[1] || '', await forms.view(parts[1]), nonce)); }
      catch (e) { if (e instanceof FormsError) return void res.status(e.code === 'missing' ? 404 : 400).type('html').send(noticePage('Form not found', e.message)); throw e; }
    }

    const action = parts[parts.length - 1];
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    // POST /submit {id, answers}: anyone with the link.
    if (req.method === 'POST' && action === 'submit') {
      if (slow('s:' + ip, 12, 60_000)) return json(429, { error: { code: 'slow', message: 'Please wait a minute before sending again.' } });
      return json(200, await forms.submit(body.id, body.answers));
    }

    // Everything else is the owner's, and needs a Vayun sign-in.
    const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
    if (!m) return json(401, { error: { code: 'signin', message: 'Sign in to publish forms.' } });
    let uid;
    try { uid = (await admin.auth().verifyIdToken(m[1])).uid; } catch { return json(401, { error: { code: 'signin', message: 'Your sign-in has expired. Sign in again.' } }); }
    if (slow('u:' + uid, 60, 60_000)) return json(429, { error: { code: 'slow', message: 'Slow down a little and try again in a minute.' } });
    if (action === 'publish') return json(200, await forms.publish(uid, body));
    if (action === 'pull') return json(200, await forms.pull(uid, body.id, body.after));
    if (action === 'open') return json(200, await forms.setOpen(uid, body.id, body.open));
    if (action === 'remove') return json(200, await forms.remove(uid, body.id));
    return json(404, { error: { code: 'unknown', message: 'Unknown request.' } });
  } catch (e) {
    if (e instanceof FormsError) return json(FORM_STATUS[e.code] || 400, { error: { code: e.code, message: e.message, ...(e.errors ? { errors: e.errors } : {}) } });
    console.error('forms failed:', e && e.code, e && e.message); // never log answers
    return json(500, { error: { code: 'server', message: 'Something went wrong on our side. Please try again.' } });
  }
});
