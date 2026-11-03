// Form page: build a form, fill it in, and read the answers as a dashboard (numbers, charts, a month of activity,
// reminders). Everything is stored on the page (page.form). Rules and numbers live in forms-logic.js. Text from people
// is only ever set as text, never as markup.
(function (root) {
  const { h } = root.FolioUI;
  const F = root.FolioForms;
  const uid = () => crypto.randomUUID().slice(0, 8);
  const PALETTE = ['#8ea2ff', '#f2b35c', '#6fd3a0', '#e97b8f', '#b59cff', '#5fc4d6', '#d9a066', '#9ad06f'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const today = () => F.dayKey(new Date());
  const shortDate = d => { const [, m, day] = d.split('-').map(Number); return `${SHORT_MONTHS[m - 1]} ${day}`; };
  const daysUntil = d => Math.round((Date.parse(d) - Date.parse(today())) / 86400000);
  const when = iso => { const d = new Date(iso); return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const countdown = d => { const n = daysUntil(d); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 0 ? `in ${plural(n, 'day')}` : `${plural(-n, 'day')} ago`; };

  function mount(host, page, { onChange, onTitle, addEvents, exportCsv, pickFile, cloud, openLink }) {
    page.form = F.sanitize(page.form, uid);
    const form = page.form;
    let tab = form.published && form.responses.length ? 'responses' : 'build';
    let fill = { answers: {}, errors: {}, done: false };
    let days = 14;
    let month = new Date();
    let linkUrl = '';
    let lastAuto = 0;
    let shareNote = '';
    host.innerHTML = '';
    host.className = 'formpage';
    const save = () => onChange();

    function draw() {
      host.innerHTML = '';
      host.append(header(), tab === 'build' ? build() : tab === 'fill' ? fillIn() : responses());
    }

    // ---- header: title, state, tabs ----
    function status() {
      if (!form.published) return ['Draft', 'gray'];
      return F.isOpen(form, today()) ? ['Open', 'green'] : ['Closed', 'amber'];
    }
    function header() {
      const [label, tone] = status();
      const title = h('input', { class: 'fm-title', value: page.title || '', placeholder: 'Untitled form', 'aria-label': 'Form title', oninput: e => { page.title = e.target.value; onTitle(); } });
      const publish = h('button', { type: 'button', class: form.published ? 'fm-btn' : 'fm-btn primary', onclick: () => { form.published = !form.published; save(); if (cloud && form.pub) cloud.setOpen({ id: form.pub.id, open: form.published }).then(r => { if (!r.error) { form.pub.open = form.published; save(); } }); draw(); } }, form.published ? 'Unpublish' : 'Publish');
      const tabs = h('div', { class: 'fm-tabs', role: 'tablist' }, [['build', 'Build'], ['fill', 'Fill in'], ['responses', `Responses${form.responses.length ? ` (${form.responses.length})` : ''}`]].map(([id, text]) =>
        h('button', { type: 'button', role: 'tab', class: tab === id ? 'on' : '', 'aria-selected': String(tab === id), onclick: () => { tab = id; if (id === 'fill') fill = { answers: {}, errors: {}, done: false }; draw(); } }, text)));
      return h('header', { class: 'fm-head' },
        h('div', { class: 'fm-top' }, title, h('span', { class: `fm-state fm-${tone}` }, label), publish),
        tabs);
    }

    // ---- build ----
    function build() {
      const list = h('div', { class: 'fm-questions' }, form.questions.map((q, i) => questionCard(q, i)));
      const add = h('div', { class: 'fm-add' }, h('span', null, 'Add a question'), F.TYPES.map(([type, name]) =>
        h('button', { type: 'button', onclick: () => { form.questions.push(F.newQuestion(type, uid)); save(); draw(); } }, name)));
      const desc = h('textarea', { class: 'fm-desc', rows: 2, placeholder: 'Describe the form for the people who fill it in (optional)', 'aria-label': 'Form description', oninput: e => { form.description = e.target.value; save(); } });
      desc.value = form.description;
      return h('div', { class: 'fm-body' }, h('div', { class: 'fm-card' }, desc), list, add, settings(), shareCard());
    }

    function questionCard(q, i) {
      const move = (by) => { const j = i + by; if (j < 0 || j >= form.questions.length) return; [form.questions[i], form.questions[j]] = [form.questions[j], form.questions[i]]; save(); draw(); };
      const type = h('select', { 'aria-label': 'Question type', onchange: e => {
        const next = F.newQuestion(e.target.value, uid);
        Object.assign(q, { type: next.type }, next.options ? { options: q.options && q.options.length ? q.options : next.options } : {}, next.type === 'scale' ? { max: next.max, low: '', high: '' } : {});
        if (!next.options) delete q.options;
        if (next.type !== 'scale') { delete q.max; delete q.low; delete q.high; }
        save(); draw();
      } }, F.TYPES.map(([v, name]) => h('option', { value: v, selected: v === q.type }, name)));
      const title = h('input', { class: 'fm-q-title', value: q.title, placeholder: 'Question', 'aria-label': `Question ${i + 1}`, oninput: e => { q.title = e.target.value; save(); } });
      const req = h('label', { class: 'fm-req' }, h('input', { type: 'checkbox', checked: q.required, onchange: e => { q.required = e.target.checked; save(); } }), 'Required');
      const tools = h('div', { class: 'fm-q-tools' },
        h('button', { type: 'button', 'aria-label': 'Move up', title: 'Move up', disabled: i === 0, onclick: () => move(-1) }, '↑'),
        h('button', { type: 'button', 'aria-label': 'Move down', title: 'Move down', disabled: i === form.questions.length - 1, onclick: () => move(1) }, '↓'),
        h('button', { type: 'button', 'aria-label': 'Duplicate', title: 'Duplicate', onclick: () => { form.questions.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(q)), id: uid() }); save(); draw(); } }, '⧉'),
        h('button', { type: 'button', class: 'danger', 'aria-label': 'Delete question', title: 'Delete', onclick: () => {
          if (q.title || form.responses.length) { if (!confirm(form.responses.length ? 'Delete this question? Its answers in the existing responses are removed from the dashboard.' : 'Delete this question?')) return; }
          form.questions.splice(i, 1); if (!form.questions.length) form.questions.push(F.newQuestion('short', uid)); save(); draw();
        } }, '🗑'));
      const body = [];
      if (F.WITH_OPTIONS.has(q.type)) {
        const opts = h('textarea', { class: 'fm-options', rows: Math.min(8, Math.max(3, q.options.length + 1)), 'aria-label': 'Options, one per line', oninput: e => { q.options = [...new Set(e.target.value.split('\n').map(s => s.trim()).filter(Boolean))].slice(0, F.LIMITS.options); save(); } });
        opts.value = q.options.join('\n');
        body.push(h('label', { class: 'fm-field' }, h('span', null, 'Options, one per line'), opts));
      } else if (q.type === 'scale') {
        body.push(h('div', { class: 'fm-scale-set' },
          h('label', { class: 'fm-field' }, h('span', null, 'Scale 1 to'), h('select', { onchange: e => { q.max = Number(e.target.value); save(); } }, [3, 4, 5, 6, 7, 8, 9, 10].map(n => h('option', { value: n, selected: n === q.max }, n)))),
          h('label', { class: 'fm-field' }, h('span', null, 'Low label'), h('input', { value: q.low, placeholder: 'e.g. Poor', oninput: e => { q.low = e.target.value; save(); } })),
          h('label', { class: 'fm-field' }, h('span', null, 'High label'), h('input', { value: q.high, placeholder: 'e.g. Great', oninput: e => { q.high = e.target.value; save(); } }))));
      } else {
        body.push(h('p', { class: 'fm-hint' }, q.type === 'paragraph' ? 'A longer answer.' : q.type === 'date' ? 'The person picks a date.' : 'A short line of text.'));
      }
      return h('section', { class: 'fm-card fm-q' }, h('div', { class: 'fm-q-head' }, type, req, tools), title, body);
    }

    function settings() {
      const closes = h('input', { type: 'date', value: form.closesOn, 'aria-label': 'Closes on', onchange: e => { form.closesOn = F.isDay(e.target.value) ? e.target.value : ''; save(); draw(); } });
      const review = h('input', { type: 'date', value: form.reviewOn, 'aria-label': 'Review on', onchange: e => { form.reviewOn = F.isDay(e.target.value) ? e.target.value : ''; save(); draw(); } });
      const events = F.calendarReminders(form, page.title);
      const note = h('span', { class: 'fm-hint', role: 'status' }, '');
      const cal = h('button', { type: 'button', class: 'fm-btn', disabled: !events.length, onclick: () => { const n = addEvents(events); note.textContent = n ? `Added ${plural(n, 'reminder')} to your calendar.` : 'Those reminders are already on your calendar.'; } }, 'Add reminders to Calendar');
      return h('section', { class: 'fm-card fm-settings' }, h('h3', null, 'Dates and reminders'),
        h('div', { class: 'fm-dates' },
          h('label', { class: 'fm-field' }, h('span', null, 'Stops accepting answers after'), closes),
          h('label', { class: 'fm-field' }, h('span', null, 'Remind me to review the answers on'), review)),
        h('div', { class: 'fm-row' }, cal, note),
        h('p', { class: 'fm-hint' }, 'Publish the form, then people in this app can fill it in from the Fill in tab. A public web link is coming next.'));
    }

    // ---- fill in ----
    function fillIn() {
      const open = F.isOpen(form, today());
      if (fill.done) {
        return h('div', { class: 'fm-body fm-fill' }, h('section', { class: 'fm-card fm-thanks' }, h('h2', null, 'Thank you'), h('p', null, 'Your response was recorded.'),
          h('div', { class: 'fm-row' }, h('button', { type: 'button', class: 'fm-btn primary', onclick: () => { fill = { answers: {}, errors: {}, done: false }; draw(); } }, 'Fill in again'),
            h('button', { type: 'button', class: 'fm-btn', onclick: () => { tab = 'responses'; draw(); } }, 'See responses'))));
      }
      const banner = !form.published ? 'This is a preview. Publish the form to start collecting responses.'
        : !open ? `This form stopped accepting answers after ${shortDate(form.closesOn)}.` : '';
      const fields = form.questions.map(q => h('section', { class: `fm-card fm-ask${fill.errors[q.id] ? ' bad' : ''}` },
        h('label', { class: 'fm-ask-title', for: `q-${q.id}` }, q.title || 'Untitled question', q.required ? h('span', { class: 'fm-star', 'aria-label': 'required' }, ' *') : null),
        control(q),
        fill.errors[q.id] ? h('p', { class: 'fm-err', role: 'alert' }, fill.errors[q.id]) : null));
      const submit = h('button', { type: 'submit', class: 'fm-btn primary', disabled: !open }, 'Submit');
      return h('form', { class: 'fm-body fm-fill', novalidate: true, onsubmit: e => {
        e.preventDefault();
        if (!open) return;
        const v = F.validate(form, fill.answers);
        fill.errors = v.errors;
        if (Object.keys(v.errors).length) { draw(); host.querySelector('.fm-ask.bad')?.scrollIntoView({ block: 'center' }); return; }
        F.addResponse(form, v.answers, { id: uid() });
        save();
        fill = { answers: {}, errors: {}, done: true };
        draw();
      } }, h('div', { class: 'fm-card fm-intro' }, h('h2', null, page.title || 'Untitled form'), form.description ? h('p', null, form.description) : null, banner ? h('p', { class: 'fm-banner' }, banner) : null), fields, h('div', { class: 'fm-row' }, submit));
    }

    function control(q) {
      const set = v => { fill.answers[q.id] = v; if (fill.errors[q.id]) { delete fill.errors[q.id]; host.querySelector(`#q-${q.id}`)?.closest('.fm-ask')?.classList.remove('bad'); } };
      const a = fill.answers[q.id];
      if (q.type === 'short') return h('input', { id: `q-${q.id}`, class: 'fm-input', value: a || '', oninput: e => set(e.target.value) });
      if (q.type === 'paragraph') { const t = h('textarea', { id: `q-${q.id}`, class: 'fm-input', rows: 4, oninput: e => set(e.target.value) }); t.value = a || ''; return t; }
      if (q.type === 'date') return h('input', { id: `q-${q.id}`, class: 'fm-input fm-date', type: 'date', value: a || '', onchange: e => set(e.target.value) });
      if (q.type === 'dropdown') return h('select', { id: `q-${q.id}`, class: 'fm-input', onchange: e => set(e.target.value) }, h('option', { value: '' }, 'Choose…'), q.options.map(o => h('option', { value: o, selected: a === o }, o)));
      if (q.type === 'choice') return h('div', { id: `q-${q.id}`, role: 'radiogroup', class: 'fm-opts' }, q.options.map(o => h('label', { class: 'fm-opt' }, h('input', { type: 'radio', name: `r-${q.id}`, checked: a === o, onchange: () => set(o) }), o)));
      if (q.type === 'checkbox') return h('div', { id: `q-${q.id}`, class: 'fm-opts' }, q.options.map(o => h('label', { class: 'fm-opt' }, h('input', { type: 'checkbox', checked: (a || []).includes(o), onchange: e => { const cur = new Set(fill.answers[q.id] || []); if (e.target.checked) cur.add(o); else cur.delete(o); set([...cur]); } }), o)));
      // scale
      return h('div', { id: `q-${q.id}`, class: 'fm-scale', role: 'radiogroup' }, q.low ? h('span', { class: 'fm-end' }, q.low) : null,
        Array.from({ length: q.max }, (_, i) => h('label', { class: 'fm-pick' }, h('input', { type: 'radio', name: `r-${q.id}`, checked: a === i + 1, onchange: () => set(i + 1) }), h('span', null, i + 1))),
        q.high ? h('span', { class: 'fm-end' }, q.high) : null);
    }


    // ---- the web link: anyone with it fills the form in a browser; the answers come back here ----
    // Cost to the shared Firebase allowance: nothing runs in the background. Answers are fetched when this page's
    // Responses tab opens (at most once a minute) or when Sync is pressed, and only the ones that are new.
    const say = text => { shareNote = text; const n = host.querySelector('.fm-sharenote'); if (n) n.textContent = text; };
    async function createLink() {
      say('Working…');
      const r = await cloud.publish({ id: form.pub && form.pub.id, title: page.title, form: F.publicDefinition(form) });
      if (r.error) return say(r.error);
      const updating = Boolean(form.pub);
      form.published = true;
      form.pub = { id: r.id, after: form.pub ? form.pub.after : 0, open: true, syncedAt: form.pub ? form.pub.syncedAt : '' };
      linkUrl = r.link;
      shareNote = updating ? 'Updated. The link is the same.' : 'Your link is ready. Copy it and send it to the people who should fill the form in.';
      save(); draw();
    }
    // Returns how many new answers came in, or null when it could not reach the server.
    async function syncNow(quiet) {
      if (!cloud || !form.pub) return null;
      let total = 0;
      for (let i = 0; i < 10; i++) {
        const r = await cloud.pull({ id: form.pub.id, after: form.pub.after });
        if (r.error) { if (!quiet) say(r.error); return null; }
        total += F.addRemote(form, r.responses, { uid });
        form.pub.open = r.open;
        if (r.responses.length < 500) break;
      }
      form.pub.syncedAt = new Date().toISOString();
      save();
      return total;
    }
    function autoSync() {
      if (!cloud || !form.pub || Date.now() - lastAuto < 60000) return;
      lastAuto = Date.now();
      syncNow(true).then(n => { if (n) { shareNote = `${plural(n, 'new response')} from the web link.`; if (tab === 'responses') draw(); } });
    }
    function shareCard() {
      if (!cloud) return null;
      const pub = form.pub;
      if (!pub) {
        return h('section', { class: 'fm-card fm-share' }, h('div', { class: 'fm-card-head' }, h('h3', null, 'Share with a web link')),
          h('p', null, 'Anyone with the link can fill this form in on their phone or computer, with no account. Their answers come back to this page.'),
          h('div', { class: 'fm-row' }, h('button', { type: 'button', class: 'fm-btn primary', onclick: createLink }, 'Create web link'), h('span', { class: 'fm-hint fm-sharenote', role: 'status' }, shareNote)));
      }
      if (!linkUrl) cloud.link(pub.id).then(l => { linkUrl = l; const i = host.querySelector('.fm-linkbox'); if (i) i.value = l; });
      const box = h('input', { class: 'fm-linkbox', readonly: true, value: linkUrl, 'aria-label': 'Web link' });
      const copy = h('button', { type: 'button', class: 'fm-btn primary', onclick: async () => { box.select(); try { await navigator.clipboard.writeText(box.value); say('Link copied.'); } catch { say('Press Ctrl+C to copy the link.'); } } }, 'Copy link');
      const synced = pub.syncedAt ? 'Last checked ' + when(pub.syncedAt) + '.' : 'Not checked yet.';
      const sync = async () => { say('Checking…'); const n = await syncNow(false); if (n != null) { shareNote = n ? plural(n, 'new response') + '.' : 'Nothing new.'; draw(); } };
      const toggle = async () => {
        const r = await cloud.setOpen({ id: pub.id, open: !pub.open });
        if (r.error) return say(r.error);
        pub.open = !pub.open; form.published = pub.open; save(); draw();
      };
      const remove = async () => {
        if (!confirm('Remove the web link? People who have it will see that the form is gone. Answers already in this page stay.')) return;
        const r = await cloud.remove({ id: pub.id });
        if (r.error && !/does not exist/.test(r.error)) return say(r.error);
        delete form.pub; linkUrl = ''; shareNote = 'The link was removed.'; save(); draw();
      };
      return h('section', { class: 'fm-card fm-share' },
        h('div', { class: 'fm-card-head' }, h('h3', null, 'Web link'), h('span', { class: 'fm-state fm-' + (pub.open ? 'green' : 'amber') }, pub.open ? 'Taking answers' : 'Not taking answers')),
        h('div', { class: 'fm-linkrow' }, box, copy, h('button', { type: 'button', class: 'fm-btn', onclick: () => linkUrl && openLink(linkUrl) }, 'Open')),
        h('div', { class: 'fm-row' },
          h('button', { type: 'button', class: 'fm-btn', onclick: sync }, 'Sync responses'),
          h('button', { type: 'button', class: 'fm-btn', title: 'Send your latest questions to the link. The link stays the same.', onclick: createLink }, 'Update shared form'),
          h('button', { type: 'button', class: 'fm-btn', onclick: toggle }, pub.open ? 'Stop taking answers' : 'Take answers again'),
          h('button', { type: 'button', class: 'fm-btn', onclick: remove }, 'Remove link')),
        h('p', { class: 'fm-hint' }, synced + ' Changed the questions? Press Update shared form.'),
        h('p', { class: 'fm-hint fm-sharenote', role: 'status' }, shareNote));
    }

    // Responses exported from a Google Form (Excel or CSV): new ones are added and changed ones updated, so importing
    // a newer export keeps the same entries. Not offered where there is no file picker (phone and web builds).
    async function importFromFile() {
      const r = await pickFile();
      if (!r) return;
      if (r.error) return alert(`Could not import: ${r.error}`);
      let res;
      try { res = F.mergeTable(form, r.rows, { uid }); } catch (err) { return alert(`Could not import: ${err.message}`); }
      form.source = form.source || { kind: 'google' };
      save();
      tab = 'responses';
      draw();
      alert(res.added + res.updated ? `Imported: ${plural(res.added, 'new response')}, ${res.updated} updated, ${res.unchanged} unchanged.` : 'Nothing new: every response in that file is already here.');
    }
    const importButton = () => (pickFile ? h('button', { type: 'button', class: 'fm-btn', onclick: importFromFile }, 'Import Google Form responses') : null);

    // ---- responses: the dashboard ----
    function responses() {
      autoSync();
      if (!form.responses.length) {
        return h('div', { class: 'fm-body' }, shareCard(), h('section', { class: 'fm-card fm-empty' }, h('h2', null, 'No responses yet'),
          h('p', null, form.published ? 'Answers appear here as people fill the form in, with charts for every question.' : 'Publish the form, then fill it in or share it. Every answer lands here with charts for each question.'),
          h('div', { class: 'fm-row' }, h('button', { type: 'button', class: 'fm-btn primary', onclick: () => { tab = form.published ? 'fill' : 'build'; draw(); } }, form.published ? 'Fill it in' : 'Back to Build'), importButton())));
      }
      const s = F.summarize(form, { days });
      const stat = (label, value, sub) => h('div', { class: 'fm-stat' }, h('b', null, value), h('span', null, label), sub ? h('em', null, sub) : null);
      const cards = h('div', { class: 'fm-stats' },
        stat('Responses', s.total, s.last ? `last ${when(s.last)}` : ''), stat('Today', s.today), stat('Last 7 days', s.week), stat('Completion', `${s.completion}%`, 'questions answered'),
        form.closesOn ? stat(F.isOpen(form, today()) || daysUntil(form.closesOn) >= 0 ? 'Closes' : 'Closed', shortDate(form.closesOn), countdown(form.closesOn)) : null);
      const activity = h('section', { class: 'fm-card' }, h('div', { class: 'fm-card-head' }, h('h3', null, 'Responses per day'),
        h('div', { class: 'fm-seg' }, [14, 30].map(n => h('button', { type: 'button', class: days === n ? 'on' : '', 'aria-pressed': String(days === n), onclick: () => { days = n; draw(); } }, `${n} days`)))), barChart(s.perDay));
      const side = h('div', { class: 'fm-two' }, calendarCard(), remindersCard());
      const perQ = s.questions.map((q, i) => questionCard2(q, i));
      return h('div', { class: 'fm-body' }, shareCard(), cards, activity, side, h('div', { class: 'fm-qgrid' }, perQ), table(), h('div', { class: 'fm-row' }, h('button', { type: 'button', class: 'fm-btn', onclick: () => exportCsv(F.toCsv(form)) }, 'Export CSV'), importButton(), form.source ? h('span', { class: 'fm-hint' }, 'Linked to a Google Form export. Import a newer file to update.') : null));
    }

    function barChart(perDay) {
      const W = 640, H = 150, pad = { l: 8, r: 8, t: 18, b: 22 };
      const max = Math.max(1, ...perDay.map(d => d.count));
      const bw = (W - pad.l - pad.r) / perDay.length;
      const kids = [];
      perDay.forEach((d, i) => {
        const bh = Math.round((H - pad.t - pad.b) * d.count / max);
        const x = pad.l + i * bw + bw * 0.18;
        kids.push(h('rect', { x, y: H - pad.b - bh, width: bw * 0.64, height: Math.max(bh, d.count ? 2 : 0), rx: 3, class: 'fm-bar' }));
        if (d.count) kids.push(h('text', { x: x + bw * 0.32, y: H - pad.b - bh - 5, 'text-anchor': 'middle', class: 'fm-num' }, d.count));
        if (i % Math.ceil(perDay.length / 7) === 0 || i === perDay.length - 1) kids.push(h('text', { x: x + bw * 0.32, y: H - 6, 'text-anchor': 'middle', class: 'fm-axis' }, shortDate(d.day)));
      });
      kids.push(h('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, class: 'fm-base' }));
      return h('svg', { viewBox: `0 0 ${W} ${H}`, class: 'fm-chart', role: 'img', 'aria-label': `Responses per day for the last ${perDay.length} days` }, kids);
    }

    function calendarCard() {
      const m = F.monthActivity(form, month.getFullYear(), month.getMonth());
      const t = today();
      const go = by => { month = new Date(month.getFullYear(), month.getMonth() + by, 1); draw(); };
      const rows = m.weeks.map(w => h('div', { class: 'fm-week' }, w.map(c => {
        if (!c) return h('span', { class: 'fm-day none' });
        const level = c.count ? Math.min(4, 1 + Math.floor(3 * c.count / Math.max(1, m.max))) : 0;
        const marks = [c.day === form.closesOn ? 'closes' : '', c.day === form.reviewOn ? 'review' : ''].filter(Boolean);
        return h('span', { class: `fm-day l${level}${c.day === t ? ' today' : ''}${marks.length ? ' mark' : ''}`, title: `${shortDate(c.day)}: ${plural(c.count, 'response')}${marks.length ? ` · ${marks.join(', ')}` : ''}` }, c.n);
      })));
      return h('section', { class: 'fm-card' }, h('div', { class: 'fm-card-head' }, h('h3', null, `${MONTHS[month.getMonth()]} ${month.getFullYear()}`),
        h('div', { class: 'fm-seg' }, h('button', { type: 'button', 'aria-label': 'Previous month', onclick: () => go(-1) }, '‹'), h('button', { type: 'button', 'aria-label': 'Next month', onclick: () => go(1) }, '›'))),
        h('div', { class: 'fm-week head' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => h('span', null, d))), rows,
        h('p', { class: 'fm-hint' }, 'Darker days had more responses. A ring marks the closing and review days.'));
    }

    function remindersCard() {
      const items = F.calendarReminders(form, page.title);
      const list = items.length ? h('ul', { class: 'fm-remind' }, items.map(e => h('li', null, h('b', null, e.key === 'closes' ? 'Form closes' : 'Review the answers'), h('span', null, `${shortDate(e.startDate)} · ${countdown(e.startDate)}`))))
        : h('p', { class: 'fm-hint' }, 'No dates set. Add a closing day and a review day in Build.');
      const note = h('span', { class: 'fm-hint', role: 'status' }, '');
      const add = h('button', { type: 'button', class: 'fm-btn', disabled: !items.length, onclick: () => { const n = addEvents(items); note.textContent = n ? `Added ${plural(n, 'reminder')} to your calendar.` : 'Already on your calendar.'; } }, 'Add to Calendar');
      return h('section', { class: 'fm-card' }, h('div', { class: 'fm-card-head' }, h('h3', null, 'Reminders')), list, h('div', { class: 'fm-row' }, add, note));
    }

    function questionCard2(q, i) {
      const head = h('div', { class: 'fm-card-head' }, h('h3', null, q.title), h('span', { class: 'fm-count' }, `${plural(q.answered, 'answer')}${q.skipped ? ` · ${q.skipped} skipped` : ''}`));
      let body;
      if (q.kind === 'choice') body = q.answered ? (!q.multi && q.counts.length <= 8 ? donut(q) : bars(q)) : none();
      else if (q.kind === 'scale') body = q.answered ? h('div', { class: 'fm-scale-sum' }, h('div', { class: 'fm-avg' }, h('b', null, q.avg), h('span', null, `average out of ${q.max}`)), bars({ counts: q.hist.map(x => ({ label: x.label, count: x.count, pct: q.answered ? Math.round(100 * x.count / q.answered) : 0 })) }, true)) : none();
      else if (q.kind === 'date') body = q.dates.length ? h('div', { class: 'fm-chips' }, q.dates.map(d => h('span', { class: 'fm-chip' }, shortDate(d)))) : none();
      else body = q.latest.length ? h('ul', { class: 'fm-latest' }, q.latest.map(x => h('li', null, h('span', null, x.text), h('em', null, when(x.at))))) : none();
      return h('section', { class: 'fm-card fm-qsum' }, head, body);
    }
    const none = () => h('p', { class: 'fm-hint' }, 'No answers yet.');

    function bars(q, compact) {
      const max = Math.max(1, ...q.counts.map(c => c.count));
      return h('div', { class: `fm-hbars${compact ? ' compact' : ''}` }, q.counts.map((c, i) => h('div', { class: 'fm-hbar' },
        h('span', { class: 'fm-hlabel' }, c.label), h('span', { class: 'fm-htrack' }, h('i', { style: `width:${Math.round(100 * c.count / max)}%;background:${PALETTE[i % PALETTE.length]}` })),
        h('span', { class: 'fm-hval' }, `${c.count} · ${c.pct}%`))));
    }

    function donut(q) {
      const total = q.counts.reduce((s, c) => s + c.count, 0);
      const R = 44, C = 2 * Math.PI * R;
      let offset = 0;
      const arcs = q.counts.filter(c => c.count).map(c => {
        const len = C * c.count / total;
        const el = h('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: PALETTE[q.counts.indexOf(c) % PALETTE.length], 'stroke-width': 18, 'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -offset });
        offset += len;
        return el;
      });
      const svg = h('svg', { viewBox: '0 0 120 120', class: 'fm-donut', role: 'img', 'aria-label': `${q.title}: ${q.counts.map(c => `${c.label} ${c.pct}%`).join(', ')}` },
        h('g', { transform: 'rotate(-90 60 60)' }, arcs), h('text', { x: 60, y: 64, 'text-anchor': 'middle', class: 'fm-donut-n' }, total));
      const legend = h('ul', { class: 'fm-legend' }, q.counts.map((c, i) => h('li', null, h('i', { style: `background:${PALETTE[i % PALETTE.length]}` }), h('span', null, c.label), h('em', null, `${c.count} · ${c.pct}%`))));
      return h('div', { class: 'fm-pie' }, svg, legend);
    }

    function table() {
      const qs = form.questions.slice(0, 6);
      const rows = form.responses.slice(-25).reverse();
      const cell = (q, r) => { const v = r.answers[q.id]; return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v); };
      return h('section', { class: 'fm-card' }, h('div', { class: 'fm-card-head' }, h('h3', null, 'Latest responses'), h('span', { class: 'fm-count' }, rows.length < form.responses.length ? `showing ${rows.length} of ${form.responses.length}` : '')),
        h('div', { class: 'fm-tablewrap' }, h('table', { class: 'fm-table' },
          h('thead', null, h('tr', null, h('th', null, 'Submitted'), qs.map(q => h('th', null, q.title || 'Untitled')), h('th', null))),
          h('tbody', null, rows.map(r => h('tr', null, h('td', null, when(r.at)), qs.map(q => h('td', null, cell(q, r))),
            h('td', null, h('button', { type: 'button', class: 'fm-del', 'aria-label': 'Delete response', title: 'Delete response', onclick: () => { if (!confirm('Delete this response?')) return; form.responses = form.responses.filter(x => x.id !== r.id); save(); draw(); } }, '🗑'))))))));
    }

    draw();
    return { destroy() { host.innerHTML = ''; host.className = ''; } };
  }

  root.FolioFormsUI = { mount };
})(typeof self !== 'undefined' ? self : globalThis);
