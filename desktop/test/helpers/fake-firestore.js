// A small in-memory stand-in for the parts of the Firestore REST API that the team store uses:
// GET a document, :commit (create / masked update / delete, with REQUEST_TIME and array transforms)
// and :runQuery. It is only as faithful as these tests need. It does NOT run firestore.rules, apart from
// the one rule the join flow depends on (only team members can read a team); the real rules are tested
// against Google's emulator instead.
const { cmpTs } = require('../../app/team-logic');

const dec = v => ('stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue : 'timestampValue' in v ? v.timestampValue : 'nullValue' in v ? null
    : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec)
      : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)])) : undefined);

function parseFieldPath(p) {
  const out = []; let cur = ''; let quoted = false;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '`') { quoted = !quoted; continue; }
    if (ch === '\\' && quoted) { cur += p[++i]; continue; }
    if (ch === '.' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function getVal(fields, parts) {
  let f = fields;
  for (let i = 0; i < parts.length; i++) {
    const v = f && f[parts[i]];
    if (i === parts.length - 1) return v;
    f = v && v.mapValue && v.mapValue.fields;
  }
  return undefined;
}
function setVal(fields, parts, value) {
  let f = fields;
  for (const p of parts.slice(0, -1)) {
    if (!f[p] || !f[p].mapValue) f[p] = { mapValue: { fields: {} } };
    if (!f[p].mapValue.fields) f[p].mapValue.fields = {};
    f = f[p].mapValue.fields;
  }
  f[parts[parts.length - 1]] = value;
}
function delVal(fields, parts) {
  let f = fields;
  for (const p of parts.slice(0, -1)) { f = f[p] && f[p].mapValue && f[p].mapValue.fields; if (!f) return; }
  delete f[parts[parts.length - 1]];
}

function createFakeFirestore(project = 'p') {
  let docs = new Map(); // 'teams/t1/tasks/x' -> { fields, createTime, updateTime }
  let tick = 0;
  const root = `projects/${project}/databases/(default)/documents`;
  const stamp = () => { tick++; return new Date(Date.UTC(2026, 0, 1) + tick * 1000).toISOString().replace('.000Z', `.${String(tick).padStart(6, '0')}Z`); };
  const httpError = (status, s) => Object.assign(new Error(s), { status, body: { error: { code: status, status: s, message: s } } });
  const asDoc = (path, d) => ({ name: `${root}/${path}`, fields: d.fields, createTime: d.createTime, updateTime: d.updateTime });

  // The one rule we emulate: only members of a team can read it or anything inside it.
  const canRead = (path, uid) => {
    const m = /^teams\/([^/]+)/.exec(path);
    if (!m) return true;
    const team = docs.get(`teams/${m[1]}`);
    if (!team) return true; // nothing to protect; reads simply find nothing
    const ids = dec(team.fields.memberIds || { arrayValue: {} });
    return Array.isArray(ids) && ids.includes(uid);
  };

  function get(path, uid) {
    if (!canRead(path, uid)) throw httpError(403, 'PERMISSION_DENIED');
    const d = docs.get(path);
    if (!d) throw httpError(404, 'NOT_FOUND');
    return asDoc(path, d);
  }

  function commit(body) {
    const work = new Map([...docs].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
    const time = stamp();
    for (const w of body.writes) {
      if (w.delete) { work.delete(w.delete.slice(root.length + 1)); continue; }
      const path = w.update.name.slice(root.length + 1);
      const cur = work.get(path);
      if (w.currentDocument && w.currentDocument.exists === false && cur) throw httpError(409, 'ALREADY_EXISTS');
      if (w.currentDocument && w.currentDocument.exists === true && !cur) throw httpError(404, 'NOT_FOUND');
      let fields = cur ? cur.fields : {};
      if (w.updateMask) {
        for (const fp of w.updateMask.fieldPaths) {
          const parts = parseFieldPath(fp);
          const val = getVal(w.update.fields || {}, parts);
          if (val === undefined) delVal(fields, parts); else setVal(fields, parts, JSON.parse(JSON.stringify(val)));
        }
      } else fields = JSON.parse(JSON.stringify(w.update.fields || {}));
      for (const t of w.updateTransforms || []) {
        const parts = parseFieldPath(t.fieldPath);
        const existing = ((getVal(fields, parts) || {}).arrayValue || {}).values || [];
        if (t.setToServerValue === 'REQUEST_TIME') setVal(fields, parts, { timestampValue: time });
        else if (t.appendMissingElements) {
          const merged = [...existing];
          for (const v of t.appendMissingElements.values) if (!merged.some(x => JSON.stringify(x) === JSON.stringify(v))) merged.push(v);
          setVal(fields, parts, { arrayValue: { values: merged } });
        } else if (t.removeAllFromArray) {
          const drop = t.removeAllFromArray.values.map(v => JSON.stringify(v));
          setVal(fields, parts, { arrayValue: { values: existing.filter(x => !drop.includes(JSON.stringify(x))) } });
        }
      }
      work.set(path, { fields, createTime: cur ? cur.createTime : time, updateTime: time });
    }
    docs = work;
    return { writeResults: body.writes.map(() => ({ updateTime: time })), commitTime: time };
  }

  const matches = (data, f) => {
    const { field, op, value } = f.fieldFilter;
    const actual = data[field.fieldPath];
    const want = dec(value);
    if (op === 'EQUAL') return JSON.stringify(actual) === JSON.stringify(want);
    if (op === 'ARRAY_CONTAINS') return Array.isArray(actual) && actual.includes(want);
    if (op === 'GREATER_THAN_OR_EQUAL') return actual !== undefined && cmpTs(actual, want) >= 0;
    if (op === 'GREATER_THAN') return actual !== undefined && cmpTs(actual, want) > 0;
    throw new Error('fake: unsupported op ' + op);
  };

  function runQuery(parent, q, uid) {
    if (parent && !canRead(parent, uid)) throw httpError(403, 'PERMISSION_DENIED');
    const prefix = `${parent ? parent + '/' : ''}${q.from[0].collectionId}/`;
    const filters = !q.where ? [] : q.where.compositeFilter ? q.where.compositeFilter.filters : [q.where];
    const rows = [...docs].filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .filter(([, d]) => { const data = Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, dec(v)])); return filters.every(f => matches(data, f)); })
      .map(([p, d]) => ({ document: asDoc(p, d), readTime: stamp() }));
    return rows.length ? rows : [{ readTime: stamp() }];
  }

  // fetch-compatible. The caller's identity comes from the token: "Bearer tok-<uid>".
  async function fetch(url, init = {}) {
    const respond = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
    try {
      const uid = String(init.headers && init.headers.Authorization || '').replace('Bearer tok-', '');
      const rel = decodeURIComponent(url.slice(url.indexOf(root) + root.length));
      const body = init.body ? JSON.parse(init.body) : null;
      if (init.method === 'GET') return respond(200, get(rel.slice(1), uid));
      if (rel === ':commit') return respond(200, commit(body));
      if (rel.endsWith(':runQuery')) return respond(200, runQuery(rel.slice(1, -':runQuery'.length), body.structuredQuery, uid));
      return respond(400, { error: { status: 'INVALID_ARGUMENT', message: 'fake: unknown route ' + rel } });
    } catch (e) {
      if (e.status) return respond(e.status, e.body);
      throw e;
    }
  }

  return { fetch, docs: () => docs };
}

module.exports = { createFakeFirestore };
