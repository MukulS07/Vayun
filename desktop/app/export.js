// Pure converters: page -> Markdown or HTML, database -> CSV. Used by the app and tests.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const textOf = v => (v == null ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toMarkdown(page) {
    const lines = [`# ${page.title || 'Untitled'}`, ''];
    let prevList = false;
    let n = 0;
    for (const b of page.blocks || []) {
      const t = b.text || '';
      const isList = b.type === 'bullet' || b.type === 'todo' || b.type === 'numbered';
      n = b.type === 'numbered' ? n + 1 : 0;
      let line = t;
      if (b.type === 'h1') line = `## ${t}`;
      else if (b.type === 'h2') line = `### ${t}`;
      else if (b.type === 'h3') line = `#### ${t}`;
      else if (b.type === 'bullet') line = `- ${t}`;
      else if (b.type === 'numbered') line = `${n}. ${t}`;
      else if (b.type === 'todo') line = `- [${b.checked ? 'x' : ' '}] ${t}`;
      else if (b.type === 'quote') line = t.split('\n').map(l => `> ${l}`).join('\n');
      else if (b.type === 'callout') line = `> 💡 ${t}`;
      else if (b.type === 'code') line = '```\n' + t + '\n```';
      else if (b.type === 'divider') line = '---';
      if (prevList && !isList) lines.push(''); // a blank line only where a list ends
      lines.push(line);
      if (!isList) lines.push('');
      prevList = isList;
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  function toHtml(page) {
    const out = [];
    let list = null; // 'ul' or 'ol' while inside a run of list items
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const b of page.blocks || []) {
      const t = esc(b.text || '');
      if (b.type === 'numbered') {
        if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; }
        out.push(`<li>${t}</li>`);
      } else if (b.type === 'bullet' || b.type === 'todo') {
        if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; }
        out.push(b.type === 'todo'
          ? `<li><input type="checkbox" disabled${b.checked ? ' checked' : ''}> ${t}</li>`
          : `<li>${t}</li>`);
      } else {
        close();
        if (b.type === 'h1') out.push(`<h2>${t}</h2>`);
        else if (b.type === 'h2') out.push(`<h3>${t}</h3>`);
        else if (b.type === 'h3') out.push(`<h4>${t}</h4>`);
        else if (b.type === 'quote') out.push(`<blockquote>${t}</blockquote>`);
        else if (b.type === 'callout') out.push(`<blockquote>💡 ${t}</blockquote>`);
        else if (b.type === 'code') out.push(`<pre><code>${t}</code></pre>`);
        else if (b.type === 'divider') out.push('<hr>');
        else out.push(`<p>${t}</p>`);
      }
    }
    close();
    const title = esc(page.title || 'Untitled');
    return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${title}</title>\n` +
      `<style>body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#222}</style>\n` +
      `</head><body>\n<h1>${title}</h1>\n${out.join('\n')}\n</body></html>\n`;
  }

  // RFC 4180 quoting: wrap when the cell has a comma, quote, or line break.
  const csvCell = v => {
    const s = textOf(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  function toCsv(db, rows) {
    const header = ['Name', ...db.schema.map(p => p.name)];
    const body = rows.map(r => [r.title || 'Untitled', ...db.schema.map(p => r.props?.[p.id])]);
    return [header, ...body].map(line => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  return { toMarkdown, toHtml, toCsv };
});
