const test = require('node:test');
const assert = require('node:assert/strict');
require('../../tools/sync-ai').sync();
const { createFormsCore, FormsError, LIMITS } = require('../../functions/forms-core');
const { renderForm, noticePage } = require('../../functions/forms-page');

// The same contract as the Firestore store in functions/index.js, in memory, counting what it would cost.
function memoryStore() {
  const forms = new Map(), responses = new Map();
  const cost = { reads: 0, writes: 0 };
  return {
    cost, forms, responses,
    async getForm(id) { cost.reads++; const d = forms.get(id); return d ? { id, ...structuredClone(d) } : null; },
    async createForm(id, d) { cost.writes++; forms.set(id, structuredClone(d)); responses.set(id, []); },
    async updateForm(id, p) { cost.writes++; Object.assign(forms.get(id), structuredClone(p)); },
    async countForms(uid) { cost.reads++; return [...forms.values()].filter(f => f.ownerUid === uid).length; },
    async deleteForm(id) { forms.delete(id); responses.delete(id); },
    async addResponse(id, admit) {
      cost.reads++;
      const meta = forms.get(id);
      if (!meta) return { ok: false, code: 'missing' };
      const v = admit(structuredClone(meta));
      if (!v.ok) return v;
      cost.writes += 2;
      Object.assign(meta, v.patch);
      responses.get(id).push(structuredClone(v.response));
      return { ok: true };
    },
    async listResponses(id, after, limit) { const out = responses.get(id).filter(r => r.n > after).slice(0, limit); cost.reads += out.length; return out; },
  };
}

const FORM = {
  description: 'Tell us how it went.',
  questions: [
    { id: 'name', type: 'short', title: 'Name', required: true },
    { id: 'team', type: 'choice', title: 'Team', options: ['Dev', 'Ops'] },
    { id: 'mood', type: 'scale', title: 'Mood', max: 5 },
  ],
};
const NOW = new Date('2026-11-03T10:00:00Z');
const setup = (over = {}) => {
  const store = memoryStore();
  let n = 0;
  const core = createFormsCore({ store, now: () => NOW, id: () => 'id' + ++n + 'abcd', cacheMs: 0, ...over });
  return { store, core };
};

test('publish makes a link, and publishing again keeps it', async () => {
  const { core, store } = setup();
  const first = await core.publish('u1', { title: 'Feedback', form: FORM });
  assert.match(first.id, /^id1/);
  const again = await core.publish('u1', { id: first.id, title: 'Feedback v2', form: FORM });
  assert.equal(again.id, first.id);
  assert.equal(store.forms.get(first.id).title, 'Feedback v2');
  assert.equal(store.forms.size, 1);
});

test('only the owner can update, pull, close or remove', async () => {
  const { core } = setup();
  const { id } = await core.publish('u1', { title: 'F', form: FORM });
  for (const call of [() => core.publish('u2', { id, title: 'x', form: FORM }), () => core.pull('u2', id, 0), () => core.setOpen('u2', id, false), () => core.remove('u2', id)]) {
    await assert.rejects(call, e => e instanceof FormsError && e.code === 'owner');
  }
  await assert.rejects(() => core.pull('u1', 'nope1234', 0), e => e.code === 'missing');
});

test('a visitor sees the questions but nothing private', async () => {
  const { core } = setup();
  const { id } = await core.publish('u1', { title: 'F', form: { ...FORM, questions: [{ ...FORM.questions[0], src: 'Column A' }, ...FORM.questions.slice(1)], responses: [{ id: 'x', at: NOW.toISOString(), answers: {} }] } });
  const view = await core.view(id);
  assert.equal(view.open, true);
  assert.equal(view.questions.length, 3);
  assert.ok(!JSON.stringify(view).includes('Column A'));
  assert.ok(!JSON.stringify(view).includes('u1'));
});

test('submit checks the answers against the published questions', async () => {
  const { core, store } = setup();
  const { id } = await core.publish('u1', { title: 'F', form: FORM });
  await assert.rejects(() => core.submit(id, { team: 'Dev' }), e => e.code === 'bad' && Boolean(e.errors.name));
  await assert.rejects(() => core.submit(id, { name: 'A', team: 'Marketing' }), e => e.code === 'bad');
  await assert.rejects(() => core.submit(id, {}), e => e.code === 'bad');
  await core.submit(id, { name: 'Asha', team: 'Dev', mood: 4, extra: 'ignored' });
  const [saved] = store.responses.get(id);
  assert.deepEqual(saved.answers, { name: 'Asha', team: 'Dev', mood: 4 });
  assert.equal(saved.n, 1);
});

test('a submit costs one read and two writes, however many questions', async () => {
  const { core, store } = setup({ cacheMs: 60_000 });
  const { id } = await core.publish('u1', { title: 'F', form: FORM });
  await core.view(id); // the form is already in memory, as it is for anyone who opened the link a moment ago
  store.cost.reads = 0; store.cost.writes = 0;
  await core.submit(id, { name: 'A' });
  assert.deepEqual(store.cost, { reads: 1, writes: 2 });
});

test('a closed form, a past closing date and a full form turn people away', async () => {
  const { core, store } = setup();
  const { id } = await core.publish('u1', { title: 'F', form: FORM });
  await core.setOpen('u1', id, false);
  await assert.rejects(() => core.submit(id, { name: 'A' }), e => e.code === 'closed');
  assert.equal((await core.view(id)).open, false);
  await core.setOpen('u1', id, true);
  await core.submit(id, { name: 'A' });
  store.forms.get(id).form.closesOn = '2026-11-02';
  await assert.rejects(() => core.submit(id, { name: 'B' }), e => e.code === 'closed');
  store.forms.get(id).form.closesOn = '2026-11-03';
  await core.submit(id, { name: 'C' });
  store.forms.get(id).cap = 2;
  await assert.rejects(() => core.submit(id, { name: 'D' }), e => e.code === 'full');
});

test('a form stops at its daily limit and starts again the next day', async () => {
  let clock = NOW;
  const { core, store } = setup({ now: () => clock });
  const { id } = await core.publish('u1', { title: 'F', form: FORM });
  store.forms.get(id).dayCap = 3;
  for (let i = 0; i < 3; i++) await core.submit(id, { name: 'P' + i });
  await assert.rejects(() => core.submit(id, { name: 'late' }), e => e.code === 'busy');
  clock = new Date('2026-11-04T00:30:00Z');
  await core.submit(id, { name: 'next day' });
  assert.equal(store.forms.get(id).count, 4);
});

test('oversized answer sheets are refused before any read', async () => {
  const { core, store } = setup();
  const { id } = await core.publish('u1', { title: 'F', form: FORM });
  store.cost.reads = 0;
  await assert.rejects(() => core.submit(id, { name: 'x'.repeat(LIMITS.answers + 1) }), e => e.code === 'big');
  assert.equal(store.cost.reads, 0);
});

test('the owner pulls only what is new, and an up-to-date pull reads almost nothing', async () => {
  const { core, store } = setup();
  const { id } = await core.publish('u1', { title: 'F', form: FORM });
  for (const n of ['A', 'B', 'C']) await core.submit(id, { name: n });
  const first = await core.pull('u1', id, 0);
  assert.deepEqual(first.responses.map(r => r.answers.name), ['A', 'B', 'C']);
  assert.equal(first.count, 3);
  store.cost.reads = 0;
  const idle = await core.pull('u1', id, 3);
  assert.deepEqual(idle.responses, []);
  assert.equal(store.cost.reads, 1, 'only the form itself');
  await core.submit(id, { name: 'D' });
  store.cost.reads = 0;
  const next = await core.pull('u1', id, 3);
  assert.deepEqual(next.responses.map(r => r.n), [4]);
  assert.equal(store.cost.reads, 2);
});

test('the view is kept in memory, so a busy link does not read Firestore for every visitor', async () => {
  const { core, store } = setup({ cacheMs: 60_000 });
  const { id } = await core.publish('u1', { title: 'F', form: FORM });
  store.cost.reads = 0;
  for (let i = 0; i < 20; i++) await core.view(id);
  assert.equal(store.cost.reads, 1);
});

test('one account can only publish so many forms', async () => {
  const { core } = setup();
  for (let i = 0; i < LIMITS.forms; i++) await core.publish('u1', { title: 'F' + i, form: FORM });
  await assert.rejects(() => core.publish('u1', { title: 'one more', form: FORM }), e => e.code === 'limit');
  await core.publish('u2', { title: 'someone else', form: FORM });
});

test('a form with no questions cannot be published', async () => {
  const { core } = setup();
  await assert.rejects(() => core.publish('u1', { title: 'Empty', form: { questions: [] } }), e => e.code === 'bad');
});

test('the page puts the questions in safely and shows closed forms as a notice', () => {
  const view = { title: '<b>Hi</b>', description: 'd', closesOn: '', open: true, questions: [{ id: 'a', type: 'short', title: '</script><script>alert(1)</script>', required: false }] };
  const html = renderForm('abc12345', view, 'N0NCE');
  assert.ok(!html.includes('<b>Hi</b>'));
  assert.ok(!html.includes('</script><script>alert(1)'));
  assert.ok(html.includes('nonce="N0NCE"'));
  assert.ok(renderForm('abc12345', { ...view, open: false }, 'N').includes('closed'));
  assert.ok(noticePage('Gone', '<x>').includes('&lt;x&gt;'));
});
