// Firebase Authentication Manager for Electron (Main Process)
const { app, BrowserWindow, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseEnv,
  normalizeConfig,
  validateConfig,
  sanitizeUser,
  generateAuthHtml,
} = require('./auth-logic');

const configFile = () => path.join(app.getPath('userData'), 'firebase.json');
const sessionFile = () => path.join(app.getPath('userData'), 'auth-session.json');

let activeServer = null;

function loadConfig() {
  let cfg = {};

  // 1. Check user-configured override file
  try {
    if (fs.existsSync(configFile())) {
      cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    }
  } catch { /* ignore */ }

  // 2. Check desktop/.env.local or desktop/.env
  const envCandidates = [
    path.join(__dirname, '.env.local'),
    path.join(__dirname, '.env'),
    path.join(path.dirname(__dirname), '.env.local'),
    path.join(path.dirname(__dirname), '.env'),
  ];

  for (const envPath of envCandidates) {
    try {
      if (fs.existsSync(envPath)) {
        const parsed = parseEnv(fs.readFileSync(envPath, 'utf8'));
        cfg = { ...parsed, ...cfg };
      }
    } catch { /* ignore */ }
  }

  // 3. Fallback to process.env
  cfg = { ...process.env, ...cfg };

  return normalizeConfig(cfg);
}

function getUser() {
  try {
    if (fs.existsSync(sessionFile())) {
      const data = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'));
      return sanitizeUser(data.user);
    }
  } catch { /* ignore */ }
  return null;
}

function saveUser(user, idToken) {
  const sanitized = sanitizeUser(user);
  if (!sanitized) return null;
  const payload = {
    user: sanitized,
    idToken: idToken || null,
    updatedAt: Date.now(),
  };
  fs.writeFileSync(sessionFile(), JSON.stringify(payload, null, 2), 'utf8');
  return sanitized;
}

function clearUser() {
  try {
    if (fs.existsSync(sessionFile())) {
      fs.unlinkSync(sessionFile());
    }
  } catch { /* ignore */ }
}

function status() {
  const cfg = loadConfig();
  const val = validateConfig(cfg);
  const user = getUser();

  return {
    isConfigured: val.valid,
    missing: val.missing,
    user,
    config: {
      projectId: cfg.projectId || '',
      authDomain: cfg.authDomain || '',
    },
  };
}

function setConfig(newConfig) {
  const normalized = normalizeConfig(newConfig || {});
  fs.writeFileSync(configFile(), JSON.stringify(normalized, null, 2), 'utf8');
  return status();
}

function clearConfig() {
  try {
    if (fs.existsSync(configFile())) fs.unlinkSync(configFile());
  } catch { /* ignore */ }
  return status();
}

function signOut() {
  clearUser();
  notifyWindows('auth:changed', null);
  return { ok: true };
}

function notifyWindows(channel, ...args) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}

function signIn() {
  return new Promise((resolve) => {
    const st = status();
    if (!st.isConfigured) {
      return resolve({
        error: `Firebase configuration is incomplete. Missing: ${st.missing.join(', ')}. Set them in .env.local or app settings.`,
      });
    }

    // Close any previous in-flight auth server
    if (activeServer) {
      try { activeServer.close(); } catch { /* ignore */ }
      activeServer = null;
    }

    const cfg = loadConfig();

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === 'GET' && url.pathname === '/') {
        const html = generateAuthHtml(cfg);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'self' 'unsafe-inline' https://*.firebase.com https://*.googleapis.com https://*.gstatic.com https://accounts.google.com https://apis.google.com; connect-src *; img-src * data:; frame-src *; script-src 'self' 'unsafe-inline' https://*.gstatic.com https://apis.google.com;",
        });
        return res.end(html);
      }

      if (req.method === 'POST' && url.pathname === '/callback') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const user = saveUser(data, data.idToken);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));

            notifyWindows('auth:changed', user);

            setTimeout(() => {
              cleanup();
              resolve({ ok: true, user });
            }, 600);
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    function cleanup() {
      if (server) {
        try { server.close(); } catch { /* ignore */ }
        if (activeServer === server) activeServer = null;
      }
    }

    // Auto-timeout after 5 minutes
    const timer = setTimeout(() => {
      cleanup();
      resolve({ error: 'Sign in timed out. Please try again.' });
    }, 300000);

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const authUrl = `http://localhost:${port}/`;
      activeServer = server;

      // Open authentication directly in the user's default web browser
      shell.openExternal(authUrl);
    });

    server.on('error', (err) => {
      cleanup();
      resolve({ error: `Could not start local auth server: ${err.message}` });
    });
  });
}

module.exports = {
  status,
  getUser,
  setConfig,
  clearConfig,
  signIn,
  signOut,
};
