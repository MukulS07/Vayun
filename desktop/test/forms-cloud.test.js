const test = require('node:test');
const assert = require('node:assert');
const F = require('../app/forms-logic');
const { createFormsCloud } = require('../forms-cloud');

let n = 0;
const uid = () => 'u' + ++n;
const base = () => F.sanitize({
  description: 'd', closesOn: '2026-12-01',
  questions: [{ id: 'name', type: 'short', title: 'Name', required: true, src: 'Column A' }, { id: 'team', type: 'choice', title: 'Team', options: ['Dev', 'Ops'] }],
  responses: [{ id: 'local1', at: '2026-11-01T09:00:00.000Z', answers: { name: 'Local' } }],
}, uid);

test('web link: the published definition has the questions only, never the responses or the import column', () => {
  const def = F.publicDefinition(base());
  assert.deepStrictEqual(Object.keys(def).sort(), ['closesOn', 'description', 'questions']);
  assert.ok(!JSON.stringify(def).includes('Column A'));
  assert.ok(!JSON.stringify(def).includes('Local'));
});

test('web link: answers pulled from the server are added once, whatever happens to the pull', () => {
  const form = base();
  form.pub = { id: 'abcd1234', after: 0, open: true, syncedAt: '' };
  const rows = [
    { n: 1, at: Date.parse('2026-11-02T10:00:00Z'), answers: { name: 'Asha', team: 'Dev', gone: 'dropped' } },
    { n: 2, at: Date.parse('2026-11-02T11:00:00Z'), answers: { name: 'Ravi' } },
  ];
  assert.strictEqual(F.addRemote(form, rows, { uid }), 2);
  assert.strictEqual(form.pub.after, 2);
  assert.strictEqual(form.responses.length, 3);
  assert.deepStrictEqual(form.responses.find(r => r.key === 'web:1').answers, { name: 'Asha', team: 'Dev' });
  // the same rows again (a retry, or a pull that was interrupted) change nothing
  assert.strictEqual(F.addRemote(form, rows, { uid }), 0);
  assert.strictEqual(form.responses.length, 3);
  // responses stay in time order, with the one made on this computer first
  assert.deepStrictEqual(form.responses.map(r => r.id).slice(0, 1), ['local1']);
});

test('web link: the link survives saving and loading, and a damaged one is dropped', () => {
  const form = base();
  form.pub = { id: 'abcd1234', after: 7, open: false, syncedAt: '2026-11-03T08:00:00.000Z' };
  assert.deepStrictEqual(F.sanitize(JSON.parse(JSON.stringify(form)), uid).pub, form.pub);
  for (const id of ['', 'A B', '../x', 'x'.repeat(40), 12]) assert.strictEqual(F.sanitize({ ...base(), pub: { id } }, uid).pub, undefined);
});

function fakeServer(reply) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init: { ...init, body: JSON.parse(init.body) } });
      const { status = 200, body = {} } = typeof reply === 'function' ? reply(url) : reply;
      return { ok: status < 400, status, json: async () => body };
    },
  };
}
const client = (server, over = {}) => createFormsCloud({ getToken: async () => 'TOKEN', getProjectId: () => 'my-proj', fetch: server.fetch, ...over });

test('client: publish sends the person\'s token and gives back the link', async () => {
  const server = fakeServer({ body: { id: 'abcd1234', count: 0 } });
  const r = await client(server).publish({ title: 'T', form: F.publicDefinition(base()) });
  assert.strictEqual(r.link, 'https://us-central1-my-proj.cloudfunctions.net/forms/f/abcd1234');
  assert.strictEqual(server.calls[0].url, 'https://us-central1-my-proj.cloudfunctions.net/forms/publish');
  assert.strictEqual(server.calls[0].init.headers.authorization, 'Bearer TOKEN');
});

test('client: pull asks only for what is after the last response it has', async () => {
  const server = fakeServer({ body: { count: 5, open: true, responses: [] } });
  await client(server).pull({ id: 'abcd1234', after: 4 });
  assert.deepStrictEqual(server.calls[0].init.body, { id: 'abcd1234', after: 4 });
});

test('client: errors come back as a message, never a throw', async () => {
  assert.deepStrictEqual(await client(fakeServer({ status: 403, body: { error: { message: 'Only the owner.' } } })).pull({ id: 'x' }), { error: 'Only the owner.' });
  assert.match((await client(fakeServer({ status: 500, body: null })).pull({ id: 'x' })).error, /500/);
  assert.match((await client({ fetch: async () => { throw new Error('down'); } }).pull({ id: 'x' })).error, /Could not reach/);
  assert.match((await client(fakeServer({}), { getToken: async () => { throw new Error('Sign in again.'); } }).pull({ id: 'x' })).error, /Sign in again/);
  assert.match((await client(fakeServer({}), { getProjectId: () => '' }).pull({ id: 'x' })).error, /Sign in to Vayun/);
});
