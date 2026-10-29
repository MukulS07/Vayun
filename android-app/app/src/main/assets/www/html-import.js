// Converts an HTML document into page blocks. DOMParser builds an inert document:
// no scripts run and nothing loads, and only text is kept.
const INLINE = /^(A|ABBR|B|BDI|BDO|CITE|CODE|DATA|DEL|DFN|EM|FONT|I|INS|KBD|LABEL|MARK|Q|S|SAMP|SMALL|SPAN|STRONG|SUB|SUP|TIME|U|VAR|WBR)$/;

function htmlToBlocks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.title.trim();
  doc.querySelectorAll('script,style,noscript,template,svg,iframe,object,head').forEach(n => n.remove());
  const blocks = [];
  let run = '';
  const push = (type, text, extra) => {
    text = text.replace(/\s+/g, ' ').trim();
    if (text) blocks.push({ id: uid(), type, text, ...extra });
  };
  const flush = () => { push('text', run); run = ''; };

  const walk = el => {
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) { run += n.textContent; continue; }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = n.tagName;
      if (tag === 'BR') { run += ' '; continue; }
      if (INLINE.test(tag)) { run += n.textContent; continue; }
      flush();
      if (tag === 'H1') push('h1', n.textContent);
      else if (/^H[2-6]$/.test(tag)) push('h2', n.textContent);
      else if (tag === 'LI') {
        const own = n.cloneNode(true);
        own.querySelectorAll('ul,ol').forEach(l => l.remove()); // nested lists become their own items
        const box = own.querySelector('input[type=checkbox]');
        push(box ? 'todo' : 'bullet', own.textContent, box ? { checked: box.checked } : {});
        n.querySelectorAll(':scope > ul, :scope > ol').forEach(walk);
      } else if (tag === 'PRE') {
        if (n.textContent.trim()) blocks.push({ id: uid(), type: 'text', text: n.textContent.replace(/^\n|\n$/g, '') });
      } else if (tag === 'TR') push('text', [...n.cells].map(c => c.textContent.trim()).join(' | '));
      else if (tag === 'P' || tag === 'DT' || tag === 'DD' || tag === 'FIGCAPTION') push('text', n.textContent);
      else walk(n); // div, section, article, ul, ol, table, blockquote, …
    }
    flush();
  };
  walk(doc.body);
  return { title, blocks };
}
