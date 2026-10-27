// Google Calendar OAuth helpers (no Electron), so tests can cover them.
// Desktop OAuth clients use a loopback redirect plus PKCE; see
// https://developers.google.com/identity/protocols/oauth2/native-app
const crypto = require('node:crypto');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const API_BASE = 'https://www.googleapis.com/calendar/v3';
// calendar.events: read and write events on the user's calendars. openid+email: show which account is linked.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'openid', 'email'];

// Vayun's own Google OAuth client (type "Desktop app"), shipped in the app so people only click
// "Sign in with Google". Google treats a desktop client secret as public, so bundling it is expected:
// https://developers.google.com/identity/protocols/oauth2/native-app
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in desktop/.env.local override it for development.
const DEFAULT_GCAL_CLIENT = {
  clientId: '',
  clientSecret: '',
};

const isPlaceholder = v => !v || /^(your_.*|YOUR_.*|<.*>)$/.test(v.trim());

function normalizeGcalConfig(raw = {}) {
  const get = (...keys) => {
    for (const k of keys) if (typeof raw[k] === 'string' && raw[k].trim() && !isPlaceholder(raw[k])) return raw[k].trim();
    return '';
  };
  const clientId = get('GOOGLE_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID', 'clientId');
  // An override replaces the whole pair: a secret only matches the client that issued it.
  if (clientId) return { clientId, clientSecret: get('GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_SECRET', 'clientSecret') };
  return { ...DEFAULT_GCAL_CLIENT };
}

function validateGcalConfig(cfg) {
  const missing = [];
  if (isPlaceholder(cfg.clientId) || !/\.apps\.googleusercontent\.com$/.test(cfg.clientId)) missing.push('clientId');
  if (isPlaceholder(cfg.clientSecret)) missing.push('clientSecret');
  return { valid: !missing.length, missing };
}

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function makePkce() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

function buildAuthUrl({ clientId, redirectUri, state, challenge, loginHint }) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline', // gives a refresh token so the link survives restarts
    prompt: 'consent',
    include_granted_scopes: 'true',
    ...(loginHint && { login_hint: loginHint }), // preselects the account already signed in to Vayun
  });
  return `${AUTH_ENDPOINT}?${q}`;
}

// Email from the id_token Google returned over TLS from its own token endpoint; display only.
function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64').toString('utf8'));
    return typeof payload.email === 'string' ? payload.email : '';
  } catch { return ''; }
}

// The event id Google returns is base32hex; anything else from the renderer is refused.
const isGoogleId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,1024}$/.test(id);

module.exports = { DEFAULT_GCAL_CLIENT, AUTH_ENDPOINT, TOKEN_ENDPOINT, REVOKE_ENDPOINT, API_BASE, SCOPES, normalizeGcalConfig, validateGcalConfig, makePkce, buildAuthUrl, emailFromIdToken, isGoogleId };
