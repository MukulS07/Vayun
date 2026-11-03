// Forms on the phone and the web: reading the file a Google Form's responses are exported to (Excel or CSV) and opening
// links. It does what desktop/form-import.js does, with the browser's own tools instead of Node's (an .xlsx is a zip of
// XML files; the browser can unpack the zip's deflate data itself). Shared by the web and Android builds.
(function () {
  const MAX_BYTES = 100 * 1024 * 1024, MAX_ROWS = 20001, MAX_COLS = 200;

  const codePoint = n => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');
  const unescapeXml = s => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => codePoint(+n))
    .replace(/&amp;/g, '&');
  const textRuns = xml => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => unescapeXml(m[1])).join('');
  const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? m[1] : ''; };

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

  function colIndex(ref) {
    let n = 0;
    for (const ch of ref.replace(/[^A-Z]/gi, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  const pad = n => String(n).padStart(2, '0');
  function serialToText(serial) {
    const d = new Date(Math.round(serial * 86400) * 1000 + Date.UTC(1899, 11, 30));
    if (Number.isNaN(d.getTime())) return String(serial);
    const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    return time === '00:00:00' ? day : `${day} ${time}`;
  }
  function dateFormat(id, code) {
    if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return true;
    if (!code) return false;
    return /[ymdhs]/i.test(code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, ''));
  }

  // ---- a small zip reader: the entries' names and, on request, their text ----
  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function readZip(buf) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('That does not look like an Excel file.');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const entries = new Map();
    let total = 0;
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('That does not look like an Excel file.');
      const method = view.getUint16(p + 10, true), csize = view.getUint32(p + 20, true), size = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
      const offset = view.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
      total += size;
      entries.set(name, { method, csize, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (total > MAX_BYTES) throw new Error('That file is too large to import.');
    return {
      names: [...entries.keys()],
      has: name => entries.has(name),
      async text(name) {
        const e = entries.get(name);
        if (!e) return '';
        const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
        const data = buf.subarray(start, start + e.csize);
        const out = e.method === 0 ? data : e.method === 8 ? await inflate(data) : null;
        if (!out) throw new Error('That Excel file uses a compression Vayun cannot read. Save it again as .xlsx or .csv.');
        return new TextDecoder().decode(out);
      },
    };
  }

  async function parseXlsx(buf) {
    const zip = readZip(buf);
    let sheetPath = '';
    if (zip.has('xl/workbook.xml') && zip.has('xl/_rels/workbook.xml.rels')) {
      const sheet = ((await zip.text('xl/workbook.xml')).match(/<sheet\b[^>]*>/) || [])[0];
      const rid = sheet && attr(sheet, 'r:id');
      const rels = await zip.text('xl/_rels/workbook.xml.rels');
      const rel = rid && [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(t => attr(t, 'Id') === rid);
      const target = rel && attr(rel, 'Target');
      if (target) { const p = target.startsWith('/') ? target.slice(1) : 'xl/' + target; if (zip.has(p)) sheetPath = p; }
    }
    if (!sheetPath) sheetPath = zip.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0] || '';
    if (!sheetPath) throw new Error('That does not look like an Excel file.');

    const shared = [];
    if (zip.has('xl/sharedStrings.xml')) for (const m of (await zip.text('xl/sharedStrings.xml')).matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) shared.push(m[1] ? textRuns(m[1]) : '');

    const dates = new Set();
    if (zip.has('xl/styles.xml')) {
      const xml = await zip.text('xl/styles.xml');
      const custom = new Map([...xml.matchAll(/<numFmt\b[^>]*>/g)].map(m => [+attr(m[0], 'numFmtId'), unescapeXml(attr(m[0], 'formatCode'))]));
      const block = (xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '';
      [...block.matchAll(/<xf\b[^>]*>/g)].forEach((m, i) => { const id = +attr(m[0], 'numFmtId'); if (dateFormat(id, custom.get(id))) dates.add(i); });
    }

    const xml = await zip.text(sheetPath);
    const rows = [];
    for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (rows.length > MAX_ROWS) throw new Error('That file has too many rows.');
      const row = [];
      for (const cm of (rm[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1], inner = cm[2] || '';
        const i = colIndex(attr(attrs, 'r'));
        if (i < 0 || i >= MAX_COLS) continue;
        const t = attr(attrs, 't');
        const v = (inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1];
        let text = '';
        if (t === 'inlineStr') text = textRuns(inner);
        else if (v === undefined) text = '';
        else if (t === 's') text = shared[+v] ?? '';
        else if (t === 'str') text = unescapeXml(v);
        else if (t === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'e') text = '';
        else text = dates.has(+attr(attrs, 's')) && Number.isFinite(+v) ? serialToText(+v) : v;
        row[i] = text;
      }
      rows.push(Array.from(row, c => c ?? ''));
    }
    return rows;
  }

  // bytes (Uint8Array) + the file's name -> { name, rows } or { error }
  async function readFormFile(bytes, fileName) {
    const dot = fileName.lastIndexOf('.');
    const ext = dot < 0 ? '' : fileName.slice(dot).toLowerCase();
    const name = (dot < 0 ? fileName : fileName.slice(0, dot)).replace(/\s*\(responses\)\s*$/i, '').trim() || 'Form responses';
    if (ext === '.xls') throw new Error('That is an older Excel file (.xls). Open it in Excel or Google Sheets and save it as .xlsx or .csv.');
    if (ext === '.csv') return { name, rows: parseCsv(new TextDecoder().decode(bytes).replace(/^﻿/, '')) };
    return { name, rows: await parseXlsx(bytes) };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { readFormFile, parseCsv, serialToText };

  const api = typeof window !== 'undefined' && window.api;
  if (!api) return;
  if (!api.openExternal) {
    api.openExternal = url => { try { const u = new URL(url); if (u.protocol === 'https:') window.open(u.href, '_blank', 'noopener'); } catch { /* not a link */ } };
  }
  if (!api.importForm) {
    api.importForm = () => new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.csv,.xls';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(null);
        try { resolve(await readFormFile(new Uint8Array(await file.arrayBuffer()), file.name)); }
        catch (e) { resolve({ error: e.message }); }
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  }
})();
