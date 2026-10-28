// Firebase Authentication pure logic & helpers
// Parses configs, validates credentials, sanitizes users, and generates the OAuth loopback HTML.

function parseEnv(content) {
  if (typeof content !== 'string') return {};
  const res = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    const match = trimmed.match(/^["']?([\w.-]+)["']?\s*[:=]\s*(.*)$/);
    if (!match) continue;
    let [, key, val] = match;
    val = val.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    res[key] = val;
  }
  return res;
}

// The Firebase web API key is a public project identifier, but it is kept out of git so key scanners
// (and people reading the repo) never see it. It lives in a git-ignored desktop/firebase-config.json that is
// packaged into the app; CI writes it from the FIREBASE_API_KEY repository secret. Without it the app asks
// for a Firebase config in its settings dialog.
function bundledApiKey() {
  try { return String(require('./firebase-config.json').apiKey || ''); } catch { return ''; }
}

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: bundledApiKey(),
  authDomain: 'vayun-12d1b.firebaseapp.com',
  projectId: 'vayun-12d1b',
  storageBucket: 'vayun-12d1b.firebasestorage.app',
  messagingSenderId: '578293090527',
  appId: '1:578293090527:web:cce43dac8af2c70a94816a',
};

function normalizeConfig(raw = {}) {
  const get = (fallback, ...keys) => {
    for (const k of keys) {
      if (raw[k] && typeof raw[k] === 'string' && raw[k].trim()) return raw[k].trim();
    }
    return fallback || '';
  };

  return {
    apiKey: get(DEFAULT_FIREBASE_CONFIG.apiKey, 'NEXT_PUBLIC_FIREBASE_API_KEY', 'FIREBASE_API_KEY', 'apiKey'),
    authDomain: get(DEFAULT_FIREBASE_CONFIG.authDomain, 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'FIREBASE_AUTH_DOMAIN', 'authDomain'),
    projectId: get(DEFAULT_FIREBASE_CONFIG.projectId, 'NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'FIREBASE_PROJECT_ID', 'projectId'),
    storageBucket: get(DEFAULT_FIREBASE_CONFIG.storageBucket, 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'FIREBASE_STORAGE_BUCKET', 'storageBucket'),
    messagingSenderId: get(DEFAULT_FIREBASE_CONFIG.messagingSenderId, 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_MESSAGING_SENDER_ID', 'messagingSenderId'),
    appId: get(DEFAULT_FIREBASE_CONFIG.appId, 'NEXT_PUBLIC_FIREBASE_APP_ID', 'FIREBASE_APP_ID', 'appId'),
  };
}

function isPlaceholder(val) {
  if (!val) return true;
  return /^(your_.*|YOUR_.*|<.*>)$/.test(val.trim());
}

function validateConfig(config) {
  const normalized = normalizeConfig(config);
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const missing = [];

  for (const req of required) {
    if (!normalized[req] || isPlaceholder(normalized[req])) {
      missing.push(req);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    config: normalized,
  };
}

function sanitizeUser(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const uid = String(raw.uid || '').trim();
  if (!uid) return null;

  return {
    uid,
    email: raw.email ? String(raw.email).trim() : '',
    displayName: raw.displayName ? String(raw.displayName).trim() : (raw.email ? String(raw.email).split('@')[0] : 'User'),
    photoURL: raw.photoURL ? String(raw.photoURL).trim() : null,
    providerId: raw.providerId || 'google.com',
  };
}

function generateAuthHtml(firebaseConfig, port) {
  const safeConfig = JSON.stringify(firebaseConfig);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vayun · Sign in with Google</title>
  <style>
    :root {
      --bg: #0C0D0D;
      --card: #141716;
      --border: #242927;
      --fg: #E8ECE6;
      --muted: #8E9B93;
      --accent: #A2E3C4;
      --accent-hover: #B8EDD4;
      --err: #FF8A80;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--fg);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 380px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px 28px;
      text-align: center;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.4);
    }
    .logo {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      margin-bottom: 16px;
      display: inline-block;
    }
    h1 {
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.01em;
      margin-bottom: 8px;
    }
    p {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      background: #FFFFFF;
      color: #1F1F1F;
      border: 1px solid #D1D5DB;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, transform 0.05s;
    }
    .btn:hover:not(:disabled) {
      background: #F3F4F6;
    }
    .btn:active:not(:disabled) {
      transform: scale(0.99);
    }
    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .g-icon {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    .error {
      margin-top: 16px;
      font-size: 13px;
      color: var(--err);
      line-height: 1.4;
      background: rgba(255, 138, 128, 0.08);
      border: 1px solid rgba(255, 138, 128, 0.2);
      border-radius: 6px;
      padding: 8px 12px;
      display: none;
    }
    .success {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .success-mark {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: rgba(162, 227, 196, 0.15);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: bold;
    }
    .browser-hint {
      margin-top: 18px;
      font-size: 12px;
      color: var(--muted);
    }
    .browser-hint a {
      color: var(--accent);
      text-decoration: none;
    }
    .browser-hint a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="card">
    <div id="login-view">
      <svg class="logo" viewBox="0 0 44 44" fill="none">
        <rect width="44" height="44" rx="10" fill="#1C211F"/>
        <path d="M12 14 L22 32 L32 14" stroke="#A2E3C4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h1>Sign in to Vayun</h1>
      <div style="font-size: 11px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px;">by Maytrix</div>
      <p>Connect your Google account to sync your profile and access online features.</p>
      <button id="google-btn" class="btn" type="button">
        <svg class="g-icon" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
        <span>Continue with Google</span>
      </button>
      <div id="error-msg" class="error"></div>
      <div class="browser-hint">
        Sign-in opens a secure Google authorization prompt.
      </div>
    </div>

    <div id="success-view" class="success">
      <div class="success-mark">✓</div>
      <h1>Signed in successfully</h1>
      <p id="welcome-msg">Welcome to Vayun! You can return to the desktop app now.</p>
    </div>
  </div>

  <script type="module">
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
    import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

    const config = ${safeConfig};
    const app = initializeApp(config);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');

    const btn = document.getElementById('google-btn');
    const errBox = document.getElementById('error-msg');
    const loginView = document.getElementById('login-view');
    const successView = document.getElementById('success-view');
    const welcomeMsg = document.getElementById('welcome-msg');

    function showError(msg) {
      errBox.textContent = msg;
      errBox.style.display = 'block';
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Continue with Google';
    }

    async function handleLogin() {
      btn.disabled = true;
      btn.querySelector('span').textContent = 'Connecting to Google...';
      errBox.style.display = 'none';

      try {
        const cred = await signInWithPopup(auth, provider);
        const user = cred.user;
        const idToken = await user.getIdToken();

        const payload = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          idToken
        };

        const res = await fetch('/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Could not save login session');

        loginView.style.display = 'none';
        welcomeMsg.textContent = 'Welcome, ' + (user.displayName || user.email) + '! You can return to Vayun now.';
        successView.style.display = 'flex';

        setTimeout(() => {
          window.close();
        }, 1500);
      } catch (err) {
        console.error('Login error:', err);
        let msg = err.message || 'Sign in failed. Please try again.';
        if (err.code === 'auth/popup-closed-by-user') {
          msg = 'Sign-in cancelled. Click the button to try again.';
        } else if (err.code === 'auth/unauthorized-domain') {
          msg = 'Firebase error: localhost is not in the list of authorized domains in Firebase Console.';
        }
        showError(msg);
      }
    }

    btn.addEventListener('click', handleLogin);
    // Auto-trigger if clicked from Electron
    if (window.location.search.includes('auto=1')) {
      handleLogin();
    }
  </script>
</body>
</html>`;
}

module.exports = {
  parseEnv,
  normalizeConfig,
  validateConfig,
  sanitizeUser,
  generateAuthHtml,
};
