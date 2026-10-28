const test = require('node:test');
const assert = require('node:assert');
const R = require('../firestore-rest');

test('values round-trip through the Firestore format', () => {
  const data = { s: 'hi', n: 3, f: 1.5, b: false, nil: null, list: ['a', 'b'], map: { x: 1, y: { z: 'deep' } }, when: { $timestamp: '2026-10-28T10:00:00.123456Z' } };
  const fields = R.toFields(data);
  assert.deepStrictEqual(fields.s, { stringValue: 'hi' });
  assert.deepStrictEqual(fields.n, { integerValue: '3' });
  assert.deepStrictEqual(fields.f, { doubleValue: 1.5 });
  assert.deepStrictEqual(fields.when, { timestampValue: '2026-10-28T10:00:00.123456Z' });
  assert.deepStrictEqual(R.fromFields(fields), { ...data, when: '2026-10-28T10:00:00.123456Z' });
  assert.deepStrictEqual(R.toFields({ keep: 1, drop: undefined }), { keep: { integerValue: '1' } });
});

test('fromDocument takes the id from the document name', () => {
  const doc = { name: 'projects/p/databases/(default)/documents/teams/t1/tasks/abc', fields: { title: { stringValue: 'x' } } };
  assert.deepStrictEqual(R.fromDocument(doc), { id: 'abc', title: 'x' });
});

test('field paths quote anything that is not a plain identifier', () => {
  assert.strictEqual(R.fieldPath(['members', 'abc123']), 'members.abc123');
  assert.strictEqual(R.fieldPath(['members', 'a-b']), 'members.`a-b`');
  assert.strictEqual(R.fieldPath(['members', '1abc']), 'members.`1abc`');
});

test('createWrite must not overwrite and stamps server times', () => {
  const w = R.createWrite('p', 'teams/t1', { name: 'x' }, { serverTime: ['createdAt', 'updatedAt'] });
  assert.strictEqual(w.update.name, 'projects/p/databases/(default)/documents/teams/t1');
  assert.deepStrictEqual(w.currentDocument, { exists: false });
  assert.deepStrictEqual(w.updateTransforms.map(t => [t.fieldPath, t.setToServerValue]), [['createdAt', 'REQUEST_TIME'], ['updatedAt', 'REQUEST_TIME']]);
});

test('patchWrite masks exactly the changed fields, nests map entries and supports array changes', () => {
  const w = R.patchWrite('p', 'teams/t1', {
    set: [[['members', 'u-1'], { role: 'member' }], [['name'], 'New']],
    remove: [['members', 'gone']],
    serverTime: ['updatedAt'],
    arrayUnion: [['memberIds', ['u-1']]],
    arrayRemove: [['memberIds', ['gone']]],
  });
  assert.deepStrictEqual(w.updateMask.fieldPaths, ['members.`u-1`', 'name', 'members.gone']);
  assert.deepStrictEqual(R.fromFields(w.update.fields), { members: { 'u-1': { role: 'member' } }, name: 'New' });
  assert.deepStrictEqual(w.currentDocument, { exists: true });
  assert.strictEqual(w.updateTransforms.length, 3);
  assert.deepStrictEqual(w.updateTransforms[1].appendMissingElements.values, [{ stringValue: 'u-1' }]);
  assert.deepStrictEqual(w.updateTransforms[2].removeAllFromArray.values, [{ stringValue: 'gone' }]);
});

test('structuredQuery builds single and combined filters', () => {
  const one = R.structuredQuery({ collection: 'tasks', where: [{ field: 'deleted', op: '==', value: false }] });
  assert.deepStrictEqual(one.where.fieldFilter, { field: { fieldPath: 'deleted' }, op: 'EQUAL', value: { booleanValue: false } });
  const two = R.structuredQuery({ collection: 'tasks', where: [{ field: 'updatedAt', op: '>=', value: { $timestamp: '2026-10-28T10:00:00Z' } }, { field: 'deleted', op: '==', value: false }], limit: 50 });
  assert.strictEqual(two.where.compositeFilter.op, 'AND');
  assert.strictEqual(two.where.compositeFilter.filters[0].fieldFilter.op, 'GREATER_THAN_OR_EQUAL');
  assert.deepStrictEqual(two.where.compositeFilter.filters[0].fieldFilter.value, { timestampValue: '2026-10-28T10:00:00Z' });
  assert.strictEqual(two.limit, 50);
});

test('parseQueryResponse skips the empty-result marker', () => {
  assert.deepStrictEqual(R.parseQueryResponse([{ readTime: 'x' }]), []);
  assert.strictEqual(R.parseQueryResponse([{ document: { name: 'a/b/c', fields: {} } }])[0].id, 'c');
});

test('Firestore errors become short messages with a code', () => {
  const e = (status, s, message = '') => R.firestoreError(status, { error: { status: s, message } });
  assert.strictEqual(e(403, 'PERMISSION_DENIED').code, 'forbidden');
  assert.strictEqual(e(429, 'RESOURCE_EXHAUSTED').code, 'quota');
  assert.strictEqual(e(401, 'UNAUTHENTICATED').code, 'auth');
  assert.strictEqual(e(404, 'NOT_FOUND').code, 'not-found');
  assert.strictEqual(e(409, 'ALREADY_EXISTS').code, 'conflict');
  assert.strictEqual(e(404, 'NOT_FOUND', 'The database (default) does not exist for project p').code, 'setup');
  assert.strictEqual(e(403, 'PERMISSION_DENIED', 'Cloud Firestore API has not been used in project p').code, 'setup');
  assert.strictEqual(e(500, 'INTERNAL').code, 'network');
});

test('request sends the token and maps a failed response', async () => {
  const calls = [];
  const ok = async (url, init) => { calls.push([url, init]); return { ok: true, status: 200, text: async () => '{"a":1}' }; };
  assert.deepStrictEqual(await R.request(ok, 'tok', 'POST', 'https://x/y', { q: 1 }), { a: 1 });
  assert.strictEqual(calls[0][1].headers.Authorization, 'Bearer tok');
  assert.strictEqual(calls[0][1].body, '{"q":1}');
  const denied = async () => ({ ok: false, status: 403, text: async () => '{"error":{"status":"PERMISSION_DENIED"}}' });
  await assert.rejects(() => R.request(denied, 't', 'GET', 'https://x'), e => e.code === 'forbidden');
  const offline = async () => { throw new Error('ENOTFOUND'); };
  await assert.rejects(() => R.request(offline, 't', 'GET', 'https://x'), e => e.code === 'network');
});
