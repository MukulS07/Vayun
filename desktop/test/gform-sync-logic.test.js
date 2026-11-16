const test = require('node:test');
const assert = require('node:assert');
const S = require('../app/gform-sync-logic');
const F = require('../app/form-logic');

const form = {
  formId: 'F'.repeat(20), info: { title: 'Task requests' },
  items: [
    { title: 'Task', questionItem: { question: { questionId: 'q1' } } },
    { title: 'Priority', questionItem: { question: { questionId: 'q2' } } },
    { title: 'Rate', questionGroupItem: { questions: [{ questionId: 'q3', rowQuestion: { title: 'Speed' } }, { questionId: 'q4', rowQuestion: { title: 'Care' } }] } },
    { title: 'Priority', questionItem: { question: { questionId: 'q5' } } },
  ],
};
const resp = (id, when, task, pr, email) => ({
  responseId: id, lastSubmittedTime: when, ...(email && { respondentEmail: email }),
  answers: { q1: { textAnswers: { answers: [{ value: task }] } }, q2: { textAnswers: { answers: [{ value: pr }] } }, q3: { textAnswers: { answers: [{ value: '4' }] } } },
});
const uidMaker = () => { let n = 0; return () => 'id' + ++n; };

test('parseFormId reads edit links and ids, and explains the public link', () => {
  assert.strictEqual(S.parseFormId('https://docs.google.com/forms/d/1AbCdEfGhIjKlMnOp/edit').id, '1AbCdEfGhIjKlMnOp');
  assert.strictEqual(S.parseFormId('1AbCdEfGhIjKlMnOp').id, '1AbCdEfGhIjKlMnOp');
  assert.match(S.parseFormId('https://docs.google.com/forms/d/e/1FAIpQLSabc/viewform').error, /\/edit/);
  assert.match(S.parseFormId('https://forms.gle/xyz').error, /link people fill in/);
  assert.ok(S.parseFormId('').error && S.parseFormId('hi').error);
});

test('toTable: one header per question (grid rows and duplicate titles included), oldest response first, stable keys', () => {
  const t = S.toTable(form, [resp('r2', '2026-11-03T10:00:00Z', 'B', 'Low'), resp('r1', '2026-11-02T10:00:00Z', 'A', 'High')]);
  assert.strictEqual(t.name, 'Task requests');
  assert.deepStrictEqual(t.rows[0], ['Timestamp', 'Task', 'Priority', 'Rate [Speed]', 'Rate [Care]', 'Priority (2)']);
  assert.deepStrictEqual(t.keys, ['g:r1', 'g:r2']);
  assert.strictEqual(t.rows[1][1], 'A');
  assert.strictEqual(t.rows[1][3], '4');
  assert.strictEqual(t.rows[1][4], '');
  assert.strictEqual(t.latest, '2026-11-03T10:00:00Z');
  assert.match(t.rows[1][0], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});

test('toTable adds the email column when the form collects it', () => {
  const t = S.toTable(form, [resp('r1', '2026-11-02T10:00:00Z', 'A', 'High', 'a@x.com')]);
  assert.strictEqual(t.rows[0][1], 'Email address');
  assert.strictEqual(t.rows[1][1], 'a@x.com');
});

test('syncing twice adds each response once, and only the new ones the second time', () => {
  const uid = uidMaker();
  let t = S.toTable(form, [resp('r1', '2026-11-02T10:00:00Z', 'A', 'High'), resp('r2', '2026-11-03T10:00:00Z', 'B', 'Low')]);
  const first = F.importForm(t.rows, [], { name: t.name, uid, formId: 'FORM1', keys: t.keys });
  assert.ok(first.created);
  assert.strictEqual(first.added, 2);
  assert.strictEqual(first.db.source.googleFormId, 'FORM1');
  let pages = first.pages;
  t = S.toTable(form, [resp('r2', '2026-11-03T10:00:00Z', 'B', 'Low'), resp('r3', '2026-11-04T10:00:00Z', 'C', 'High')]);
  const second = F.importForm(t.rows, pages, { name: t.name, uid, formId: 'FORM1', keys: t.keys });
  assert.strictEqual(second.created, false);
  assert.strictEqual(second.added, 1);
  assert.strictEqual(second.skipped, 1);
  pages = pages.concat(second.pages);
  assert.strictEqual(pages.filter(p => p.parentId === first.db.id).length, 3);
  const again = F.importForm(t.rows, pages, { name: t.name, uid, formId: 'FORM1', keys: t.keys });
  assert.strictEqual(again.added, 0);
});

test('a question added to the form later does not start a second board or shift the columns', () => {
  const uid = uidMaker();
  const t1 = S.toTable(form, [resp('r1', '2026-11-02T10:00:00Z', 'A', 'High')]);
  const first = F.importForm(t1.rows, [], { name: t1.name, uid, formId: 'FORM1', keys: t1.keys });
  const grown = { ...form, items: [{ title: 'Team', questionItem: { question: { questionId: 'q9' } } }, ...form.items] };
  const r = resp('r2', '2026-11-03T10:00:00Z', 'B', 'Low');
  r.answers.q9 = { textAnswers: { answers: [{ value: 'Ops' }] } };
  const t2 = S.toTable(grown, [r]);
  const second = F.importForm(t2.rows, first.pages, { name: t2.name, uid, formId: 'FORM1', keys: t2.keys });
  assert.strictEqual(second.created, false);
  assert.strictEqual(second.added, 1);
  assert.strictEqual(second.pages[0].title, 'B');
});

test('importing without formId behaves as before (matched by headers, content-hash keys)', () => {
  const uid = uidMaker();
  const rows = [['Task', 'Status'], ['A', 'To do'], ['B', 'Done']];
  const a = F.importForm(rows, [], { uid });
  const b = F.importForm(rows, a.pages, { uid });
  assert.strictEqual(a.added, 2);
  assert.strictEqual(b.added, 0);
});

test('fetchAll pages through responses, and friendlyError explains the usual failures', async () => {
  const calls = [];
  const fetchJson = async url => {
    calls.push(url);
    if (!url.includes('/responses')) return { status: 200, body: form };
    return url.includes('pageToken=T2')
      ? { status: 200, body: { responses: [resp('r2', '2026-11-03T10:00:00Z', 'B', 'x')] } }
      : { status: 200, body: { responses: [resp('r1', '2026-11-02T10:00:00Z', 'A', 'x')], nextPageToken: 'T2' } };
  };
  const r = await S.fetchAll(fetchJson, 'FORM1', { since: '2026-11-01T00:00:00Z' });
  assert.strictEqual(r.responses.length, 2);
  assert.strictEqual(new URL(calls[1]).searchParams.get('filter'), 'timestamp >= 2026-11-01T00:00:00Z');
  assert.match(S.friendlyError(403, { error: { message: 'Google Forms API has not been used in project 1 before or it is disabled' } }).error, /not switched on/);
  assert.match(S.friendlyError(403, { error: { message: 'The caller does not have permission' } }).error, /not allowed/);
  assert.strictEqual(S.friendlyError(401, {}).disconnected, true);
  assert.match(S.friendlyError(404, {}).error, /could not find/);
  assert.match((await S.fetchAll(async () => ({ status: 404, body: {} }), 'X')).error, /could not find/);
});
