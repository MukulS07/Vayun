// Live Google Form sync (main process). Same shape as gcal.js: sign in to Google in the user's browser against a
// loopback server, keep the refresh token encrypted with Electron safeStorage, and read the form's questions and
// responses with a read-only access token. Nothing goes through Vayun's servers or Firebase: Google -> this computer.
const { app, BrowserWindow, safeStorage, shell } = require('electron');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./gcal-logic');
const S = require('./app/gform-sync-logic');
const { loadConfig } = require('./gcal');

const tokenFile = () => path.join(app.getPath('userData'), 'gforms.json');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const SCOPES = [...S.SCOPES, 'openid', 'email'];

let access = null; // { token, expires }
let refreshing = null;
let activeServer = null;

function readToken() {
  const t = readJson(tokenFile());
  if (!t.refresh) return null;
  try { return { refresh: safeStorage.decryptString(Buffer.from(t.refresh, 'base64')), email: t.email || '' }; }
  catch { return null; }
}
function writeToken(refresh, email) {
  fs.writeFileSync(tokenFile(), JSON.stringify({ refresh: safeStorage.encryptString(refresh).toString('base64'), email, updatedAt: Date.now() }));
}
function clearToken() {
  access = null;
  try { fs.unlinkSync(tokenFile()); } catch { /* ignore */ }
}
const notify = st => { for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('gform:changed', st); };

function status() {
  const t = readToken();
  return { isConfigured: L.validateGcalConfig(loadConfig()).valid, connected: Boolean(t), email: t?.email || '' };
}

async function tokenRequest(params) {
  const r = await fetch(L.TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  return { ok: r.ok, body: await r.json().catch(() => ({})) };
}

function connect() {
  return new Promise(resolve => {
    const cfg = loadConfig();
    if (!L.validateGcalConfig(cfg).valid) return resolve({ error: 'Google sign-in is not available in this build of Vayun yet.' });
    if (!safeStorage.isEncryptionAvailable()) return resolve({ error: 'Secure storage is not available on this computer, so Google cannot be linked.' });
    if (activeServer) { try { activeServer.close(); } catch { /* ignore */ } activeServer = null; }

    const state = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = L.makePkce();
    let redirectUri = '';
    let finished = false;
    const page = (res, code, text) => {
      res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Vayun</title><body style="font:16px system-ui;background:#0C0D0D;color:#E9EEE6;display:grid;place-items:center;height:100vh;margin:0"><p>${text}</p></body>`);
    };
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      setTimeout(() => { try { server.close(); } catch { /* ignore */ } if (activeServer === server) activeServer = null; }, 300);
      if (result.ok) notify(status());
      resolve(result);
    };
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, redirectUri || 'http://127.0.0.1');
      if (url.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      if (url.searchParams.get('state') !== state) return page(res, 400, 'This sign-in link is stale. Go back to Vayun and try again.');
      const err = url.searchParams.get('error');
      if (err) {
        page(res, 200, 'Google Forms was not linked. You can close this tab.');
        return finish({ error: err === 'access_denied' ? 'You declined access to your Google Forms.' : `Google returned: ${err}` });
      }
      try {
        const { ok, body } = await tokenRequest({
          code: url.searchParams.get('code') || '', client_id: cfg.clientId, client_secret: cfg.clientSecret,
          redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
        });
        if (!ok || !body.refresh_token) throw new Error(body.error_description || body.error || 'No refresh token was returned.');
        const email = L.emailFromIdToken(body.id_token);
        writeToken(body.refresh_token, email);
        access = { token: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 - 60000 };
        page(res, 200, 'Vayun can now read your Google Form responses. You can close this tab.');
        finish({ ok: true, email });
      } catch (e) {
        page(res, 500, 'Linking failed. Go back to Vayun for details.');
        finish({ error: `Could not link Google: ${e.message}` });
      }
    });
    const timer = setTimeout(() => finish({ error: 'Linking timed out. Please try again.' }), 300000);
    server.on('error', e => finish({ error: `Could not start the local sign-in server: ${e.message}` }));
    server.listen(0, '127.0.0.1', () => {
      activeServer = server;
      redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
      let loginHint = '';
      try { loginHint = require('./auth').getUser()?.email || ''; } catch { /* not signed in */ }
      shell.openExternal(L.buildAuthUrl({ clientId: cfg.clientId, redirectUri, state, challenge, loginHint, scopes: SCOPES }));
    });
  });
}

async function disconnect() {
  const t = readToken();
  clearToken();
  if (t) fetch(`${L.REVOKE_ENDPOINT}?token=${encodeURIComponent(t.refresh)}`, { method: 'POST' }).catch(() => {});
  const st = status();
  notify(st);
  return st;
}

async function accessToken() {
  if (access && access.expires > Date.now()) return access.token;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const t = readToken();
    if (!t) throw Object.assign(new Error('Google is not linked.'), { disconnected: true });
    const cfg = loadConfig();
    const { ok, body } = await tokenRequest({ refresh_token: t.refresh, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' });
    if (!ok) {
      if (body.error === 'invalid_grant' || body.error === 'invalid_client') { clearToken(); notify(status()); throw Object.assign(new Error('Google access was revoked or expired. Connect Google again.'), { disconnected: true }); }
      throw new Error(body.error_description || 'Could not refresh Google access.');
    }
    access = { token: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 - 60000 };
    return access.token;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function fetchJson(url, retried = false) {
  const token = await accessToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (r.status === 401 && !retried) { access = null; return fetchJson(url, true); }
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } finally { clearTimeout(timer); }
}

// input: { formId, since } -> { form, responses } | { error, disconnected? }
async function fetchResponses(input) {
  const id = S.parseFormId(input && input.formId);
  if (id.error) return { error: id.error };
  try { return await S.fetchAll(fetchJson, id.id, { since: typeof input.since === 'string' ? input.since : '' }); }
  catch (e) { return { error: e.name === 'AbortError' ? 'Google took too long to answer.' : e.message || 'Could not reach Google.', disconnected: Boolean(e.disconnected) }; }
}

module.exports = { status, connect, disconnect, fetchResponses };
