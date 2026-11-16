// Live Google Form sync, the part that needs no network and no DOM, so the desktop app, the web app, the Android app
// and the tests share it. It turns what the Google Forms API returns (the form's questions and its responses) into the
// rows the form importer already understands, plus one stable key per response, so syncing again never adds a response
// twice. Fetching itself is per platform (desktop: main process, web and Android: the signed-in browser page).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else root.FolioGFormSync = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const API_BASE = 'https://forms.googleapis.com/v1/forms';
  // Read-only: the form's questions, and the answers people sent.
  const SCOPES = [
    'https://www.googleapis.com/auth/forms.body.readonly',
    'https://www.googleapis.com/auth/forms.responses.readonly',
  ];
  const POLL_MS = 90 * 1000; // how often an open board checks for new responses
  const MAX_PAGES = 20; // 20 x 5000 responses; the importer refuses more than 20,000 anyway

  const pad = n => String(n).padStart(2, '0');
  const isFormId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(v);

  // Accepts the form's edit link, its public link, or just the id.
  //   https://docs.google.com/forms/d/<id>/edit   https://docs.google.com/forms/d/e/<publicId>/viewform
  // The public "/d/e/..." id is a different thing the API cannot use, so it is refused with a hint.
  function parseFormId(input) {
    const text = String(input == null ? '' : input).trim();
    if (!text) return { error: 'Paste the link of your Google Form.' };
    if (/forms\/d\/e\//.test(text) || /forms\.gle\//.test(text)) {
      return { error: 'That is the link people fill in. Open the form in Google Forms and copy the link from the address bar, the one that ends in /edit.' };
    }
    const m = text.match(/forms\/d\/([A-Za-z0-9_-]+)/);
    const id = m ? m[1] : text;
    return isFormId(id) ? { id } : { error: 'That does not look like a Google Form link.' };
  }

  // Local "2026-11-04 14:03:05", the shape Google Sheets exports, so the importer reads it as a date.
  function stamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // The form's questions in order: [{ id, title }]. A grid question has one answer per row, each its own question id.
  function questionsOf(form) {
    const out = [];
    for (const item of (form && form.items) || []) {
      const base = String(item.title || '').trim();
      if (item.questionItem && item.questionItem.question && item.questionItem.question.questionId) {
        out.push({ id: item.questionItem.question.questionId, title: base });
      } else if (item.questionGroupItem) {
        for (const q of item.questionGroupItem.questions || []) {
          const row = String((q.rowQuestion && q.rowQuestion.title) || '').trim();
          if (q.questionId) out.push({ id: q.questionId, title: base && row ? `${base} [${row}]` : base || row });
        }
      }
    }
    return out;
  }

  function answerText(a) {
    if (!a) return '';
    if (a.textAnswers && Array.isArray(a.textAnswers.answers)) return a.textAnswers.answers.map(x => x.value).filter(v => v != null && v !== '').join(', ');
    if (a.fileUploadAnswers && Array.isArray(a.fileUploadAnswers.answers)) return a.fileUploadAnswers.answers.map(x => x.fileName).filter(Boolean).join(', ');
    return '';
  }

  // Titles must be unique and never blank: they become the board's columns.
  function headerFor(questions) {
    const seen = new Map();
    return questions.map((q, i) => {
      const base = q.title || `Question ${i + 1}`;
      const n = (seen.get(base.toLowerCase()) || 0) + 1;
      seen.set(base.toLowerCase(), n);
      return n === 1 ? base : `${base} (${n})`;
    });
  }

  // -> { name, rows, keys, latest } where rows[0] is the header row (same shape as a parsed export), keys[i] belongs to
  // rows[i + 1], and latest is the newest submission time seen (an ISO string, to ask Google only for newer ones).
  function toTable(form, responses) {
    const questions = questionsOf(form);
    const sorted = (responses || []).filter(r => r && r.responseId).slice().sort((a, b) => String(a.lastSubmittedTime || a.createTime || '').localeCompare(String(b.lastSubmittedTime || b.createTime || '')));
    const collects = form && form.settings && /^(VERIFIED|RESPONDER_INPUT)$/.test(form.settings.emailCollectionType || '');
    const withEmail = collects || sorted.some(r => r.respondentEmail);
    const header = ['Timestamp', ...(withEmail ? ['Email address'] : []), ...headerFor(questions)];
    const rows = [header];
    const keys = [];
    let latest = '';
    for (const r of sorted) {
      const when = r.lastSubmittedTime || r.createTime || '';
      if (when > latest) latest = when;
      const answers = r.answers || {};
      rows.push([stamp(when), ...(withEmail ? [r.respondentEmail || ''] : []), ...questions.map(q => answerText(answers[q.id]))]);
      keys.push('g:' + r.responseId);
    }
    return { name: String((form && form.info && (form.info.title || form.info.documentTitle)) || 'Form responses'), rows, keys, latest };
  }

  // The list-responses request for one page. `since` is an ISO time: only responses at or after it are asked for
  // (the importer's keys make the overlap harmless).
  function responsesUrl(formId, { since = '', pageToken = '' } = {}) {
    const q = new URLSearchParams({ pageSize: '5000' });
    if (since) q.set('filter', `timestamp >= ${since}`);
    if (pageToken) q.set('pageToken', pageToken);
    return `${API_BASE}/${encodeURIComponent(formId)}/responses?${q}`;
  }
  const formUrl = formId => `${API_BASE}/${encodeURIComponent(formId)}`;

  // Turns a Forms API error body into words a person can act on.
  function friendlyError(status, body) {
    const err = (body && body.error) || {};
    const msg = String(err.message || '');
    if (status === 401) return { error: 'Google access ended. Connect Google again.', disconnected: true };
    if (status === 404) return { error: 'Google could not find that form. Check the link, and that this Google account can open it.' };
    if (status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(msg + JSON.stringify(err.details || ''))) {
      return { error: 'The Google Forms API is not switched on for Vayun yet. This needs a one-time setup by the Vayun owner (Google Cloud, APIs & Services, Google Forms API).' };
    }
    if (status === 403) return { error: 'This Google account is not allowed to read that form’s responses. Use the account that owns the form (or an editor), and allow the permissions.' };
    if (status === 429) return { error: 'Google asked Vayun to slow down. Try again in a minute.' };
    return { error: msg || `Google Forms error ${status}.` };
  }

  // Shared by every platform: fetchJson(url) -> { status, body }. Returns { form, responses, latest } or { error }.
  async function fetchAll(fetchJson, formId, { since = '' } = {}) {
    const f = await fetchJson(formUrl(formId));
    if (f.status !== 200) return friendlyError(f.status, f.body);
    const responses = [];
    let pageToken = '';
    for (let i = 0; i < MAX_PAGES; i++) {
      const r = await fetchJson(responsesUrl(formId, { since, pageToken }));
      if (r.status !== 200) return friendlyError(r.status, r.body);
      responses.push(...((r.body && r.body.responses) || []));
      pageToken = (r.body && r.body.nextPageToken) || '';
      if (!pageToken) break;
    }
    return { form: f.body, responses };
  }

  return { API_BASE, SCOPES, POLL_MS, parseFormId, questionsOf, toTable, responsesUrl, formUrl, friendlyError, fetchAll, stamp };
});
