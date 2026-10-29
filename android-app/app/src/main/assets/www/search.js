// Shared by the main window's search modal and the Quick Search panel.
const tokenize = s => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const pageText = p => p.blocks.map(b => b.text).join(' ');

// Every query term must match a word prefix; title hits outrank body hits.
function search(query, pages) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const out = [];
  for (const p of pages) {
    const tw = tokenize(p.title), bw = tokenize(pageText(p));
    let score = 0;
    for (const t of terms) {
      const inTitle = tw.some(w => w.startsWith(t)), inBody = bw.some(w => w.startsWith(t));
      if (!inTitle && !inBody) { score = -1; break; }
      score += (inTitle ? 10 : 0) + (inBody ? 1 : 0) + (tw.includes(t) ? 2 : 0);
    }
    if (score > 0) out.push({ page: p, score });
  }
  return out.sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title)).map(r => r.page);
}

const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function highlight(text, terms) {
  if (!terms.length) return esc(text);
  const re = new RegExp('(^|[^\\p{L}\\p{N}])(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'giu');
  return esc(text).replace(re, '$1<mark>$2</mark>');
}

function snippet(body, terms) {
  const lower = body.toLowerCase();
  const i = terms.map(t => lower.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, i - 30);
  return (start ? '…' : '') + body.slice(start, start + 120);
}

// Keyboard-driven result list. Returns reset(), called each time search opens.
function mountSearch({ input, list, label, getPages, getRecent, onOpen, onClose }) {
  let items = [], active = 0;

  function render() {
    const terms = tokenize(input.value);
    items = terms.length ? search(input.value, getPages()) : getRecent();
    label.textContent = terms.length ? 'Pages' : 'Recent';
    active = Math.min(active, Math.max(0, items.length - 1));
    list.innerHTML = items.length
      ? items.map((p, i) => `<li id="r-${i}" role="option" aria-selected="${i === active}" data-i="${i}">
          <div class="title">${highlight(p.title || 'Untitled', terms)}</div>
          <div class="snippet">${highlight(snippet(pageText(p), terms), terms)}</div></li>`).join('')
      : `<li class="empty" aria-disabled="true">${terms.length ? 'No results' : 'No recent pages'}</li>`;
    input.setAttribute('aria-activedescendant', items.length ? `r-${active}` : '');
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); active = (active + 1) % items.length; render(); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); onOpen(items[active]); }
    else if (e.key === 'Escape') onClose();
  });
  list.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) onOpen(items[+li.dataset.i]); });

  return { reset() { input.value = ''; active = 0; render(); input.focus(); } };
}

// Self-check for the ranking logic.
{
  const P = [
    { id: 'a', title: 'Engineering Handbook', blocks: [{ text: 'deploy process' }] },
    { id: 'b', title: 'Roadmap', blocks: [{ text: 'engineering hiring' }] },
  ];
  console.assert(search('eng', P)[0].id === 'a', 'title match ranks first');
  console.assert(search('eng deploy', P).length === 1, 'all terms required');
  console.assert(search('zzz', P).length === 0 && search(' ', P).length === 0, 'no match / empty');
}
