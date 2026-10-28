const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('../../web-app/build');

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vayun-web-'));
build(out);
const page = name => fs.readFileSync(path.join(out, name), 'utf8');
const scripts = html => [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);

test('both pages load the web api before any screen script, and every script they name exists', () => {
  for (const name of ['index.html', 'start.html']) {
    const list = scripts(page(name));
    assert.deepStrictEqual(list.slice(0, 4), ['web-config.js', 'web-api.js', 'web-team.js', 'web-cloud.js'], name);
    for (const s of list) assert.ok(fs.existsSync(path.join(out, s)), `${name} names ${s}`);
  }
});

test('the web pages may talk to Firebase and Google only, and run no eval', () => {
  const csp = page('index.html').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.ok(!/unsafe-eval/.test(csp));
  assert.ok(/connect-src[^;]*googleapis\.com/.test(csp) && /script-src 'self' https:\/\/www\.gstatic\.com/.test(csp));
  assert.ok(!/\*\s*;|default-src \*/.test(csp), 'no wildcard-everything');
});

test('the desktop-only quick search window is not shipped to the web', () => {
  assert.ok(!fs.existsSync(path.join(out, 'quick.html')));
  assert.ok(fs.existsSync(path.join(out, 'app.js')) && fs.existsSync(path.join(out, 'home.js')));
});

test('the team bundle runs in a browser-like sandbox and yields the real team service', () => {
  const store = {};
  const win = {};
  const ctx = vm.createContext({
    window: win, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    crypto: { randomUUID: () => 'a'.repeat(8) + '-' + 'b'.repeat(4), getRandomValues: a => a }, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, TextEncoder,
  });
  vm.runInContext(page('web-team.js'), ctx);
  assert.strictEqual(typeof win.VayunWebTeam.createTeamService, 'function');
  assert.strictEqual(typeof win.VayunWebTeam.FirestoreTeamStore, 'function');
  const svc = win.VayunWebTeam.createTeamService({ dir: 'web', getUser: () => null, canSync: () => false, makeStore: async () => null });
  assert.strictEqual(svc.state().signedIn, false);
});

test('the web config carries no Google Calendar client secret', () => {
  assert.ok(!/GOCSPX|clientSecret/i.test(page('web-config.js')));
});
