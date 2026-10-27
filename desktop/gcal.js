// Google Calendar link (main process). OAuth runs in the user's browser against a loopback server;
// the refresh token is encrypted with Electron safeStorage and never reaches the renderer.
const { app, BrowserWindow, safeStorage, shell } = require('electron');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('./auth-logic');
const L = require('./gcal-logic');
const { fromGoogleEvent, toGoogleEvent, normalizeEventInput, isDate, addDays } = require('./app/calendar-logic');

const tokenFile = () => path.join(app.getPath('userData'), 'gcal.json');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };

let access = null; // { token, expires }
let refreshing = null;
let activeServer = null;

function loadConfig() {
  let cfg = {};
  for (const envPath of [path.join(__dirname, '.env.local'), path.join(__dirname, '.env'), path.join(path.dirname(__dirname), '.env.local'), path.join(path.dirname(__dirname), '.env')]) {
    try { if (fs.existsSync(envPath)) cfg = { ...parseEnv(fs.readFileSync(envPath, 'utf8')), ...cfg }; } catch { /* ignore */ }
  }
  // .env files win over process.env; with neither, the client bundled with Vayun is used.
  return L.normalizeGcalConfig({ ...process.env, ...cfg });
}

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

function notify(st) {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('gcal:changed', st);
}

function status() {
  const cfg = loadConfig();
  const v = L.validateGcalConfig(cfg);
  const t = readToken();
  return { isConfigured: v.valid, connected: Boolean(t), email: t?.email || '' };
}

async function tokenRequest(params) {
  const r = await fetch(L.TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, body };
}

function connect() {
  return new Promise(resolve => {
    const cfg = loadConfig();
    if (!L.validateGcalConfig(cfg).valid) return resolve({ error: 'Google sign-in for Calendar is not available in this build of Vayun yet.' });
    if (!safeStorage.isEncryptionAvailable()) return resolve({ error: 'Secure storage is not available on this PC, so Google Calendar cannot be linked.' });
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
        page(res, 200, 'Google Calendar was not linked. You can close this tab.');
        return finish({ error: err === 'access_denied' ? 'You declined access to Google Calendar.' : `Google returned: ${err}` });
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
        page(res, 200, 'Vayun is linked to Google Calendar. You can close this tab.');
        finish({ ok: true, email });
      } catch (e) {
        page(res, 500, 'Linking failed. Go back to Vayun for details.');
        finish({ error: `Could not link Google Calendar: ${e.message}` });
      }
    });
    const timer = setTimeout(() => finish({ error: 'Linking timed out. Please try again.' }), 300000);
    server.on('error', e => finish({ error: `Could not start the local sign-in server: ${e.message}` }));
    server.listen(0, '127.0.0.1', () => {
      activeServer = server;
      redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
      let loginHint = '';
      try { loginHint = require('./auth').getUser()?.email || ''; } catch { /* not signed in */ }
      shell.openExternal(L.buildAuthUrl({ clientId: cfg.clientId, redirectUri, state, challenge, loginHint }));
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

// One refresh at a time; concurrent calls share it.
async function accessToken() {
  if (access && access.expires > Date.now()) return access.token;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const t = readToken();
    if (!t) throw Object.assign(new Error('Google Calendar is not linked.'), { disconnected: true });
    const cfg = loadConfig();
    const { ok, body } = await tokenRequest({ refresh_token: t.refresh, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' });
    if (!ok) {
      if (body.error === 'invalid_grant' || body.error === 'invalid_client') { clearToken(); notify(status()); throw Object.assign(new Error('Google access was revoked or expired. Link Google Calendar again.'), { disconnected: true }); }
      throw new Error(body.error_description || 'Could not refresh Google access.');
    }
    access = { token: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 - 60000 };
    return access.token;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function api(method, pathname, { query, body } = {}, retried = false) {
  const token = await accessToken();
  const url = `${L.API_BASE}${pathname}${query ? '?' + new URLSearchParams(query) : ''}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      method, signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && !retried) { access = null; return api(method, pathname, { query, body }, true); }
    if (r.status === 204) return {};
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error?.message || `Google Calendar error ${r.status}`);
    return json;
  } finally { clearTimeout(timer); }
}

const wrap = fn => async (...args) => {
  try { return await fn(...args); }
  catch (e) { return { error: e.name === 'AbortError' ? 'Google Calendar took too long to answer.' : e.message || 'Could not reach Google Calendar.', disconnected: Boolean(e.disconnected) }; }
};
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// range: { from, to } inclusive dates. Recurring events are expanded into single instances.
const list = wrap(async range => {
  if (!isDate(range?.from) || !isDate(range?.to) || range.to < range.from) return { error: 'Bad range.' };
  const events = [];
  let pageToken;
  for (let i = 0; i < 5; i++) {
    const query = {
      timeMin: new Date(range.from + 'T00:00:00').toISOString(),
      timeMax: new Date(addDays(range.to, 1) + 'T00:00:00').toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
      ...(pageToken && { pageToken }),
    };
    const r = await api('GET', '/calendars/primary/events', { query });
    for (const g of r.items || []) { const e = fromGoogleEvent(g); if (e) events.push(e); }
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  return { events };
});

const create = wrap(async input => {
  const e = normalizeEventInput(input);
  if (e.error) return e;
  return { event: fromGoogleEvent(await api('POST', '/calendars/primary/events', { body: toGoogleEvent(e, localZone()) })) };
});

const update = wrap(async (googleId, input) => {
  if (!L.isGoogleId(googleId)) return { error: 'Bad event id.' };
  const e = normalizeEventInput(input);
  if (e.error) return e;
  // PATCH with both start and end replaces them; switching all-day <-> timed needs the other key nulled.
  const body = toGoogleEvent(e, localZone());
  if (e.allDay) { body.start.dateTime = null; body.end.dateTime = null; } else { body.start.date = null; body.end.date = null; }
  return { event: fromGoogleEvent(await api('PATCH', `/calendars/primary/events/${encodeURIComponent(googleId)}`, { body })) };
});

const remove = wrap(async googleId => {
  if (!L.isGoogleId(googleId)) return { error: 'Bad event id.' };
  await api('DELETE', `/calendars/primary/events/${encodeURIComponent(googleId)}`);
  return { ok: true };
});

// Only Google Calendar links are opened from the renderer.
function openLink(link) {
  try {
    const u = new URL(String(link));
    if (u.protocol === 'https:' && (u.hostname === 'www.google.com' || u.hostname === 'calendar.google.com')) shell.openExternal(u.href);
  } catch { /* ignore */ }
}

module.exports = { status, connect, disconnect, list, create, update, remove, openLink };
