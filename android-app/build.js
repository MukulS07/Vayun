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

  // 2. Inject mobile stylesheet
  const mobileCssTag = '<link rel="stylesheet" href="android-mobile.css">';
  out = out.replace('</head>', `  ${mobileCssTag}\n</head>`);

  // 3. Inject Android JS shims before the first screen script
  const scriptTags = SHIMS.map(f => `<script src="${f}"></script>`).join('\n  ');
  const firstScript = out.search(/<script\b/);
  if (firstScript >= 0) {
    out = out.slice(0, firstScript) + scriptTags + '\n  ' + out.slice(firstScript);
  }

  // 4. Update title and Content-Security-Policy
  out = out.replace('<title>Vayun</title>', '<title>Vayun on Android</title>');
  out = out.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, `<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
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
    appId: process.env.FIREBASE_APP_ID || '1:578293090527:android:vayun',
    platform: 'android'
  };
  return `window.VAYUN_WEB_CONFIG = ${JSON.stringify(cfg)};\n`;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const src = path.join(from, e.name), dst = path.join(to, e.name);
    if (e.isDirectory()) {
      copyDir(src, dst);
    } else if (e.name.endsWith('.html')) {
      fs.writeFileSync(dst, patchHtml(fs.readFileSync(src, 'utf8')));
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

console.log(`Building Vayun for Android -> ${targetOut}`);
fs.mkdirSync(targetOut, { recursive: true });
copyDir(appDir, targetOut);

// Write Android-specific shims & assets
fs.writeFileSync(path.join(targetOut, 'android-config.js'), androidConfig());
fs.writeFileSync(path.join(targetOut, 'android-team.js'), teamBundle());
fs.copyFileSync(path.join(__dirname, 'android-api.js'), path.join(targetOut, 'android-api.js'));
fs.copyFileSync(path.join(__dirname, 'android-theme.js'), path.join(targetOut, 'android-theme.js'));
fs.copyFileSync(path.join(__dirname, 'android-mobile.css'), path.join(targetOut, 'android-mobile.css'));
fs.copyFileSync(path.join(root, 'web-app', 'web-cloud.js'), path.join(targetOut, 'android-cloud.js'));

// Sync assets to native Android project
const nativeAssets = path.join(__dirname, 'app', 'src', 'main', 'assets', 'www');
fs.mkdirSync(nativeAssets, { recursive: true });
console.log(`Syncing assets to native Android project -> ${nativeAssets}`);
copyDir(targetOut, nativeAssets);

console.log('✅ Android build complete.');
