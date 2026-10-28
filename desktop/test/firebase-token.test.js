const test = require('node:test');
const assert = require('node:assert');
const { refreshIdToken } = require('../firebase-token');

const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

test('refreshIdToken posts the refresh token and returns a fresh ID token', async () => {
  let seen;
  const fetch = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ id_token: 'new-id', refresh_token: 'new-refresh', expires_in: '3600', user_id: 'u1' }) }; };
  const r = await refreshIdToken({ fetch, apiKey: 'KEY', refreshToken: 'old-refresh', now: () => 1_000_000 });
  assert.strictEqual(seen.url, 'https://securetoken.googleapis.com/v1/token?key=KEY');
  assert.strictEqual(seen.init.body, 'grant_type=refresh_token&refresh_token=old-refresh');
  assert.deepStrictEqual(r, { idToken: 'new-id', refreshToken: 'new-refresh', expiresAt: 1_000_000 + 3_540_000, uid: 'u1' });
});

test('refreshIdToken keeps the old refresh token when none comes back', async () => {
  const r = await refreshIdToken({ fetch: reply(200, { id_token: 'x', user_id: 'u1' }), apiKey: 'K', refreshToken: 'keep-me' });
  assert.strictEqual(r.refreshToken, 'keep-me');
});

test('refreshIdToken tells expired sign-ins apart from other failures', async () => {
  await assert.rejects(() => refreshIdToken({ fetch: reply(400, { error: { message: 'TOKEN_EXPIRED' } }), apiKey: 'K', refreshToken: 'r' }), e => e.code === 'auth');
  await assert.rejects(() => refreshIdToken({ fetch: reply(400, { error: { message: 'USER_DISABLED' } }), apiKey: 'K', refreshToken: 'r' }), e => e.code === 'auth');
  await assert.rejects(() => refreshIdToken({ fetch: reply(500, {}), apiKey: 'K', refreshToken: 'r' }), e => e.code === 'network');
  await assert.rejects(() => refreshIdToken({ fetch: async () => { throw new Error('offline'); }, apiKey: 'K', refreshToken: 'r' }), e => e.code === 'network');
});
