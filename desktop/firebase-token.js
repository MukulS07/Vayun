// Turns the long-lived Firebase refresh token into a fresh one-hour ID token (what Firestore needs to see
// who is asking). https://firebase.google.com/docs/reference/rest/auth#section-refresh-token
const { TeamError } = require('./team-error');

const ENDPOINT = 'https://securetoken.googleapis.com/v1/token';

async function refreshIdToken({ fetch: fetchImpl = globalThis.fetch, apiKey, refreshToken, now = Date.now }) {
  let res;
  try {
    res = await fetchImpl(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    });
  } catch {
    throw new TeamError('Could not reach Google. Check your internet connection.', 'network');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND|INVALID_GRANT/.test(json?.error?.message || '')) {
      throw new TeamError('Your sign-in expired. Sign in again.', 'auth');
    }
    throw new TeamError('Could not refresh your sign-in.', 'network');
  }
  return {
    idToken: json.id_token,
    refreshToken: json.refresh_token || refreshToken, // Google may hand back a new one; keep whichever is newest
    expiresAt: now() + (Number(json.expires_in) || 3600) * 1000 - 60000, // renew a minute early
    uid: json.user_id,
  };
}

module.exports = { refreshIdToken };
