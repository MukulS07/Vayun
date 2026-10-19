const path = require('node:path');
const { randomUUID } = require('node:crypto');

// pdf.js requires "/"-terminated resource paths, including on Windows.
const PDFJS_DIR = path.dirname(require.resolve('pdfjs-dist/package.json')).replaceAll('\\', '/');
const uid = () => randomUUID().slice(0, 8);
const BULLET = /^[•●▪◦‣∙·*–—-]\s+/;
const BOX = /^[☐□❑☑☒✓✔]\s*/;
const CHECKED = /^[☑☒✓✔]/;

// PDFs store positioned text runs, not headings or lists, so structure is guessed
// from font size, line spacing and line-start markers.
async function pdfToBlocks(data) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data,
    isEvalSupported: false, // defence in depth against malicious font programs
    cMapUrl: `${PDFJS_DIR}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_DIR}/standard_fonts/`,
  });
  try {
    const doc = await task.promise;
    const lines = await readLines(doc);
    const meta = await doc.getMetadata().catch(() => null);
    return { title: meta?.info?.Title?.trim() || '', blocks: linesToBlocks(lines) };
  } finally {
    await task.destroy();
  }
}

// Joins text runs that share a baseline into lines.
async function readLines(doc) {
  const lines = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    let line = null;
    for (const it of items) {
      if (!('str' in it)) continue;
      const [, , c, d, x, y] = it.transform;
      const size = Math.hypot(c, d) || it.height;
      if (it.str.trim()) {
        if (!line || Math.abs(line.y - y) > Math.max(line.size, size) * 0.5) {
          line = { page: n, y, x, end: x, size, text: '' };
          lines.push(line);
        }
        line.text += it.str;
        line.size = Math.max(line.size, size);
        line.x = Math.min(line.x, x);
        line.end = Math.max(line.end, x + it.width);
      } else if (line && it.str) {
        line.text += ' ';
      }
      if (it.hasEOL) line = null;
    }
    page.cleanup();
  }
  return lines
    .map(l => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter(l => l.text && !/^\d{1,4}$/.test(l.text)); // bare page numbers
}

function linesToBlocks(lines) {
  if (!lines.length) return [];
  // Body text size = the size that covers the most characters.
  const chars = new Map();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    chars.set(k, (chars.get(k) || 0) + l.text.length);
  }
  const body = [...chars].sort((a, b) => b[1] - a[1])[0][0];
  const bodyLines = lines.filter(l => Math.abs(l.size - body) < 0.5);
  const margin = Math.min(...bodyLines.map(l => l.x));
  const rightEdge = Math.max(...bodyLines.map(l => l.end));

  const blocks = [];
  let prev = null;
  for (const l of lines) {
    let type = 'text', text = l.text, checked;
    const indented = l.x > margin + body;
    if (l.size >= body * 1.6) type = 'h1';
    else if (l.size >= body * 1.2) type = 'h2';
    else if (BOX.test(text)) { type = 'todo'; checked = CHECKED.test(text); text = text.replace(BOX, ''); }
    else if (BULLET.test(text)) { type = 'bullet'; text = text.replace(BULLET, ''); }
    else if (indented) type = 'bullet'; // list markers drawn as shapes leave only the indent

    // A line continues the previous block only if it sits just below it and the previous
    // line ran to the right margin (wrapped text). Short lines end their block.
    const last = blocks.at(-1);
    const close = prev && prev.page === l.page && Math.abs(prev.y - l.y) < l.size * 1.5;
    const wrapped = prev && prev.end >= rightEdge - body * 4;
    const continuesList = type === 'bullet' && last?.type === 'bullet' && indented && !BULLET.test(l.text);
    const continues = close && wrapped && last && (type === 'text'
      ? ['text', 'bullet', 'todo'].includes(last.type)
      : continuesList || (type === last.type && type.startsWith('h')));
    if (continues) {
      last.text = /\p{Ll}-$/u.test(last.text) && /^\p{Ll}/u.test(text)
        ? last.text.slice(0, -1) + text // re-join a hyphenated word
        : `${last.text} ${text}`;
    } else {
      blocks.push({ id: uid(), type, text, ...(type === 'todo' && { checked }) });
    }
    prev = l;
  }
  return blocks;
}

module.exports = { pdfToBlocks, linesToBlocks };
