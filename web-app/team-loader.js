// Generated into web-team.js by build.js: a tiny module loader so the desktop's team code runs, unchanged, in a browser.
// The marker line inside "defs" is replaced with one entry per Node module; the stand-ins below cover the three Node modules they use.
(function () {
  const store = (() => { try { return JSON.parse(localStorage.getItem('vayun-team-cache') || '{}'); } catch { return {}; } })();
  const persist = () => { try { localStorage.setItem('vayun-team-cache', JSON.stringify(store)); } catch { /* full or blocked: the cache is optional */ } };
  const nodeFs = {
    readFileSync: p => { if (!(p in store)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return store[p]; },
    writeFileSync: (p, d) => { store[p] = String(d); persist(); },
    renameSync: (a, b) => { store[b] = store[a]; delete store[a]; persist(); },
    existsSync: p => p in store,
    mkdirSync: () => {},
  };
  const nodePath = { join: (...parts) => parts.join('/').replace(/\/+/g, '/') };
  const nodeCrypto = {
    randomUUID: () => crypto.randomUUID(),
    randomBytes: n => crypto.getRandomValues(new Uint8Array(n)),
  };
  const defs = {
/*MODULES*/
  };
  const cache = {};
  const norm = id => id.replace(/^\.\//, '').replace(/\.js$/, '') + '.js';
  function load(name) {
    const want = norm(name);
    const keys = Object.keys(defs);
    const plain = k => k.replace(/^\.\//, '');
    // a relative name from inside app/ ("./calendar-logic") is matched by its file name
    const key = keys.find(k => plain(k) === want) || keys.find(k => plain(k).split('/').pop() === want.split('/').pop());
    if (!key) throw new Error('Unknown module ' + name);
    if (cache[key]) return cache[key].exports;
    const module = cache[key] = { exports: {} };
    defs[key].call(module.exports, module, module.exports, req);
    return module.exports;
  }
  function req(id) {
    if (id === 'node:fs') return nodeFs;
    if (id === 'node:path') return nodePath;
    if (id === 'node:crypto') return nodeCrypto;
    return load(id);
  }
  window.VayunWebTeam = { createTeamService: load('./team-service.js').createTeamService, FirestoreTeamStore: load('./team-store-firestore.js').FirestoreTeamStore };
})();
