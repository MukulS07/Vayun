const test = require('node:test');
const assert = require('node:assert');
const F = require('../app/forms-logic');

let n = 0;
const uid = () => 'q' + ++n;

function sample() {
  const form = F.sanitize({
    questions: [
      { id: 'name', type: 'short', title: 'Your name', required: true },
      { id: 'team', type: 'choice', title: 'Team', options: ['Design', 'Dev', 'Ops'] },
      { id: 'tools', type: 'checkbox', title: 'Tools', options: ['Figma', 'Git', 'Slack'] },
      { id: 'mood', type: 'scale', title: 'Mood', max: 5 },
      { id: 'when', type: 'date', title: 'Available from' },
    ],
    published: true, closesOn: '2026-11-30',
  }, uid);
  return form;
}
const submit = (form, raw, at) => {
  const v = F.validate(form, raw);
  assert.deepStrictEqual(v.errors, {});
  return F.addResponse(form, v.answers, { id: uid(), now: new Date(at) });
};

test('forms: a new question has sensible defaults, and stored data is cleaned', () => {
  assert.deepStrictEqual(F.newQuestion('choice', uid).options, ['Option 1', 'Option 2']);
  assert.strictEqual(F.newQuestion('scale', uid).max, 5);
  assert.strictEqual(F.newQuestion('nonsense', uid).type, 'short');
  const dirty = F.sanitize({
    questions: [{ id: 'a', type: 'weird', title: 'x'.repeat(999) }, { id: 'a', type: 'choice', options: ['A', 'A', ' ', 'B'] }, { type: 'scale', max: 99 }],
    responses: [{ id: 'r', at: 'not a date', answers: {} }, { id: 'r2', at: '2026-11-02T10:00:00Z', answers: { a: 'ok', gone: 'dropped' } }],
    closesOn: 'tomorrow',
  }, uid);
  assert.strictEqual(dirty.questions[0].type, 'short');
  assert.strictEqual(dirty.questions[0].title.length, F.LIMITS.title);
  assert.notStrictEqual(dirty.questions[1].id, 'a'); // a repeated id is replaced
  assert.deepStrictEqual(dirty.questions[1].options, ['A', 'B']);
  assert.strictEqual(dirty.questions[2].max, 10);
  assert.deepStrictEqual(dirty.responses.map(r => Object.keys(r.answers)), [['a']]);
  assert.strictEqual(dirty.closesOn, '');
  assert.strictEqual(F.sanitize(null, uid).questions.length, 1);
});

test('forms: answers are checked against the questions', () => {
  const form = sample();
  assert.deepStrictEqual(F.validate(form, {}).errors, { name: 'This question is required.' });
  const bad = F.validate(form, { name: 'A', team: 'Sales', tools: ['Nope'], mood: 9, when: 'soon' });
  assert.deepStrictEqual(Object.keys(bad.errors).sort(), ['mood', 'team', 'tools', 'when']);
  const good = F.validate(form, { name: '  Asha ', team: 'Dev', tools: ['Git', 'Git', 'Figma'], mood: '4', when: '2026-12-01' });
  assert.deepStrictEqual(good.errors, {});
  assert.deepStrictEqual(good.answers, { name: 'Asha', team: 'Dev', tools: ['Git', 'Figma'], mood: 4, when: '2026-12-01' });
});

test('forms: a form is open only when published and before its closing day', () => {
  const form = sample();
  assert.strictEqual(F.isOpen(form, '2026-11-30'), true);
  assert.strictEqual(F.isOpen(form, '2026-12-01'), false);
  form.published = false;
  assert.strictEqual(F.isOpen(form, '2026-11-02'), false);
});

test('forms: the dashboard numbers add up', () => {
  const form = sample();
  submit(form, { name: 'A', team: 'Dev', tools: ['Git', 'Slack'], mood: 5 }, '2026-11-02T09:00:00');
  submit(form, { name: 'B', team: 'Dev', tools: ['Git'], mood: 3 }, '2026-11-02T11:00:00');
  submit(form, { name: 'C', team: 'Ops', mood: 4, when: '2026-12-05' }, '2026-11-01T11:00:00');
  const s = F.summarize(form, { now: new Date('2026-11-02T20:00:00'), days: 3 });
  assert.deepStrictEqual([s.total, s.today, s.week], [3, 2, 3]);
  assert.deepStrictEqual(s.perDay.map(d => d.count), [0, 1, 2]);
  assert.deepStrictEqual(s.busiest, { day: '2026-11-02', count: 2 });
  const q = Object.fromEntries(s.questions.map(x => [x.id, x]));
  assert.deepStrictEqual(q.team.counts.map(c => [c.label, c.count, c.pct]), [['Design', 0, 0], ['Dev', 2, 67], ['Ops', 1, 33]]);
  assert.deepStrictEqual(q.tools.counts.map(c => c.count), [0, 2, 1]);
  assert.strictEqual(q.tools.skipped, 1);
  assert.strictEqual(q.mood.avg, 4);
  assert.deepStrictEqual(q.mood.hist.map(h => h.count), [0, 0, 1, 1, 1]);
  assert.deepStrictEqual(q.when.dates, ['2026-12-05']);
  assert.deepStrictEqual(q.name.latest.map(l => l.text), ['C', 'B', 'A']);
  assert.strictEqual(q.name.latest.length, 3);
  assert.strictEqual(s.completion, 80); // each response answered 4 of the 5 questions
});

test('forms: an empty form summarises to zeros, and a month of activity lines up with the weekdays', () => {
  const empty = F.summarize(F.sanitize(null, uid), { now: new Date('2026-11-02T10:00:00'), days: 2 });
  assert.deepStrictEqual([empty.total, empty.completion, empty.last], [0, 0, '']);
  const form = sample();
  submit(form, { name: 'A' }, '2026-11-03T09:00:00');
  submit(form, { name: 'B' }, '2026-11-03T10:00:00');
  const m = F.monthActivity(form, 2026, 10); // November 2026 starts on a Sunday
  assert.strictEqual(m.weeks[0].findIndex(c => c && c.n === 1), 6); // Monday-first: Sunday is the last column
  assert.strictEqual(m.weeks.flat().find(c => c && c.day === '2026-11-03').count, 2);
  assert.ok(m.weeks.every(w => w.length === 7));
  assert.strictEqual(m.max, 2);
});

test('forms: CSV export quotes commas, quotes and lists; reminders become all-day calendar events', () => {
  const form = F.sanitize({ questions: [{ id: 'a', type: 'short', title: 'Say, "hi"' }, { id: 'b', type: 'checkbox', title: 'Pick', options: ['x', 'y'] }], closesOn: '2026-11-30', reviewOn: '2026-12-02' }, uid);
  F.addResponse(form, { a: 'one,two', b: ['x', 'y'] }, { id: 'r', now: new Date('2026-11-02T00:00:00Z') });
  const csv = F.toCsv(form).split('\r\n');
  assert.strictEqual(csv[0], 'Submitted,"Say, ""hi""",Pick');
  assert.ok(csv[1].endsWith('"one,two",x; y'));
  const ev = F.calendarReminders(form, 'Feedback');
  assert.deepStrictEqual(ev.map(e => [e.key, e.title, e.startDate, e.allDay]), [['closes', 'Feedback: form closes', '2026-11-30', true], ['review', 'Feedback: review responses', '2026-12-02', true]]);
});

const header = ['Timestamp', 'Name', 'Team', 'Rating', 'Tools', 'Idea'];
const day1 = [
  header,
  ['11/02/2026 10:21:33', 'Asha', 'Dev', '5', 'Git, Slack', 'More time for testing'],
  ['11/02/2026 11:00:00', 'Ravi', 'Dev', '3', 'Git', 'Shorter standups please'],
  ['11/03/2026 09:10:00', 'Meera', 'Ops', '4', 'Slack, Git', 'x'],
];

test('forms import: a Google export becomes a form with the right kind of question for each column', () => {
  const r = F.fromTable(day1, { uid });
  assert.deepStrictEqual([r.added, r.updated, r.unchanged], [3, 0, 0]);
  const q = Object.fromEntries(r.form.questions.map(x => [x.title, x]));
  assert.strictEqual(q.Timestamp, undefined); // the timestamp is when the response came, not a question
  assert.deepStrictEqual([q.Team.type, q.Rating.type, q.Tools.type, q.Name.type], ['choice', 'scale', 'checkbox', 'short']);
  assert.deepStrictEqual(q.Tools.options, ['Git', 'Slack']);
  assert.strictEqual(q.Rating.max, 5);
  const clean = F.sanitize(r.form, uid); // what the page does when it opens
  assert.strictEqual(clean.responses.length, 3);
  const first = clean.responses[0];
  assert.deepStrictEqual([first.answers[q.Team.id], first.answers[q.Rating.id], first.answers[q.Tools.id]], ['Dev', 5, ['Git', 'Slack']]);
  assert.strictEqual(new Date(first.at).getHours(), 10);
  assert.strictEqual(clean.source.kind, 'google');
  assert.ok(clean.questions.every(x => x.src)); // remembers which column each question came from
  const s = F.summarize(clean, { now: new Date('2026-11-03T12:00:00'), days: 3 });
  assert.deepStrictEqual(s.perDay.map(d => d.count), [0, 2, 1]);
});

test('forms import: a newer export adds the new responses and updates changed ones, the same entries stay the same', () => {
  const made = F.fromTable(day1, { uid });
  const form = F.sanitize(made.form, uid);
  const idOfAsha = form.responses[0].id;
  const day2 = [
    header,
    ...day1.slice(1),
    ['11/04/2026 08:00:00', 'Kabir', 'Design', '2', 'Figma', 'New'],
  ];
  day2[2] = ['11/02/2026 11:00:00', 'Ravi', 'Ops', '3', 'Git', 'Shorter standups please']; // Ravi's team changed
  const r = F.mergeTable(form, day2, { uid });
  assert.deepStrictEqual([r.added, r.updated, r.unchanged], [1, 1, 2]);
  assert.strictEqual(form.responses.length, 4);
  assert.strictEqual(form.responses[0].id, idOfAsha); // not recreated
  const team = form.questions.find(q => q.title === 'Team');
  assert.strictEqual(form.responses[1].answers[team.id], 'Ops');
  assert.ok(team.options.includes('Design')); // a new answer becomes an option
  // importing the same file again changes nothing
  assert.deepStrictEqual(F.mergeTable(form, day2, { uid }), { added: 0, updated: 0, unchanged: 4 });
});

test('forms import: a new column becomes a new question, and two responses in the same second both count', () => {
  const form = F.sanitize(F.fromTable(day1, { uid }).form, uid);
  const wider = [[...header, 'City'], ['11/02/2026 10:21:33', 'Asha', 'Dev', '5', 'Git, Slack', 'More time for testing', 'Pune'], ['11/02/2026 10:21:33', 'Twin', 'Dev', '4', 'Git', 'same second', 'Delhi']];
  const r = F.mergeTable(form, wider, { uid });
  assert.deepStrictEqual([r.added, r.updated], [1, 1]);
  const city = form.questions.find(q => q.title === 'City');
  assert.ok(city);
  assert.strictEqual(form.responses.filter(x => x.answers[city.id]).length, 2);
  assert.strictEqual(F.mergeTable(form, [['Timestamp'], ['x']], { uid }).added, 1); // a file with only a timestamp still reads
  assert.throws(() => F.mergeTable(form, [['Only headers']], { uid }), /no responses/);
});
