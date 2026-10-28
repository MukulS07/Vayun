// Builds Vayun for the web: a copy of the desktop app's screens (desktop/app) plus the browser version of `window.api`
// (web-app/web-api.js). Nothing is bundled or rewritten besides the two HTML entry pages, so the web and desktop
// apps always run the same screen code.
//   node web-app/build.js [outDir]      default: web-app/dist
//   node web-app/build.js ../web/public/app
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'desktop', 'app');
// Loaded before any screen script, in this order: the Firebase settings, the browser `api`, the team code, the cloud parts.
const SHIMS = ['web-config.js', 'web-api.js', 'web-team.js', 'web-cloud.js'];
const FIREBASE_CDN = 'https://www.gstatic.com';
// What the page may talk to: Firebase sign-in, Firestore (teams) and Google Calendar; nothing else.
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${FIREBASE_CDN} https://accounts.google.com`,
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "img-src 'self' https: data:",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com",
  "frame-src https://*.firebaseapp.com https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');
const SKIP = new Set(['quick.html', 'quick.js']); // the desktop's global quick-search window

function patchHtml(html) {
  const tags = SHIMS.map(f => `<script src="${f}"></script>`).join('\n');
  // The shim goes first among the scripts, so `window.api` exists before any screen asks for it.
  const firstScript = html.search(/<script\b/);
  if (firstScript < 0) throw new Error('page has no script tag');
  let out = html.slice(0, firstScript) + tags + '\n' + html.slice(firstScript);
  out = out.replace('<title>Vayun</title>', '<title>Vayun on the web</title>');
  out = out.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, `<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
  return out;
}

// ---- the team code, run in the browser ----
// team-service.js and its helpers are Node modules. They are wrapped here, as they are, in a tiny module loader, with
// small stand-ins for the three Node modules they use (fs for the local cache, path, crypto), so the web app runs the
// very same team code as the desktop app instead of a second copy.
const TEAM_MODULES = ['team-error.js', 'firestore-rest.js', 'app/calendar-logic.js', 'app/team-logic.js', 'team-store-firestore.js', 'team-service.js'];
function teamBundle() {
  const desktop = path.join(root, 'desktop');
  const defs = TEAM_MODULES.map(f => '  ' + JSON.stringify('./' + f) + ': function (module, exports, require) {\n' + fs.readFileSync(path.join(desktop, f), 'utf8') + '\n  }').join(',\n');
  // split/join, not replace: the module code contains "$" patterns that String.replace would treat as special
  return fs.readFileSync(path.join(__dirname, 'team-loader.js'), 'utf8').split('/*MODULES*/').join(defs);
}

// The Firebase web settings. The web key is public by design (it ships in every web page); lock it to this site's
// address in the Google Cloud console. Read from the same git-ignored file the desktop build uses, or the environment.
function webConfig() {
  let apiKey = process.env.FIREBASE_API_KEY || '';
  try { apiKey = apiKey || JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'firebase-config.json'), 'utf8')).apiKey || ''; } catch { /* none */ }
  const cfg = {
    apiKey,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'vayun-12d1b.firebaseapp.com',
    projectId: process.env.FIREBASE_PROJECT_ID || 'vayun-12d1b',
    appId: process.env.FIREBASE_APP_ID || '1:578293090527:web:cce43dac8af2c70a94816a',
    googleClientId: process.env.VAYUN_WEB_GOOGLE_CLIENT_ID || '', // a "Web application" OAuth client, for Google Calendar
  };
  return `window.VAYUN_WEB_CONFIG = ${JSON.stringify(cfg)};\n`;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const src = path.join(from, e.name), dst = path.join(to, e.name);
    if (e.isDirectory()) copyDir(src, dst);
    else if (/^(index|start)\.html$/.test(e.name) && from === appDir) fs.writeFileSync(dst, patchHtml(fs.readFileSync(src, 'utf8')));
    else fs.copyFileSync(src, dst);
  }
}

function build(outDir) {
  // Empty the folder rather than delete it: a running preview server may be standing in it (Windows refuses to remove that).
  fs.mkdirSync(outDir, { recursive: true });
  for (const e of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, e), { recursive: true, force: true });
  copyDir(appDir, outDir);
  fs.writeFileSync(path.join(outDir, 'web-config.js'), webConfig());
  fs.writeFileSync(path.join(outDir, 'web-team.js'), teamBundle());
  for (const f of ['web-api.js', 'web-cloud.js']) fs.copyFileSync(path.join(__dirname, f), path.join(outDir, f));
  return outDir;
}

module.exports = { build, patchHtml, teamBundle };

if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(__dirname, 'dist'));
  build(out);
  console.log('Vayun web build written to', out);
}
