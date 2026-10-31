// Builds Vayun for Android:
// Packages the desktop screens (desktop/app), the Android mobile styling (android-mobile.css),
// the Android-native window.api bridge (android-api.js), and the team/cloud module.
//
// Usage:
//   node android-app/build.js [outDir]     default: android-app/dist
//   node android-app/build.js android-app/app/src/main/assets/www

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'desktop', 'app');
const defaultOut = path.join(__dirname, 'dist');
const targetOut = process.argv[2] ? path.resolve(process.argv[2]) : defaultOut;

const SHIMS = [
  'android-config.js',
  'android-api.js',
  'android-team.js',
  'android-cloud.js',
  'android-theme.js'
];

const FIREBASE_CDN = 'https://www.gstatic.com';
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${FIREBASE_CDN} https://apis.google.com https://accounts.google.com`,
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "font-src 'self' data:",
  "img-src 'self' https: data:",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com",
  "frame-src https://*.firebaseapp.com https://accounts.google.com https://*.googleapis.com",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const SKIP = new Set(['quick.html', 'quick.js']);

function patchHtml(html) {
  // 1. Add viewport-fit=cover for Android notch & edge-to-edge support
  const viewportTag = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">';
  let out = html.replace(/<meta name="viewport"[^>]*>/i, viewportTag);

  // 2. Inject mobile stylesheet (idempotent)
  if (!out.includes('android-mobile.css')) {
    const mobileCssTag = '<link rel="stylesheet" href="android-mobile.css">';
    out = out.replace('</head>', `  ${mobileCssTag}\n</head>`);
  }

  // 3. Inject Android JS shims before the first screen script (idempotent)
  if (!out.includes('android-api.js')) {
    const scriptTags = SHIMS.map(f => `<script src="${f}"></script>`).join('\n  ');
    const firstScript = out.search(/<script\b/);
    if (firstScript >= 0) {
      out = out.slice(0, firstScript) + scriptTags + '\n  ' + out.slice(firstScript);
    }
  }

  // 4. Update title and Content-Security-Policy
  out = out.replace('<title>Vayun</title>', '<title>Vayun on Android</title>');
  out = out.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, `<meta http-equiv="Content-Security-Policy" content="${CSP}">`);

  // 5. Accessibility & mobile copy replacement
  out = out.replace('Everything stays on this PC.', 'Everything stays on this device (100% private &amp; offline).');
  out = out.replace('<label>Name', '<label for="new-name">Name');
  out = out.replace('<label>Start with', '<label for="new-template">Start with');

  // 6. Loading screen injection for start.html and index.html (idempotent)
  const isStart = out.includes('<main class="start">');
  const isApp = out.includes('<div class="app">');

  if ((isStart || isApp) && !out.includes('vayun-loading-screen')) {
    const defaultCaption = isStart ? 'Starting Vayun…' : 'Loading workspace…';
    const loadingHtml = `  <!-- Branded Vayun Loading Screen -->
  <div id="vayun-loading-screen" class="vayun-loading-screen" aria-live="polite">
    <div class="loading-container">
      <div class="loading-logo-glow" aria-hidden="true"></div>
      <div class="loading-logo-box">
        <img src="brand/vayun-icon.png" alt="Vayun" class="loading-brand-img">
      </div>
      <div class="loading-brand-name">
        <div class="loading-wordmark">V A Y U N</div>
        <div class="loading-brand-sub">BY MAYTRIX</div>
      </div>
      <div class="loading-bar-track"><div class="loading-bar-fill"></div></div>
      <div class="loading-caption" id="loading-caption">${defaultCaption}</div>
    </div>
  </div>\n`;
    out = out.replace('<body>', `<body>\n${loadingHtml}`);
  }

  // 7. Premium Start Page Layout (Brand on topbar, clean hero, rich workspace cards & creation)
  if (isStart) {
    const newStartMain = `<main class="start">
    <!-- Top Navigation Bar: Brand on Left, Auth Center on Right -->
    <header class="start-topbar">
      <div class="start-brand">
        <div class="start-logo-box">
          <img src="brand/vayun-icon.png" alt="Vayun" class="start-logo-img">
        </div>
        <div class="start-brand-info">
          <div class="start-brand-row">
            <span class="start-brand-name">Vayun</span>
            <span class="start-status-badge">Offline</span>
          </div>
          <span class="start-brand-sub">by Maytrix</span>
        </div>
      </div>
      <div id="start-auth-mount" class="start-auth-mount"></div>
    </header>

    <!-- Welcome & Hero Overview -->
    <div class="start-hero-intro">
      <h1 class="start-hero-title" id="start-greeting">Your Workspaces</h1>
      <p class="start-hero-subtitle">Pick up where you left off.</p>
    </div>

    <!-- Workspaces Grid Section -->
    <section class="start-section" aria-labelledby="ws-heading">
      <h2 id="ws-heading" class="visually-hidden">Available workspaces</h2>
      <div id="ws-grid" class="ws-grid"></div>
    </section>

    <!-- Clean Modern Create Workspace Section -->
    <section class="start-section" aria-labelledby="new-heading">
      <div class="start-create-card">
        <button type="button" class="create-card-header create-toggle" id="create-toggle" aria-expanded="false" aria-controls="new-form">
          <div class="create-badge-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </div>
          <div class="create-header-text">
            <span id="new-heading" class="create-card-title">New workspace</span>
            <span class="create-card-sub">Blank page or a tasks board</span>
          </div>
          <svg class="create-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>

        <form id="new-form" class="new-form" hidden>
          <div class="form-field">
            <label for="new-name" class="field-label">Workspace Name</label>
            <input id="new-name" type="text" maxlength="60" placeholder="e.g. Personal, Work, Notes" required autocomplete="off" class="modern-input">
          </div>
          <div class="form-field">
            <label for="new-template" class="field-label">Template</label>
            <div class="select-wrapper">
              <select id="new-template" class="modern-select">
                <option value="blank">📄 Blank page</option>
                <option value="tasks">📋 Tasks database</option>
              </select>
              <svg class="select-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>
          <p id="new-error" class="error" role="alert" hidden></p>
          <button type="submit" class="create-submit-btn">
            <span>Create Workspace</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
          </button>
        </form>
      </div>
    </section>
    <script>
      (function () {
        var g = document.getElementById("start-greeting");
        if (g) { var h = new Date().getHours(); g.textContent = h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
        var t = document.getElementById("create-toggle"), f = document.getElementById("new-form");
        if (!t || !f) return;
        t.addEventListener("click", function () {
          var open = f.hidden;
          f.hidden = !open;
          t.setAttribute("aria-expanded", String(open));
          t.parentNode.classList.toggle("open", open);
          if (open) { var i = document.getElementById("new-name"); if (i) setTimeout(function () { i.focus(); }, 60); }
        });
      })();
    </script>
  </main>`;
    out = out.replace(/<main class="start">[\s\S]*?<\/main>/, newStartMain);
  }

  return out;
}

// ---- The team module bundle (runs desktop's team service in WebView) ----
const TEAM_MODULES = [
  'team-error.js',
  'firestore-rest.js',
  'app/calendar-logic.js',
  'app/team-logic.js',
  'team-store-firestore.js',
  'team-service.js'
];

function teamBundle() {
  const desktop = path.join(root, 'desktop');
  const defs = TEAM_MODULES.map(f => {
    return '  ' + JSON.stringify('./' + f) + ': function (module, exports, require) {\n' +
      fs.readFileSync(path.join(desktop, f), 'utf8') + '\n  }';
  }).join(',\n');

  return fs.readFileSync(path.join(root, 'web-app', 'team-loader.js'), 'utf8')
    .split('/*MODULES*/')
    .join(defs);
}

// ---- Android Firebase & OAuth Config ----
function androidConfig() {
  let apiKey = process.env.FIREBASE_API_KEY || '';
  try {
    const raw = fs.readFileSync(path.join(root, 'desktop', 'firebase-config.json'), 'utf8');
    apiKey = apiKey || JSON.parse(raw).apiKey || '';
  } catch { /* none */ }

  const cfg = {
    apiKey,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'vayun-12d1b.firebaseapp.com',
    projectId: process.env.FIREBASE_PROJECT_ID || 'vayun-12d1b',
    appId: process.env.FIREBASE_APP_ID || '1:578293090527:web:cce43dac8af2c70a94816a',
    platform: 'android'
  };
  return `window.VAYUN_WEB_CONFIG = ${JSON.stringify(cfg)};\n`;
}

function copyDir(from, to, shouldPatch = true) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const src = path.join(from, e.name), dst = path.join(to, e.name);
    if (e.isDirectory()) {
      copyDir(src, dst, shouldPatch);
    } else if (shouldPatch && e.name.endsWith('.html')) {
      fs.writeFileSync(dst, patchHtml(fs.readFileSync(src, 'utf8')));
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

console.log(`Building Vayun for Android -> ${targetOut}`);
fs.mkdirSync(targetOut, { recursive: true });
copyDir(appDir, targetOut, true);

// Write Android-specific shims & assets
fs.writeFileSync(path.join(targetOut, 'android-config.js'), androidConfig());
fs.writeFileSync(path.join(targetOut, 'android-team.js'), teamBundle());
fs.copyFileSync(path.join(__dirname, 'android-api.js'), path.join(targetOut, 'android-api.js'));
fs.copyFileSync(path.join(__dirname, 'android-theme.js'), path.join(targetOut, 'android-theme.js'));
fs.copyFileSync(path.join(__dirname, 'android-mobile.css'), path.join(targetOut, 'android-mobile.css'));
fs.copyFileSync(path.join(__dirname, 'welcome.html'), path.join(targetOut, 'welcome.html'));
fs.copyFileSync(path.join(root, 'web-app', 'web-cloud.js'), path.join(targetOut, 'android-cloud.js'));

// Sync assets to native Android project
const nativeAssets = path.join(__dirname, 'app', 'src', 'main', 'assets', 'www');
fs.mkdirSync(nativeAssets, { recursive: true });
console.log(`Syncing assets to native Android project -> ${nativeAssets}`);
copyDir(targetOut, nativeAssets, false);

console.log('✅ Android build complete.');
