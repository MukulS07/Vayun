// Reads the file a Google Form's responses are exported to: Excel (.xlsx) or CSV. Returns the rows as arrays of text,
// the first row being the questions. An .xlsx is a zip of XML files, so adm-zip (already used for Notion) is enough.
const path = require('node:path');
const AdmZip = require('adm-zip');
const { parseCsv } = require('./notion-import');

const MAX_BYTES = 100 * 1024 * 1024; // refuse files that would expand past this
const MAX_ROWS = 20001;
const MAX_COLS = 200;

const codePoint = n => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');
const unescapeXml = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => codePoint(+n))
  .replace(/&amp;/g, '&');
const textRuns = xml => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => unescapeXml(m[1])).join('');
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? m[1] : ''; };

function colIndex(ref) {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const pad = n => String(n).padStart(2, '0');
// Excel stores dates as days since 1899-12-30.
function serialToText(serial) {
  const ms = Math.round(serial * 86400) * 1000 + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
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

function dateStyles(zip) {
  const entry = zip.getEntry('xl/styles.xml');
  if (!entry) return new Set();
  const xml = entry.getData().toString('utf8');
  const custom = new Map([...xml.matchAll(/<numFmt\b[^>]*>/g)].map(m => [+attr(m[0], 'numFmtId'), unescapeXml(attr(m[0], 'formatCode'))]));
  const block = (xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '';
  const out = new Set();
  [...block.matchAll(/<xf\b[^>]*>/g)].forEach((m, i) => {
    const id = +attr(m[0], 'numFmtId');
    if (dateFormat(id, custom.get(id))) out.add(i);
  });
  return out;
}

function firstSheetPath(zip) {
  const wb = zip.getEntry('xl/workbook.xml');
  const rels = zip.getEntry('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const sheet = (wb.getData().toString('utf8').match(/<sheet\b[^>]*>/) || [])[0];
    const rid = sheet && attr(sheet, 'r:id');
    const rel = rid && [...rels.getData().toString('utf8').matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(t => attr(t, 'Id') === rid);
    const target = rel && attr(rel, 'Target');
    if (target) {
      const p = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
      if (zip.getEntry(p)) return p;
    }
  }
  const names = zip.getEntries().map(e => e.entryName).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  return names[0] || '';
}

function parseXlsx(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.reduce((n, e) => n + e.header.size, 0) > MAX_BYTES) throw new Error('That file is too large to import.');
  const sheetPath = firstSheetPath(zip);
  if (!sheetPath) throw new Error('That does not look like an Excel file.');

  const shared = [];
  const ss = zip.getEntry('xl/sharedStrings.xml');
  if (ss) for (const m of ss.getData().toString('utf8').matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) shared.push(m[1] ? textRuns(m[1]) : '');
  const dates = dateStyles(zip);

  const xml = zip.getEntry(sheetPath).getData().toString('utf8');
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

function readFormFile(buffer, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const name = path.basename(fileName, path.extname(fileName)).replace(/\s*\(responses\)\s*$/i, '').trim() || 'Form responses';
  if (ext === '.xls') throw new Error('That is an older Excel file (.xls). Open it in Excel or Google Sheets and save it as .xlsx or .csv.');
  if (ext === '.csv') return { name, rows: parseCsv(buffer.toString('utf8').replace(/^﻿/, '')) };
  return { name, rows: parseXlsx(buffer) };
}

module.exports = { readFormFile, parseXlsx, serialToText };
