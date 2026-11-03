// Forms made inside Vayun: the questions, one response per submission, and the numbers behind the dashboard
// (counts per answer, averages, responses per day, a month of activity). No DOM and no storage in here, so the app and
// the tests share it. A form lives on its page as page.form, and its responses with it.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else root.FolioForms = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const TYPES = [
    ['short', 'Short answer'], ['paragraph', 'Paragraph'], ['choice', 'Multiple choice'], ['checkbox', 'Checkboxes'],
    ['dropdown', 'Dropdown'], ['scale', 'Rating scale'], ['date', 'Date'],
  ];
  const WITH_OPTIONS = new Set(['choice', 'checkbox', 'dropdown']);
  const LIMITS = { questions: 60, options: 30, responses: 20000, text: 2000, title: 300 };
  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
  const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

  function newQuestion(type, uid) {
    const t = TYPES.some(x => x[0] === type) ? type : 'short';
    const q = { id: uid(), type: t, title: '', required: false };
    if (WITH_OPTIONS.has(t)) q.options = ['Option 1', 'Option 2'];
    if (t === 'scale') Object.assign(q, { max: 5, low: '', high: '' });
    return q;
  }

  function newForm(uid) {
    return { description: '', questions: [newQuestion('short', uid)], responses: [], published: false, closesOn: '', reviewOn: '' };
  }

  // Whatever is stored is cleaned on the way in, so a damaged file cannot break the page.
  function sanitize(f, uid) {
    const form = f && typeof f === 'object' ? f : newForm(uid);
    const seen = new Set();
    const questions = (Array.isArray(form.questions) ? form.questions : []).slice(0, LIMITS.questions).map(q => {
      const type = TYPES.some(x => x[0] === q.type) ? q.type : 'short';
      let id = typeof q.id === 'string' && q.id && !seen.has(q.id) ? q.id : uid();
      seen.add(id);
      const out = { id, type, title: clip(q.title, LIMITS.title), required: q.required === true };
      if (typeof q.src === 'string' && q.src) out.src = clip(q.src, LIMITS.title); // the column it came from in an imported file
      if (WITH_OPTIONS.has(type)) {
        out.options = [...new Set((Array.isArray(q.options) ? q.options : []).map(o => clip(o, 200).trim()).filter(Boolean))].slice(0, LIMITS.options);
        if (!out.options.length) out.options = ['Option 1'];
      }
      if (type === 'scale') {
        out.max = Math.min(10, Math.max(3, Math.round(Number(q.max)) || 5));
        out.low = clip(q.low, 60); out.high = clip(q.high, 60);
      }
      return out;
    });
    const ids = new Set(questions.map(q => q.id));
    const responses = (Array.isArray(form.responses) ? form.responses : []).slice(-LIMITS.responses)
      .filter(r => r && typeof r.id === 'string' && typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at)))
      .map(r => ({ id: r.id, at: r.at, ...(typeof r.key === 'string' && r.key ? { key: clip(r.key, 160) } : {}), answers: Object.fromEntries(Object.entries(r.answers && typeof r.answers === 'object' ? r.answers : {}).filter(([k]) => ids.has(k))) }));
    return {
      description: clip(form.description, LIMITS.text), questions, responses, published: form.published === true,
      closesOn: isDay(form.closesOn) ? form.closesOn : '', reviewOn: isDay(form.reviewOn) ? form.reviewOn : '',
      ...(form.source && form.source.kind === 'google' ? { source: { kind: 'google' } } : {}),
      ...(form.pub && /^[a-z0-9]{6,20}$/.test(form.pub.id) ? { pub: { id: form.pub.id, after: Math.max(0, Math.floor(Number(form.pub.after)) || 0), open: form.pub.open !== false, syncedAt: typeof form.pub.syncedAt === 'string' ? form.pub.syncedAt : '' } } : {}),
    };
  }

  const isBlank = (q, v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (q.type === 'scale' && v === 0);

  // Checks what someone filled in. Returns { errors: { questionId: message }, answers } with only valid answers kept.
  function validate(form, raw) {
    const errors = {}, answers = {};
    for (const q of form.questions) {
      const v = raw ? raw[q.id] : undefined;
      if (isBlank(q, v)) { if (q.required) errors[q.id] = 'This question is required.'; continue; }
      if (q.type === 'short' || q.type === 'paragraph') answers[q.id] = clip(String(v).trim(), LIMITS.text);
      else if (q.type === 'choice' || q.type === 'dropdown') {
        if (!q.options.includes(v)) errors[q.id] = 'Pick one of the options.'; else answers[q.id] = v;
      } else if (q.type === 'checkbox') {
        const picked = (Array.isArray(v) ? v : [v]).filter(x => q.options.includes(x));
        if (!picked.length) errors[q.id] = 'Pick at least one option.'; else answers[q.id] = [...new Set(picked)];
      } else if (q.type === 'scale') {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > q.max) errors[q.id] = `Pick a number from 1 to ${q.max}.`; else answers[q.id] = n;
      } else if (q.type === 'date') {
        if (!isDay(String(v))) errors[q.id] = 'Enter a date.'; else answers[q.id] = String(v);
      }
    }
    return { errors, answers };
  }

  // Is the form accepting answers on this day? It must be published and not past its closing date.
  function isOpen(form, today) {
    return form.published && (!form.closesOn || today <= form.closesOn);
  }

  function addResponse(form, answers, { id, now = new Date() }) {
    const res = { id, at: now.toISOString(), answers };
    form.responses.push(res);
    if (form.responses.length > LIMITS.responses) form.responses.shift();
    return res;
  }

  const localDay = iso => dayKey(new Date(iso));

  // Everything the dashboard shows. `now` is a Date; `days` is how long the activity chart is.
  function summarize(form, { now = new Date(), days = 14 } = {}) {
    const rs = form.responses;
    const today = dayKey(now);
    const perDayMap = new Map();
    for (const r of rs) { const d = localDay(r.at); perDayMap.set(d, (perDayMap.get(d) || 0) + 1); }
    const perDay = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = dayKey(d);
      perDay.push({ day: key, count: perDayMap.get(key) || 0 });
    }
    const weekStart = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
    const week = rs.filter(r => localDay(r.at) >= weekStart && localDay(r.at) <= today).length;
    const questions = form.questions.map(q => questionSummary(q, rs));
    // how fully people fill the form in: answered questions over all questions, averaged over responses
    const completion = rs.length && form.questions.length
      ? Math.round(100 * rs.reduce((s, r) => s + form.questions.filter(q => !isBlank(q, r.answers[q.id])).length, 0) / (rs.length * form.questions.length))
      : 0;
    const last = rs.length ? rs.reduce((a, r) => (r.at > a ? r.at : a), rs[0].at) : '';
    return { total: rs.length, today: perDayMap.get(today) || 0, week, completion, perDay, questions, last, busiest: perDay.reduce((a, d) => (d.count > a.count ? d : a), { day: '', count: 0 }) };
  }

  function questionSummary(q, rs) {
    const vals = rs.map(r => r.answers[q.id]).filter(v => !isBlank(q, v));
    const base = { id: q.id, title: q.title || 'Untitled question', type: q.type, answered: vals.length, skipped: rs.length - vals.length };
    if (WITH_OPTIONS.has(q.type)) {
      const counts = q.options.map(label => ({ label, count: 0 }));
      for (const v of vals) for (const x of (Array.isArray(v) ? v : [v])) { const c = counts.find(c => c.label === x); if (c) c.count++; }
      const total = counts.reduce((s, c) => s + c.count, 0);
      counts.forEach(c => { c.pct = total ? Math.round(100 * c.count / total) : 0; });
      return { ...base, kind: 'choice', counts, multi: q.type === 'checkbox' };
    }
    if (q.type === 'scale') {
      const hist = Array.from({ length: q.max }, (_, i) => ({ label: String(i + 1), count: vals.filter(v => v === i + 1).length }));
      const avg = vals.length ? Math.round(10 * vals.reduce((s, v) => s + v, 0) / vals.length) / 10 : 0;
      return { ...base, kind: 'scale', hist, avg, max: q.max };
    }
    if (q.type === 'date') {
      const upcoming = [...new Set(vals)].sort();
      return { ...base, kind: 'date', dates: upcoming.slice(0, 20) };
    }
    const latest = rs.filter(r => !isBlank(q, r.answers[q.id])).slice(-5).reverse().map(r => ({ text: r.answers[q.id], at: r.at }));
    return { ...base, kind: 'text', latest };
  }

  // A month of activity as weeks of days (Monday first), each with how many responses came that day.
  function monthActivity(form, year, month) {
    const counts = new Map();
    for (const r of form.responses) { const d = localDay(r.at); counts.set(d, (counts.get(d) || 0) + 1); }
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const length = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= length; d++) { const day = `${year}-${pad(month + 1)}-${pad(d)}`; cells.push({ day, n: d, count: counts.get(day) || 0 }); }
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return { weeks, max: Math.max(0, ...[...counts.values()]) };
  }

  const csvCell = v => { const s = Array.isArray(v) ? v.join('; ') : String(v == null ? '' : v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function toCsv(form) {
    const head = ['Submitted', ...form.questions.map(q => q.title || 'Untitled question')];
    const rows = form.responses.map(r => [r.at, ...form.questions.map(q => r.answers[q.id])]);
    return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }


  // ---- responses from a Google Form export (Excel or CSV) ----
  // The export has one column per question and a Timestamp column. A form is made from the columns (the kind of
  // question is worked out from the answers), and importing a newer export of the same form adds the new responses and
  // updates the ones that changed, matched by their timestamp, so the same entries stay the same entries.
  const importer = () => (typeof module !== 'undefined' ? require('./form-logic') : globalThis.FolioFormImport);
  const TIMESTAMP = /^(timestamp|submitted( at| on)?|submission( time| date)?)$/i;

  function kindOfColumn(vals) {
    const v = vals.filter(Boolean);
    if (!v.length) return { type: 'short' };
    const order = importer().dateOrder(vals);
    if (order) return { type: 'date', order };
    if (v.every(x => /^\d+$/.test(x))) {
      const nums = v.map(Number), max = Math.max(...nums);
      if (Math.min(...nums) >= 1 && max <= 10 && new Set(nums).size >= 2) return { type: 'scale', max: max <= 5 ? 5 : max };
    }
    if (v.some(x => x.includes(','))) {
      const counts = new Map();
      for (const x of v) for (const t of x.split(/\s*,\s*/).filter(Boolean)) counts.set(t, (counts.get(t) || 0) + 1);
      const options = [...counts.keys()];
      if (options.length <= 12 && options.every(o => counts.get(o) >= 2)) return { type: 'checkbox', options };
    }
    const distinct = [...new Set(v)];
    if (distinct.length <= 8 && distinct.length < v.length) return { type: 'choice', options: distinct };
    if (v.some(x => x.length > 80 || x.includes('\n'))) return { type: 'paragraph' };
    return { type: 'short' };
  }

  // One cell, in the shape the question stores it. New options and a wider scale are picked up as they appear.
  function answerFor(q, raw, order) {
    const v = String(raw == null ? '' : raw).trim();
    if (!v) return undefined;
    if (q.type === 'choice' || q.type === 'dropdown') {
      if (!q.options.includes(v) && q.options.length < LIMITS.options) q.options.push(v);
      return q.options.includes(v) ? v : undefined;
    }
    if (q.type === 'checkbox') {
      const picked = v.split(/\s*,\s*/).filter(Boolean);
      for (const t of picked) if (!q.options.includes(t) && q.options.length < LIMITS.options) q.options.push(t);
      const ok = [...new Set(picked.filter(t => q.options.includes(t)))];
      return ok.length ? ok : undefined;
    }
    if (q.type === 'scale') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 10) return undefined;
      if (n > q.max) q.max = n;
      return n;
    }
    if (q.type === 'date') return importer().toIso(v, order) || undefined;
    return clip(v, LIMITS.text);
  }

  // "11/02/2026 10:21:33" (or 2026/11/02 10:21:33, 5:07 PM) as an ISO time; '' when it is not a date.
  function timeOf(raw, order) {
    const day = importer().toIso(String(raw || ''), order);
    if (!day) return '';
    const t = String(raw).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    let hh = t ? +t[1] : 0;
    if (t && t[4]) { const pm = /pm/i.test(t[4]); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, hh, t ? +t[2] : 0, t && t[3] ? +t[3] : 0).toISOString();
  }

  function sameAnswers(a, b) { return JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort()); }

  // Puts the rows of an export into the form: new responses are added, changed ones updated. Matched by timestamp
  // (or, with no timestamp column, by the whole row). Columns the form does not know yet become new questions.
  function mergeTable(form, rows, { uid, now = new Date() }) {
    const { headers, body } = importer().readTable(rows);
    const ts = headers.findIndex(h => TIMESTAMP.test(h));
    const orders = headers.map((_, i) => importer().dateOrder(body.map(r => r[i])));
    const byHeader = new Map(form.questions.map(q => [(q.src || q.title).toLowerCase(), q]));
    const qs = headers.map((h, i) => {
      if (i === ts) return null;
      let q = byHeader.get(h.toLowerCase());
      if (!q) {
        const kind = kindOfColumn(body.map(r => r[i]));
        q = { id: uid(), type: kind.type, title: clip(h, LIMITS.title), required: false, src: clip(h, LIMITS.title) };
        if (kind.options) q.options = kind.options.slice(0, LIMITS.options);
        if (kind.type === 'scale') Object.assign(q, { max: kind.max, low: '', high: '' });
        if (form.questions.length < LIMITS.questions) { form.questions.push(q); byHeader.set(h.toLowerCase(), q); } else return null;
      }
      return q;
    });
    const known = new Map(form.responses.filter(r => r.key).map(r => [r.key, r]));
    const seen = new Map();
    const out = { added: 0, updated: 0, unchanged: 0 };
    body.forEach(cells => {
      const base = ts >= 0 && cells[ts] ? cells[ts] : 'row:' + hash(cells.join('\u0001'));
      const dup = seen.get(base) || 0;
      seen.set(base, dup + 1);
      const key = dup ? base + '#' + dup : base;
      const answers = {};
      qs.forEach((q, i) => { if (!q) return; const a = answerFor(q, cells[i], orders[i]); if (a !== undefined) answers[q.id] = a; });
      const mine = known.get(key);
      if (!mine) {
        const at = (ts >= 0 && timeOf(cells[ts], orders[ts])) || now.toISOString();
        form.responses.push({ id: uid(), at, key, answers });
        out.added++;
      } else {
        const covered = new Set(qs.filter(Boolean).map(q => q.id));
        const before = Object.fromEntries(Object.entries(mine.answers).filter(([k]) => covered.has(k)));
        if (sameAnswers(before, answers)) out.unchanged++;
        else { for (const id of covered) delete mine.answers[id]; Object.assign(mine.answers, answers); out.updated++; }
      }
    });
    if (form.responses.length > LIMITS.responses) form.responses.splice(0, form.responses.length - LIMITS.responses);
    return out;
  }

  // A new form from an export: questions from the columns, then every row as a response.
  function fromTable(rows, { uid, now }) {
    const form = { description: 'Imported from a Google Form export.', questions: [], responses: [], published: true, closesOn: '', reviewOn: '', source: { kind: 'google' } };
    const result = mergeTable(form, rows, { uid, now });
    return { form, ...result };
  }


  // ---- the web link ----
  // What the owner publishes: the questions, without the responses or anything private (the server cleans it again).
  function publicDefinition(form) {
    return { description: form.description, closesOn: form.closesOn, questions: form.questions.map(({ src, ...q }) => q) }; // eslint-disable-line no-unused-vars
  }

  // Responses pulled from the server, { n, at (ms), answers }. Numbered, so pulling twice never doubles anything.
  // Returns how many were new.
  function addRemote(form, rows, { uid }) {
    const have = new Set(form.responses.map(r => r.key).filter(Boolean));
    const ids = new Set(form.questions.map(q => q.id));
    let added = 0, last = (form.pub && form.pub.after) || 0;
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || !Number.isInteger(r.n) || r.n < 1) continue;
      last = Math.max(last, r.n);
      const key = 'web:' + r.n;
      if (have.has(key)) continue;
      const when = new Date(Number(r.at));
      form.responses.push({ id: uid(), at: Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString(), key,
        answers: Object.fromEntries(Object.entries(r.answers && typeof r.answers === 'object' ? r.answers : {}).filter(([k]) => ids.has(k))) });
      have.add(key);
      added++;
    }
    form.responses.sort((a, b) => a.at.localeCompare(b.at));
    if (form.responses.length > LIMITS.responses) form.responses.splice(0, form.responses.length - LIMITS.responses);
    if (form.pub) form.pub.after = last;
    return added;
  }

  // Reminders the form can put on the calendar: the closing day and the day to review the answers.
  function calendarReminders(form, title) {
    const name = title || 'Form';
    const out = [];
    if (form.closesOn) out.push({ key: 'closes', title: `${name}: form closes`, startDate: form.closesOn });
    if (form.reviewOn) out.push({ key: 'review', title: `${name}: review responses`, startDate: form.reviewOn });
    return out.map(e => ({ ...e, endDate: e.startDate, allDay: true, startTime: '', endTime: '', notes: 'From a Vayun form' }));
  }

  return { TYPES, WITH_OPTIONS, LIMITS, newQuestion, newForm, sanitize, validate, isOpen, addResponse, summarize, monthActivity, toCsv, calendarReminders, dayKey, isDay, mergeTable, fromTable, kindOfColumn, publicDefinition, addRemote };
});
