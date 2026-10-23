const test = require('node:test');
const assert = require('node:assert');
const {
  parseEnv,
  normalizeConfig,
  validateConfig,
  sanitizeUser,
  generateAuthHtml,
} = require('../auth-logic');

test('auth-logic: parseEnv parses .env formats properly', () => {
  const sample = `
# Comment line
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyA_test-123
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="my-app.firebaseapp.com"
NEXT_PUBLIC_FIREBASE_PROJECT_ID='my-app'
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=my-app.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef
`;
  const env = parseEnv(sample);
  assert.strictEqual(env.NEXT_PUBLIC_FIREBASE_API_KEY, 'AIzaSyA_test-123');
  assert.strictEqual(env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, 'my-app.firebaseapp.com');
  assert.strictEqual(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'my-app');
  assert.strictEqual(env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, 'my-app.appspot.com');
  assert.strictEqual(env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, '123456789');
  assert.strictEqual(env.NEXT_PUBLIC_FIREBASE_APP_ID, '1:123456789:web:abcdef');
});

test('auth-logic: validateConfig detects missing and placeholder values', () => {
  const placeholder = {
    apiKey: 'your_api_key',
    authDomain: 'your_project.firebaseapp.com',
    projectId: 'your_project_id',
    appId: 'your_app_id',
  };
  const res1 = validateConfig(placeholder);
  assert.strictEqual(res1.valid, false);
  assert.ok(res1.missing.includes('apiKey'));

  const validConfig = {
    NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaSyRealKey12345',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'real-app.firebaseapp.com',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'real-app',
    NEXT_PUBLIC_FIREBASE_APP_ID: '1:987654321:web:fedcba',
  };
  const res2 = validateConfig(validConfig);
  assert.strictEqual(res2.valid, true);
  assert.strictEqual(res2.config.apiKey, 'AIzaSyRealKey12345');
});

test('auth-logic: sanitizeUser extracts clean user details and defaults displayName', () => {
  assert.strictEqual(sanitizeUser(null), null);
  assert.strictEqual(sanitizeUser({}), null);

  const u1 = sanitizeUser({
    uid: 'google-uid-123',
    email: 'mukul@example.com',
    displayName: 'Mukul Sharma',
    photoURL: 'https://lh3.googleusercontent.com/avatar.jpg',
  });
  assert.strictEqual(u1.uid, 'google-uid-123');
  assert.strictEqual(u1.email, 'mukul@example.com');
  assert.strictEqual(u1.displayName, 'Mukul Sharma');
  assert.strictEqual(u1.photoURL, 'https://lh3.googleusercontent.com/avatar.jpg');

  // Fallback displayName from email
  const u2 = sanitizeUser({
    uid: 'uid-456',
    email: 'alex@company.org',
  });
  assert.strictEqual(u2.displayName, 'alex');
});

test('auth-logic: generateAuthHtml embeds the configuration securely', () => {
  const config = {
    apiKey: 'test-key',
    authDomain: 'test.firebaseapp.com',
    projectId: 'test-proj',
    appId: 'test-app',
  };
  const html = generateAuthHtml(config, 8080);
  assert.ok(html.includes('"apiKey":"test-key"'));
  assert.ok(html.includes('Continue with Google'));
  assert.ok(html.includes('signInWithPopup'));
});
