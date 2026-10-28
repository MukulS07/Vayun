// Tests firestore.rules against Google's Firestore emulator: npm run test:rules (from desktop/).
// Part 1 runs the same shared checks as the other backends, through the real rules.
// Part 2 plays a hostile client that skips the app's own checks and sends raw requests. Every attack is
// paired with a control request that must succeed, so a "denied" can never just mean a typo in the request.
const test = require('node:test');
const assert = require('node:assert');
const runContract = require('../test/helpers/team-contract');
const { FirestoreTeamStore } = require('../team-store-firestore');
const R = require('../firestore-rest');

const HOST = process.env.FIRESTORE_EMULATOR_HOST; // set by firebase emulators:exec
const PROJECT = 'demo-vayun';

if (!HOST) {
  test('firestore.rules tests need the emulator', { skip: 'run them with: npm run test:rules' }, () => {});
  return;
}

const BASE = `http://${HOST}/v1`;
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
// The emulator does not check signatures; it reads who is asking from the token.
const tokenFor = uid => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ user_id: uid, sub: uid, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, iat: 1, exp: 4102444800, firebase: { sign_in_provider: 'google.com', identities: {} } })}.`;
const clearDatabase = () => fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });

// ---------- part 1: the shared checks, through the real rules ----------
runContract('firestore store + real rules', async () => {
  await clearDatabase();
  return {
    storeFor: me => new FirestoreTeamStore({
      project: PROJECT, baseUrl: BASE, me,
      getToken: async () => tokenFor((typeof me === 'function' ? me() : me).uid),
    }),
  };
});

// ---------- part 2: attacks ----------
function raw(uid) {
  const call = async (method, suffix, body) => {
    const res = await fetch(`${BASE}/${R.docsRoot(PROJECT)}${suffix}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(uid && { Authorization: `Bearer ${tokenFor(uid)}` }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return {
    get: path => call('GET', '/' + path),
    commit: writes => call('POST', ':commit', { writes }),
    query: (parent, q) => call('POST', (parent ? '/' + parent : '') + ':runQuery', { structuredQuery: R.structuredQuery(q) }),
  };
}
const ok = (r, what) => assert.strictEqual(r.status, 200, `${what} should be allowed, got ${r.status} ${JSON.stringify(r.json && r.json.error && r.json.error.message)}`);
const denied = (r, what) => assert.strictEqual(r.status, 403, `${what} should be denied, got ${r.status}`);

const users = { head: 'head', ana: 'ana', raj: 'raj', eve: 'eve' };
const me = uid => ({ uid, name: uid, email: `${uid}@example.com` });
const store = uid => new FirestoreTeamStore({ project: PROJECT, baseUrl: BASE, me: me(uid), getToken: async () => tokenFor(uid) });

// A team with a head and two members (Ana, Raj), one task for Ana and one team event. Eve is an outsider.
async function world() {
  await clearDatabase();
  const head = store('head');
  const team = await head.createTeam('Design');
  await store('ana').joinTeam(team.inviteCode);
  await store('raj').joinTeam(team.inviteCode);
  const task = await head.createTask(team.id, { title: 'Draw the logo', assigneeUid: 'ana' });
  const event = await head.createEvent(team.id, { title: 'Standup', startDate: '2026-11-02', allDay: true });
  return { team, task, event, T: `teams/${team.id}`, tasks: `teams/${team.id}/tasks`, events: `teams/${team.id}/events` };
}
const taskData = (o = {}) => ({ title: 'New', notes: '', assigneeUid: 'ana', status: 'todo', priority: 'medium', dueDate: '', createdBy: 'head', deleted: false, ...o });
const eventData = (o = {}) => ({ title: 'Meet', startDate: '2026-11-03', endDate: '2026-11-03', allDay: true, startTime: '', endTime: '', notes: '', createdBy: 'head', deleted: false, ...o });
const createTask = (w, uid, data, id = 'x' + Math.random().toString(36).slice(2, 9)) => raw(uid).commit([R.createWrite(PROJECT, `${w.tasks}/${id}`, data, { serverTime: ['createdAt', 'updatedAt'] })]);
const patch = (w, uid, path, set, serverTime = ['updatedAt']) => raw(uid).commit([R.patchWrite(PROJECT, path, { set: Object.entries(set).map(([k, v]) => [[k], v]), serverTime })]);
const patchTask = (w, uid, set, serverTime) => patch(w, uid, `${w.tasks}/${w.task.id}`, set, serverTime);

test('tasks: only the head creates them, and only well-formed ones', async () => {
  const w = await world();
  ok(await createTask(w, 'head', taskData()), 'head creating a valid task');
  denied(await createTask(w, 'ana', taskData({ createdBy: 'ana' })), 'a member creating a task');
  denied(await createTask(w, 'eve', taskData({ createdBy: 'eve' })), 'an outsider creating a task');
  denied(await createTask(w, 'head', taskData({ assigneeUid: 'eve' })), 'giving a task to a non-member');
  denied(await createTask(w, 'head', taskData({ createdBy: 'ana' })), 'faking who created a task');
  denied(await createTask(w, 'head', taskData({ title: '' })), 'an empty title');
  denied(await createTask(w, 'head', taskData({ title: 'x'.repeat(201) })), 'a 201-character title');
  denied(await createTask(w, 'head', taskData({ notes: 'x'.repeat(4001) })), 'oversized notes');
  denied(await createTask(w, 'head', taskData({ status: 'finished' })), 'an unknown status');
  denied(await createTask(w, 'head', taskData({ priority: 'urgent' })), 'an unknown priority');
  denied(await createTask(w, 'head', taskData({ dueDate: '5 Nov' })), 'a badly formatted due date');
  denied(await createTask(w, 'head', taskData({ deleted: true })), 'creating a task already deleted');
  denied(await createTask(w, 'head', { ...taskData(), isAdmin: true }), 'an unknown extra field');
  denied(await raw('head').commit([R.createWrite(PROJECT, `${w.tasks}/clientclock`, { ...taskData(), createdAt: { $timestamp: '2020-01-01T00:00:00Z' }, updatedAt: { $timestamp: '2020-01-01T00:00:00Z' } })]), 'timestamps the client chose');
});

test('tasks: the assignee changes only the status, nobody else changes anything', async () => {
  const w = await world();
  ok(await patchTask(w, 'ana', { status: 'doing' }), 'the assignee changing the status');
  denied(await patchTask(w, 'ana', { status: 'finished' }), 'the assignee using an unknown status');
  denied(await patchTask(w, 'ana', { title: 'Mine now' }), 'the assignee changing the title');
  denied(await patchTask(w, 'ana', { status: 'done', priority: 'low' }), 'the assignee changing status and priority together');
  denied(await patchTask(w, 'ana', { assigneeUid: 'raj' }), 'the assignee handing the task to someone else');
  denied(await patchTask(w, 'ana', { deleted: true }), 'the assignee deleting it');
  denied(await patchTask(w, 'ana', { createdBy: 'ana' }), 'the assignee rewriting who created it');
  denied(await patchTask(w, 'raj', { status: 'done' }), 'another member changing the status');
  denied(await patchTask(w, 'eve', { status: 'done' }), 'an outsider changing the status');
  denied(await patchTask(w, 'ana', { status: 'done' }, []), 'a status change without the server time');
  denied(await patchTask(w, 'ana', { status: 'done', updatedAt: { $timestamp: '2020-01-01T00:00:00Z' } }, []), 'a status change with a client-chosen time');
});

test('tasks: the head edits and reassigns but cannot rewrite history', async () => {
  const w = await world();
  ok(await patchTask(w, 'head', { assigneeUid: 'raj', priority: 'high', title: 'Draw it' }), 'the head editing a task');
  ok(await patchTask(w, 'head', { deleted: true }), 'the head marking a task deleted');
  denied(await patchTask(w, 'head', { assigneeUid: 'eve' }), 'reassigning to a non-member');
  denied(await patchTask(w, 'head', { createdBy: 'raj' }), 'changing who created it');
  denied(await patchTask(w, 'head', { title: '' }), 'blanking the title');
  denied(await patchTask(w, 'head', { surprise: 1 }), 'adding an unknown field');
});

test('nothing is ever really deleted', async () => {
  const w = await world();
  for (const uid of ['head', 'ana', 'eve']) {
    denied(await raw(uid).commit([R.deleteWrite(PROJECT, `${w.tasks}/${w.task.id}`)]), `${uid} deleting a task`);
    denied(await raw(uid).commit([R.deleteWrite(PROJECT, `${w.events}/${w.event.id}`)]), `${uid} deleting an event`);
    denied(await raw(uid).commit([R.deleteWrite(PROJECT, w.T)]), `${uid} deleting the team`);
  }
});

test('reading: only members read a team, its tasks and events', async () => {
  const w = await world();
  ok(await raw('ana').get(w.T), 'a member reading the team');
  ok(await raw('ana').get(`${w.tasks}/${w.task.id}`), 'a member reading a task');
  ok(await raw('ana').query(w.T, { collection: 'tasks', where: [{ field: 'deleted', op: '==', value: false }] }), 'a member listing tasks');
  for (const [what, r] of [
    ['reading the team', await raw('eve').get(w.T)],
    ['reading a task', await raw('eve').get(`${w.tasks}/${w.task.id}`)],
    ['listing tasks', await raw('eve').query(w.T, { collection: 'tasks', where: [{ field: 'deleted', op: '==', value: false }] })],
    ['listing events', await raw('eve').query(w.T, { collection: 'events', where: [{ field: 'deleted', op: '==', value: false }] })],
    ['reading the team without signing in', await raw(null).get(w.T)],
  ]) denied(r, `an outsider ${what}`);
  denied(await raw('eve').query('', { collection: 'teams', where: [{ field: 'memberIds', op: 'array-contains', value: 'head' }] }), 'listing teams that someone else belongs to');
  ok(await raw('eve').query('', { collection: 'teams', where: [{ field: 'memberIds', op: 'array-contains', value: 'eve' }] }), 'listing my own teams (none)');
});

test('joining: you need the current invite code, and you can only add yourself as a member', async () => {
  const w = await world();
  const profile = (o = {}) => ({ name: 'Eve', email: 'eve@example.com', photoURL: '', role: 'member', joinCode: w.team.inviteCode, ...o });
  const join = (uid, entry, extra = {}) => raw(uid).commit([R.patchWrite(PROJECT, w.T, { set: [[['members', uid], entry]], serverTime: ['updatedAt'], arrayUnion: [['memberIds', [uid]]], ...extra })]);
  denied(await join('eve', profile({ joinCode: 'WRONGCOD' })), 'joining with a wrong code');
  denied(await join('eve', profile({ joinCode: undefined })), 'joining with no code');
  denied(await join('eve', profile({ role: 'head' })), 'joining as head');
  denied(await join('eve', { ...profile(), isAdmin: true }), 'joining with extra profile fields');
  denied(await join('eve', profile({ name: 'x'.repeat(101) })), 'joining with a 101-character name');
  denied(await join('eve', profile({ email: 'x'.repeat(201) })), 'joining with a 201-character email');
  denied(await join('eve', profile({ photoURL: 'x'.repeat(1001) })), 'joining with a 1001-character photo link');
  denied(await raw('eve').commit([R.patchWrite(PROJECT, w.T, { set: [[['members', 'eve'], profile()]], serverTime: ['updatedAt'], arrayUnion: [['memberIds', ['eve', 'mallory']]] })]), 'adding someone else along with yourself');
  denied(await raw('eve').commit([R.patchWrite(PROJECT, w.T, { set: [[['members', 'mallory'], profile()]], serverTime: ['updatedAt'], arrayUnion: [['memberIds', ['mallory']]] })]), 'adding a different person');
  denied(await raw('eve').commit([R.patchWrite(PROJECT, w.T, { set: [[['members', 'eve'], profile()], [['name'], 'Hijacked']], serverTime: ['updatedAt'], arrayUnion: [['memberIds', ['eve']]] })]), 'renaming the team while joining');
  ok(await join('eve', profile()), 'joining with the right code');
  ok(await raw('eve').get(w.T), 'a new member then reading the team');
});

test('members: nobody makes themselves head or removes other people', async () => {
  const w = await world();
  denied(await raw('ana').commit([R.patchWrite(PROJECT, w.T, { set: [[['members', 'ana', 'role'], 'head']], serverTime: ['updatedAt'] })]), 'a member making themselves head');
  denied(await raw('ana').commit([R.patchWrite(PROJECT, w.T, { remove: [['members', 'raj']], serverTime: ['updatedAt'], arrayRemove: [['memberIds', ['raj']]] })]), 'a member removing someone else');
  denied(await raw('ana').commit([R.patchWrite(PROJECT, w.T, { set: [[['name'], 'Mine']], serverTime: ['updatedAt'] })]), 'a member renaming the team');
  denied(await raw('ana').commit([R.patchWrite(PROJECT, w.T, { set: [[['inviteCode'], 'AAAAAAAA']], serverTime: ['updatedAt'] })]), 'a member changing the invite code');
  ok(await raw('ana').commit([R.patchWrite(PROJECT, w.T, { remove: [['members', 'ana']], serverTime: ['updatedAt'], arrayRemove: [['memberIds', ['ana']]] })]), 'a member leaving');
  denied(await raw('ana').get(w.T), 'a former member reading the team');
});

test('head: edits the team but stays head and a member', async () => {
  const w = await world();
  ok(await raw('head').commit([R.patchWrite(PROJECT, w.T, { set: [[['name'], 'Design team']], serverTime: ['updatedAt'] })]), 'the head renaming the team');
  ok(await raw('head').commit([R.patchWrite(PROJECT, w.T, { remove: [['members', 'raj']], serverTime: ['updatedAt'], arrayRemove: [['memberIds', ['raj']]] })]), 'the head removing a member');
  denied(await raw('head').commit([R.patchWrite(PROJECT, w.T, { set: [[['headUid'], 'ana']], serverTime: ['updatedAt'] })]), 'the head changing headUid');
  denied(await raw('head').commit([R.patchWrite(PROJECT, w.T, { remove: [['members', 'head']], serverTime: ['updatedAt'], arrayRemove: [['memberIds', ['head']]] })]), 'the head removing themselves');
  denied(await raw('head').commit([R.patchWrite(PROJECT, w.T, { set: [[['name'], '']], serverTime: ['updatedAt'] })]), 'an empty team name');
  denied(await raw('head').commit([R.patchWrite(PROJECT, w.T, { set: [[['inviteCode'], 'short']], serverTime: ['updatedAt'] })]), 'a malformed invite code');
});

test('creating a team: you can only make yourself the head of a new team', async () => {
  await clearDatabase();
  const base = (o = {}) => ({ name: 'Mine', headUid: 'eve', memberIds: ['eve'], members: { eve: { name: 'Eve', email: 'e@x.com', photoURL: '', role: 'head' } }, inviteCode: 'ABCD2345', ...o });
  const make = (uid, id, data) => raw(uid).commit([R.createWrite(PROJECT, `teams/${id}`, data, { serverTime: ['createdAt', 'updatedAt'] })]);
  ok(await make('eve', 't-ok', base()), 'creating a team as its head');
  denied(await make('eve', 't-1', base({ headUid: 'head' })), 'naming someone else as head');
  denied(await make('eve', 't-2', base({ memberIds: ['eve', 'head'] })), 'starting with extra members');
  denied(await make('eve', 't-3', base({ members: { eve: { name: 'Eve', email: 'e@x.com', photoURL: '', role: 'member' } } })), 'starting as a plain member');
  denied(await make('eve', 't-4', { ...base(), isAdmin: true }), 'an unknown extra field');
  denied(await make('eve', 't-5', base({ name: '' })), 'an empty name');
  denied(await make('eve', 't-6', base({ inviteCode: 'short' })), 'a malformed invite code');
  denied(await make('eve', 't-8', base({ members: { eve: { name: 'x'.repeat(101), email: 'e@x.com', photoURL: '', role: 'head' } } })), 'a 101-character name');
  denied(await make('eve', 't-9', base({ members: { eve: { name: 'Eve', email: 5, photoURL: '', role: 'head' } } })), 'an email that is not text');
  denied(await make(null, 't-7', base()), 'creating a team without signing in');
});

test('invites: look up one code you know, never list them, only the head makes them', async () => {
  const w = await world();
  const code = w.team.inviteCode;
  ok(await raw('eve').get(`invites/${code}`), 'looking up a known code');
  denied(await raw(null).get(`invites/${code}`), 'looking up a code without signing in');
  denied(await raw('eve').query('', { collection: 'invites', where: [{ field: 'teamId', op: '==', value: w.team.id }] }), 'listing invite codes');
  denied(await raw('eve').commit([R.createWrite(PROJECT, 'invites/EVILCODE', { teamId: w.team.id, headUid: 'eve' }, { serverTime: ['createdAt'] })]), 'an outsider making a code for someone else’s team');
  denied(await raw('ana').commit([R.createWrite(PROJECT, 'invites/ANACODE2', { teamId: w.team.id, headUid: 'ana' }, { serverTime: ['createdAt'] })]), 'a member making a code');
  denied(await raw('ana').commit([R.deleteWrite(PROJECT, `invites/${code}`)]), 'a member deleting the code');
  denied(await raw('head').commit([R.patchWrite(PROJECT, `invites/${code}`, { set: [[['teamId'], 'other']] })]), 'changing where a code points');
});

test('events: only the head writes them, in the right shape', async () => {
  const w = await world();
  const create = (uid, data) => raw(uid).commit([R.createWrite(PROJECT, `${w.events}/e${Math.random().toString(36).slice(2, 9)}`, data, { serverTime: ['createdAt', 'updatedAt'] })]);
  ok(await create('head', eventData()), 'the head creating an event');
  ok(await raw('ana').get(`${w.events}/${w.event.id}`), 'a member reading an event');
  denied(await create('ana', eventData({ createdBy: 'ana' })), 'a member creating an event');
  denied(await create('head', eventData({ startDate: '2026/11/03' })), 'a badly formatted date');
  denied(await create('head', eventData({ startTime: '25:99' })), 'an impossible time');
  denied(await create('head', eventData({ title: '' })), 'an empty title');
  denied(await create('head', eventData({ title: 'x'.repeat(301) })), 'a 301-character title');
  denied(await create('head', eventData({ createdBy: 'ana' })), 'faking who created it');
  ok(await patch(w, 'head', `${w.events}/${w.event.id}`, { title: 'Daily standup' }), 'the head editing an event');
  denied(await patch(w, 'ana', `${w.events}/${w.event.id}`, { title: 'Hijacked' }), 'a member editing an event');
  ok(await patch(w, 'head', `${w.events}/${w.event.id}`, { deleted: true }), 'the head marking an event deleted');
});
