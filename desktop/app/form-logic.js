// Turns the rows of an exported Google Form (Excel or CSV) into a Vayun database: one row per response, with the
// columns worked out from the questions (title, status, priority, due date, assignee, email, submitted time).
// Importing the same form again only adds the responses that are not there yet. No DOM and no files in here, so the
// app and the tests share it (the file itself is read in the main process, see form-import.js).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else root.FolioFormImport = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const MAX_ROWS = 20000;
  const STATUS_DEFAULT = ['To do', 'Doing', 'Done'];
  const ROLE = {
    timestamp: /^(timestamp|submitted( at| on)?|submission( time| date)?|response (time|date))$/i,
    email: /e-?mail/i,
    status: /\b(status|state|progress|stage)\b/i,
    priority: /\b(priority|urgency|importance|severity)\b/i,
    due: /\b(due|deadline|by when|needed by|target date|complete by|finish by)\b/i,
    assignee: /\b(assign(ed|ee)?( to)?|owner|responsible|in charge|who will)\b/i,
    title: /^(task|title|subject|topic|request|issue|summary|project)\b/i,
  };

  const norm = v => String(v == null ? '' : v).trim();
  const pad = n => String(n).padStart(2, '0');

  // A short stable fingerprint of a response, so the same one is never added twice.
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  // ---- dates: "2026/11/02 10:21:33", "2026-11-02", "11/2/2026", "02/11/2026" ----
  const YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T,]|$)/;
  const XYZ = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T,]|$)/;
  const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

  // Which way round day and month go in a column of dates: 'dmy' when any first number is above 12, otherwise 'mdy'
  // (what Google Sheets writes in most locales). Returns null when the column is not all dates.
  function dateOrder(values) {
    const vals = values.filter(v => v !== '');
    if (!vals.length) return null;
    let dmy = false, mdy = false;
    for (const v of vals) {
      if (YMD.test(v)) { const m = v.match(YMD); if (!valid(+m[1], +m[2], +m[3])) return null; continue; }
      const m = v.match(XYZ);
      if (!m) return null;
      if (+m[1] > 12) dmy = true; else if (+m[2] > 12) mdy = true;
    }
    return dmy && !mdy ? 'dmy' : 'mdy';
  }

  function toIso(v, order) {
    let m = v.match(YMD);
    if (m) return valid(+m[1], +m[2], +m[3]) ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : '';
    m = v.match(XYZ);
    if (!m) return '';
    const [a, b, y] = [+m[1], +m[2], m[3]];
    const [month, day] = order === 'dmy' ? [b, a] : [a, b];
    return valid(+y, month, day) ? `${y}-${pad(month)}-${pad(day)}` : '';
  }

  // ---- what kind of column is this? ----
  function inferType(vals, order) {
    const v = vals.filter(x => x !== '');
    if (!v.length) return { type: 'text' };
    if (order) return { type: 'date', order };
    if (v.every(x => /^(yes|no|true|false)$/i.test(x))) return { type: 'checkbox' };
    if (v.every(x => /^-?\d+(\.\d+)?$/.test(x))) return { type: 'number' };
    const distinct = [...new Set(v)];
    if (distinct.length <= 10 && distinct.length < v.length) return { type: 'select', options: distinct };
    return { type: 'text' };
  }

  function sameHeaders(headers) { return headers.map(h => h.toLowerCase()).join('\u0001'); }

  function readTable(rows) {
    const clean = (rows || []).filter(r => Array.isArray(r) && r.some(c => norm(c) !== ''));
    if (clean.length < 2) throw new Error('There are no responses in that file.');
    if (clean.length > MAX_ROWS + 1) throw new Error(`That file has more than ${MAX_ROWS} responses.`);
    const headers = clean[0].map((h, i) => norm(h) || `Question ${i + 1}`);
    const body = clean.slice(1).map(r => headers.map((_, i) => norm(r[i])));
    return { headers, body };
  }

  // Works out which column plays which part. Each part goes to the first column that fits, and only one column each.
  function chooseColumns(headers, body) {
    const col = i => body.map(r => r[i]);
    const order = headers.map((_, i) => dateOrder(col(i)));
    const types = headers.map((_, i) => inferType(col(i), order[i]));
    const used = new Set();
    const pick = (re, ok) => {
      const i = headers.findIndex((h, k) => !used.has(k) && re.test(h) && (!ok || ok(k)));
      if (i >= 0) used.add(i);
      return i;
    };
    const fewValues = max => k => new Set(col(k).filter(Boolean)).size <= max;
    const roles = {
      timestamp: pick(ROLE.timestamp),
      email: pick(ROLE.email),
      due: pick(ROLE.due, k => types[k].type === 'date'),
      status: pick(ROLE.status, fewValues(12)),
      priority: pick(ROLE.priority, fewValues(8)),
      assignee: pick(ROLE.assignee),
      title: pick(ROLE.title),
    };
    if (roles.title < 0) roles.title = pick(/\bname\b/i);
    if (roles.title < 0) {
      // the first free-text question
      const i = headers.findIndex((_, k) => !used.has(k) && types[k].type === 'text' && col(k).some(Boolean));
      if (i >= 0) { used.add(i); roles.title = i; }
    }
    return { roles, types, order };
  }

  // Select columns: the options are the answers seen, in the order they first appear.
  function optionsOf(vals) { return [...new Set(vals.filter(Boolean))]; }

  function cellValue(prop, raw, order) {
    if (prop.type === 'checkbox') return /^(yes|true)$/i.test(raw);
    if (prop.type === 'number') return raw === '' ? '' : Number(raw);
    if (prop.type === 'date') return raw === '' ? '' : toIso(raw, order);
    return raw;
  }

  function rowTitle(raw, n) {
    const t = raw.replace(/\s+/g, ' ').trim();
    if (!t) return `Response ${n}`;
    return t.length > 140 ? t.slice(0, 139) + '…' : t;
  }

  // Long answers are also written into the response's page, so they are easy to read in full.
  function rowBlocks(headers, cells, titleCol, uid) {
    const blocks = [];
    cells.forEach((v, i) => {
      if (v.length > 80 || (i === titleCol && v.length > 140)) blocks.push({ id: uid(), type: 'text', text: i === titleCol ? v : `${headers[i]}: ${v}` });
    });
    return blocks.length ? blocks : [{ id: uid(), type: 'text', text: '' }];
  }

  // rows: array of arrays, the first being the questions. pages: the workspace's pages (to find an earlier import).
  // Returns { db, pages (new ones to add), added, skipped, created }.
  function importForm(rows, pages, { name = 'Form responses', uid } = {}) {
    if (typeof uid !== 'function') throw new Error('uid is required');
    const { headers, body } = readTable(rows);
    const sig = sameHeaders(headers);
    const earlier = (pages || []).find(p => p.kind === 'database' && p.source && p.source.kind === 'form' && p.source.sig === sig);
    return earlier ? addToExisting(earlier, headers, body, pages, uid) : createNew(headers, body, name, uid, sig);
  }

  function createNew(headers, body, name, uid, sig) {
    const { roles, types, order } = chooseColumns(headers, body);
    const col = i => body.map(r => r[i]);
    const schema = [];
    const map = headers.map(() => null);
    const used = new Set();
    const nameFor = h => { let n = h, k = 2; while (used.has(n.toLowerCase())) n = `${h} ${k++}`; used.add(n.toLowerCase()); return n; };
    headers.forEach((h, i) => {
      if (i === roles.title) { map[i] = 'title'; return; }
      const id = 'c' + (schema.length + 1);
      let prop = { id, name: nameFor(h), ...types[i] };
      if (i === roles.status || i === roles.priority) prop = { id, name: prop.name, type: 'select', options: optionsOf(col(i)) };
      if (i === roles.due && types[i].type !== 'date') prop = { id, name: prop.name, type: 'text' };
      schema.push(prop);
      map[i] = id;
    });
    // No status question in the form: add one, so the responses can be worked through as tasks.
    let statusId = roles.status >= 0 ? map[roles.status] : '';
    let addedStatus = '';
    if (!statusId) {
      statusId = 'c' + (schema.length + 1);
      addedStatus = statusId;
      schema.push({ id: statusId, name: nameFor('Status'), type: 'select', options: STATUS_DEFAULT.slice() });
    }
    const db = {
      id: uid(), title: name, parentId: null, kind: 'database', schema, blocks: [],
      view: { type: 'board', group: statusId },
      source: { kind: 'form', sig, map, addedStatus },
    };
    const { out, skipped } = buildRows(db, headers, body, order, roles.title, new Set(), uid);
    return { db, pages: [db, ...out], added: out.length, skipped, created: true };
  }

  function addToExisting(db, headers, body, pages, uid) {
    const { roles, order } = chooseColumns(headers, body);
    const known = new Set(pages.filter(p => p.parentId === db.id && p.formKey).map(p => p.formKey));
    const titleCol = db.source.map.indexOf('title');
    const { out, skipped } = buildRows(db, headers, body, order, titleCol >= 0 ? titleCol : roles.title, known, uid);
    return { db, pages: out, added: out.length, skipped, created: false };
  }

  function buildRows(db, headers, body, order, titleCol, known, uid) {
    const out = [];
    let skipped = 0;
    const seen = new Map();
    const byId = new Map(db.schema.map(p => [p.id, p]));
    body.forEach((cells, n) => {
      const base = hash(cells.join('\u0001'));
      const dup = seen.get(base) || 0;
      seen.set(base, dup + 1);
      const key = `${base}#${dup}`;
      if (known.has(key)) { skipped++; return; }
      const props = {};
      db.source.map.forEach((target, i) => {
        const prop = target && byId.get(target);
        if (!prop) return;
        const raw = cells[i] || '';
        if (prop.type === 'select' && raw && !(prop.options || []).includes(raw)) (prop.options = prop.options || []).push(raw);
        props[prop.id] = cellValue(prop, raw, order[i]);
      });
      // a status that came from no question starts as "To do"
      const added = db.source.addedStatus;
      if (added && byId.has(added)) props[added] = 'To do';
      out.push({
        id: uid(), title: rowTitle(titleCol >= 0 ? cells[titleCol] : '', n + 1), parentId: db.id,
        blocks: rowBlocks(headers, cells, titleCol, uid), props, formKey: key,
      });
    });
    return { out, skipped };
  }

  return { importForm, dateOrder, toIso, readTable, chooseColumns };
});
