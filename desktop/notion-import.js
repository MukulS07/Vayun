// Reads a Notion "Markdown & CSV" export zip. Notion writes each page as <Title> <id>.md,
// each database as <Title> <id>.csv, and child pages in a folder named like their parent.
const AdmZip = require('adm-zip');
const { randomUUID } = require('node:crypto');

const MAX_BYTES = 200 * 1024 * 1024; // refuse zips that would expand past this
const MAX_ENTRIES = 20000;
const uid = () => 'n' + randomUUID().slice(0, 8);
const stripId = name => name.replace(/ [0-9a-f]{32}$/i, '').trim();

// RFC 4180 CSV parser: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function mdToBlocks(md, title) {
  const lines = md.split(/\r?\n/).map(l => l.replace(/\s+$/, ''));
  if (lines[0] && lines[0].replace(/^#\s+/, '') === title) lines.shift();
  const blocks = [];
  for (const raw of lines) {
    const l = raw.trimStart();
    if (!l.trim()) continue;
    let type = 'text', text = l, checked;
    if (/^#\s/.test(l)) { type = 'h1'; text = l.replace(/^#\s+/, ''); }
    else if (/^#{2,6}\s/.test(l)) { type = 'h2'; text = l.replace(/^#{2,6}\s+/, ''); }
    else if (/^[-*]\s\[( |x|X)\]\s/.test(l)) { type = 'todo'; checked = /x/i.test(l[3]); text = l.replace(/^[-*]\s\[( |x|X)\]\s+/, ''); }
    else if (/^[-*]\s/.test(l)) { type = 'bullet'; text = l.replace(/^[-*]\s+/, ''); }
    blocks.push({ id: uid(), type, text, ...(type === 'todo' && { checked }) });
  }
  return blocks.length ? blocks : [{ id: uid(), type: 'text', text: '' }];
}

// Column types from values: ISO dates, Yes/No checkboxes, numbers, small option sets, else text.
function inferSchema(headers, rows) {
  return headers.slice(1).map((name, i) => {
    const col = i + 1;
    const vals = rows.map(r => (r[col] ?? '').trim()).filter(v => v !== '');
    const id = 'c' + col;
    const distinct = [...new Set(vals)];
    if (vals.length && vals.every(v => /^\d{4}-\d{2}-\d{2}/.test(v))) return { id, name, type: 'date' };
    if (vals.length && vals.every(v => /^(yes|no|true|false)$/i.test(v))) return { id, name, type: 'checkbox' };
    if (vals.length && vals.every(v => /^-?\d+(\.\d+)?$/.test(v))) return { id, name, type: 'number' };
    if (vals.length && distinct.length <= 10) return { id, name, type: 'select', options: distinct };
    return { id, name, type: 'text' };
  });
}

function cellValue(prop, raw = '') {
  const v = raw.trim();
  if (prop.type === 'checkbox') return /^(yes|true)$/i.test(v);
  if (prop.type === 'number') return v === '' ? '' : Number(v);
  return v;
}

function importNotionZip(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length > MAX_ENTRIES) throw new Error('Export has too many files.');
  const total = entries.reduce((n, e) => n + e.header.size, 0);
  if (total > MAX_BYTES) throw new Error('Export is too large to import.');

  const pages = [];
  const byKey = new Map(); // path without extension -> page or database
  const files = [];
  const skipped = [];

  for (const e of entries) {
    if (e.isDirectory) continue;
    const name = e.entryName;
    if (name.startsWith('/') || name.split('/').includes('..')) { skipped.push(name); continue; }
    const m = name.match(/\.(md|csv)$/i);
    if (!m) { skipped.push(name); continue; }
    files.push({ name, ext: m[1].toLowerCase(), key: name.slice(0, -m[0].length), dirKey: name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '', text: e.getData().toString('utf8') });
  }

  // Pass 1: create every page and database, so parents can be resolved afterwards.
  const rowFiles = [];
  for (const f of files) {
    const title = stripId(f.key.split('/').pop()) || 'Untitled';
    if (f.ext === 'md') {
      const page = { id: uid(), title, parentId: null, blocks: mdToBlocks(f.text, title) };
      byKey.set(f.key, page);
      pages.push(page);
      continue;
    }
    const rows = parseCsv(f.text);
    const headers = rows[0] || ['Name'];
    const body = rows.slice(1);
    const schema = inferSchema(headers, body);
    const db = { id: uid(), title, parentId: null, kind: 'database', schema, view: { type: 'table' }, blocks: [] };
    byKey.set(f.key, db);
    pages.push(db);
    for (const r of body) {
      const rowTitle = (r[0] || '').trim() || 'Untitled';
      const props = {};
      schema.forEach((p, i) => { props[p.id] = cellValue(p, r[i + 1]); });
      const row = { id: uid(), title: rowTitle, parentId: db.id, blocks: [{ id: uid(), type: 'text', text: '' }], props };
      pages.push(row);
    }
  }

  // Pass 2: link parents by folder. A folder named like a page or database holds its children.
  for (const f of files) {
    if (f.ext !== 'md' || !f.dirKey) continue;
    const page = byKey.get(f.key);
    const parent = byKey.get(f.dirKey);
    if (!page || !parent) continue;
    if (parent.kind === 'database') {
      // Database folder with a markdown file named like a row: that file is the row's body.
      const row = pages.find(p => p.parentId === parent.id && p.title === page.title);
      if (row) { row.blocks = page.blocks; pages.splice(pages.indexOf(page), 1); continue; }
    }
    page.parentId = parent.id;
  }

  // Rows and pages whose folder had no matching file keep parentId null (they appear at top level).
  return { pages, databases: pages.filter(p => p.kind === 'database').length, rows: pages.filter(p => p.parentId && pages.some(d => d.id === p.parentId && d.kind === 'database')).length, skipped };
}

module.exports = { importNotionZip, parseCsv, mdToBlocks, inferSchema };
