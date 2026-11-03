// The page a visitor opens from a form's link. One self-contained HTML document: no files to host, no website
// deploy needed. The questions are embedded in the page, so opening it costs at most one read (and usually none:
// forms-core keeps the form for a minute).
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// JSON that is safe inside a <script> block.
const embed = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const CSS = `
:root{color-scheme:light dark;--bg:#f6f5f2;--card:#fff;--fg:#1d1b18;--mute:#6b665e;--line:#e4e0d8;--accent:#4f46e5;--on:#fff;--err:#b42318}
@media(prefers-color-scheme:dark){:root{--bg:#141311;--card:#1d1b18;--fg:#f1eee8;--mute:#a39d92;--line:#33302b;--accent:#8b83ff;--on:#12110f;--err:#ff8a7a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:640px;margin:0 auto;padding:28px 16px 64px}
header,.q,.note{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-bottom:14px}
header{border-top:6px solid var(--accent)}h1{margin:0 0 6px;font-size:1.6rem;line-height:1.2}p{margin:0;color:var(--mute);white-space:pre-wrap}
.q label.t{display:block;font-weight:600;margin-bottom:10px}.req{color:var(--err)}
input[type=text],input[type=date],textarea,select{width:100%;font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:9px;padding:10px 12px}
textarea{min-height:110px;resize:vertical}input:focus,textarea:focus,select:focus{outline:2px solid var(--accent);outline-offset:1px}
.opt{display:flex;gap:10px;align-items:center;padding:6px 0;cursor:pointer}.opt input{width:18px;height:18px;accent-color:var(--accent)}
.scale{display:flex;gap:8px;flex-wrap:wrap}.scale label{cursor:pointer}.scale input{position:absolute;opacity:0}
.scale span{display:grid;place-items:center;width:42px;height:42px;border:1px solid var(--line);border-radius:50%;font-weight:600}
.scale input:checked+span{background:var(--accent);color:var(--on);border-color:var(--accent)}.scale input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}
.ends{display:flex;justify-content:space-between;color:var(--mute);font-size:.85rem;margin-top:6px}
.err{color:var(--err);font-size:.9rem;margin-top:8px}.q.bad{border-color:var(--err)}
button{font:inherit;font-weight:600;background:var(--accent);color:var(--on);border:0;border-radius:10px;padding:11px 22px;cursor:pointer}button:disabled{opacity:.6;cursor:default}
.note{text-align:center}.note h2{margin:0 0 6px}footer{margin-top:26px;text-align:center;color:var(--mute);font-size:.85rem}
`;

const SCRIPT = `
(function(){
  var F = window.FORM, root = document.getElementById('form'), answers = {};
  function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var inputs = {};
  F.questions.forEach(function(q){
    var box = el('div', 'q'), t = el('label', 't', q.title || 'Untitled question');
    if (q.required) { var s = el('span', 'req', ' *'); t.append(s); }
    box.append(t);
    var get;
    if (q.type === 'short') { var a = el('input'); a.type = 'text'; a.maxLength = 2000; t.htmlFor = a.id = 'q' + q.id; box.append(a); get = function(){ return a.value; }; }
    else if (q.type === 'paragraph') { var p = el('textarea'); p.maxLength = 2000; t.htmlFor = p.id = 'q' + q.id; box.append(p); get = function(){ return p.value; }; }
    else if (q.type === 'date') { var d = el('input'); d.type = 'date'; t.htmlFor = d.id = 'q' + q.id; box.append(d); get = function(){ return d.value; }; }
    else if (q.type === 'dropdown') {
      var sel = el('select'); sel.id = 'q' + q.id; t.htmlFor = sel.id; sel.append(el('option', '', 'Choose')); sel.firstChild.value = '';
      q.options.forEach(function(o){ var op = el('option', '', o); op.value = o; sel.append(op); }); box.append(sel); get = function(){ return sel.value; };
    } else if (q.type === 'choice' || q.type === 'checkbox') {
      var multi = q.type === 'checkbox', boxes = [];
      q.options.forEach(function(o){
        var row = el('label', 'opt'), i = el('input'); i.type = multi ? 'checkbox' : 'radio'; i.name = 'q' + q.id; i.value = o; boxes.push(i);
        row.append(i, el('span', '', o)); box.append(row);
      });
      get = function(){ var v = boxes.filter(function(b){ return b.checked; }).map(function(b){ return b.value; }); return multi ? v : v[0]; };
    } else if (q.type === 'scale') {
      var wrap = el('div', 'scale'), radios = [];
      for (var n = 1; n <= q.max; n++) { var l = el('label'), r = el('input'); r.type = 'radio'; r.name = 'q' + q.id; r.value = n; radios.push(r); l.append(r, el('span', '', String(n))); wrap.append(l); }
      box.append(wrap);
      if (q.low || q.high) { var ends = el('div', 'ends'); ends.append(el('span', '', q.low || ''), el('span', '', q.high || '')); box.append(ends); }
      get = function(){ var c = radios.filter(function(b){ return b.checked; })[0]; return c ? Number(c.value) : 0; };
    } else return;
    inputs[q.id] = { q: q, box: box, get: get };
    root.append(box);
  });
  var bar = el('div'), go = el('button', '', 'Submit'); go.type = 'button'; bar.append(go); root.append(bar);
  function blank(q, v){ return v == null || v === '' || (Array.isArray(v) && !v.length) || (q.type === 'scale' && v === 0); }
  function setErr(box, msg){ var old = box.querySelector('.err'); if (old) old.remove(); box.classList.toggle('bad', !!msg); if (msg) box.append(el('div', 'err', msg)); }
  go.onclick = function(){
    var bad = null, out = {};
    Object.keys(inputs).forEach(function(id){
      var x = inputs[id], v = x.get(); setErr(x.box, '');
      if (blank(x.q, v)) { if (x.q.required) { setErr(x.box, 'This question is required.'); bad = bad || x.box; } return; }
      out[id] = v;
    });
    if (bad) { bad.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    go.disabled = true; go.textContent = 'Sending...';
    var base = location.pathname.replace(/\\/f\\/[^/]*$/, '');
    fetch(base + '/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: F.id, answers: out }) })
      .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
      .then(function(r){
        if (r.ok) { root.replaceChildren(); var n = el('div', 'note'); n.append(el('h2', '', 'Thank you'), el('p', '', 'Your answer was sent.')); root.append(n); window.scrollTo(0, 0); return; }
        var e = r.j && r.j.error || {}, errs = e.errors || {};
        Object.keys(errs).forEach(function(id){ if (inputs[id]) setErr(inputs[id].box, errs[id]); });
        go.disabled = false; go.textContent = 'Submit'; setErr(bar, e.message || 'Something went wrong. Please try again.');
      })
      .catch(function(){ go.disabled = false; go.textContent = 'Submit'; setErr(bar, 'Could not send. Check your connection and try again.'); });
  };
})();
`;

function layout(title, body, head = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style>${head}</head><body><main>${body}<footer>Made with Vayun</footer></main></body></html>`;
}

function noticePage(title, message) {
  return layout(title, `<div class="note"><h2>${esc(title)}</h2><p>${esc(message)}</p></div>`);
}

// nonce: lets exactly this page's script run under the strict policy index.js sends with it.
function renderForm(id, view, nonce) {
  if (!view.open) return noticePage(view.title, 'This form is closed and is not taking answers any more.');
  const head = `<script nonce="${esc(nonce)}">window.FORM=${embed({ id, questions: view.questions })};</script>`;
  const body = `<header><h1>${esc(view.title)}</h1>${view.description ? `<p>${esc(view.description)}</p>` : ''}${view.closesOn ? `<p>Open until ${esc(view.closesOn)}</p>` : ''}</header><div id="form"></div><script nonce="${esc(nonce)}">${SCRIPT}</script>`;
  return layout(view.title, body, head);
}

module.exports = { renderForm, noticePage };
