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

const me = uid => ({ uid, name: uid, email: `${uid}@example.com` });
const store = uid => new FirestoreTeamStore({ project: PROJECT, baseUrl: BASE, me: me(uid), getToken: async () => tokenFor(uid) });

// Owen created the team (owner, admin). Lea is a lead; Ana and Raj are members; Eve is an outsider.
// Owen's task for Ana, Lea's task for Raj, and a team event from each of Owen and Lea.
async function world() {
  await clearDatabase();
  const owner = store('owner');
  const team = await owner.createTeam('Design');
  for (const u of ['lea', 'ana', 'raj']) await store(u).joinTeam(team.inviteCode);
  await owner.setRole(team.id, 'lea', 'lead');
  const task = await owner.createTask(team.id, { title: 'Draw the logo', assigneeUid: 'ana' });
  const leaTask = await store('lea').createTask(team.id, { title: 'Write copy', assigneeUid: 'raj' });
  const event = await owner.createEvent(team.id, { title: 'Standup', startDate: '2026-11-02', allDay: true });
  const leaEvent = await store('lea').createEvent(team.id, { title: 'Lea sync', startDate: '2026-11-03', allDay: true });
  return { team, task, leaTask, event, leaEvent, T: `teams/${team.id}`, tasks: `teams/${team.id}/tasks`, events: `teams/${team.id}/events` };
}
const taskData = (o = {}) => ({ title: 'New', notes: '', assigneeUid: 'ana', status: 'todo', priority: 'medium', dueDate: '', mustDo: false, createdBy: 'owner', deleted: false, ...o });
const eventData = (o = {}) => ({ title: 'Meet', startDate: '2026-11-03', endDate: '2026-11-03', allDay: true, startTime: '', endTime: '', notes: '', createdBy: 'owner', deleted: false, ...o });
const createTask = (w, uid, data, id = 'x' + Math.random().toString(36).slice(2, 9)) => raw(uid).commit([R.createWrite(PROJECT, `${w.tasks}/${id}`, data, { serverTime: ['createdAt', 'updatedAt'] })]);
const patch = (uid, path, set, serverTime = ['updatedAt']) => raw(uid).commit([R.patchWrite(PROJECT, path, { set: Object.entries(set).map(([k, v]) => [k.split('.'), v]), serverTime })]);
const patchTask = (w, uid, set, serverTime, which = w.task) => patch(uid, `${w.tasks}/${which.id}`, set, serverTime);
const patchTeam = (w, uid, set, extra = {}) => raw(uid).commit([R.patchWrite(PROJECT, w.T, { set: Object.entries(set).map(([k, v]) => [k.split('.'), v]), serverTime: ['updatedAt'], ...extra })]);

test('tasks: admins and leads create them, members and outsiders cannot, and only well-formed ones', async () => {
  const w = await world();
  ok(await createTask(w, 'owner', taskData()), 'an admin creating a valid task');
  ok(await createTask(w, 'lea', taskData({ createdBy: 'lea' })), 'a lead creating a task');
  ok(await createTask(w, 'owner', taskData({ mustDo: true })), 'an admin creating a must-do task');
  denied(await createTask(w, 'ana', taskData({ createdBy: 'ana' })), 'a member creating a task');
  denied(await createTask(w, 'eve', taskData({ createdBy: 'eve' })), 'an outsider creating a task');
  denied(await createTask(w, 'owner', taskData({ assigneeUid: 'eve' })), 'giving a task to a non-member');
  denied(await createTask(w, 'owner', taskData({ createdBy: 'lea' })), 'faking who created a task');
  denied(await createTask(w, 'lea', taskData({ createdBy: 'owner' })), 'a lead faking an admin as the creator');
  denied(await createTask(w, 'owner', taskData({ title: '' })), 'an empty title');
  denied(await createTask(w, 'owner', taskData({ title: 'x'.repeat(201) })), 'a 201-character title');
  denied(await createTask(w, 'owner', taskData({ notes: 'x'.repeat(4001) })), 'oversized notes');
  denied(await createTask(w, 'owner', taskData({ status: 'finished' })), 'an unknown status');
  denied(await createTask(w, 'owner', taskData({ priority: 'urgent' })), 'an unknown priority');
  denied(await createTask(w, 'owner', taskData({ dueDate: '5 Nov' })), 'a badly formatted due date');
  denied(await createTask(w, 'owner', taskData({ mustDo: 'yes' })), 'a must-do flag that is not true or false');
  denied(await createTask(w, 'owner', taskData({ deleted: true })), 'creating a task already deleted');
  denied(await createTask(w, 'owner', { ...taskData(), isAdmin: true }), 'an unknown extra field');
  denied(await raw('owner').commit([R.createWrite(PROJECT, `${w.tasks}/clientclock`, { ...taskData(), createdAt: { $timestamp: '2020-01-01T00:00:00Z' }, updatedAt: { $timestamp: '2020-01-01T00:00:00Z' } })]), 'timestamps the client chose');
});

test('tasks: the assignee changes only the status, nobody else changes anything they should not', async () => {
  const w = await world();
  ok(await patchTask(w, 'ana', { status: 'doing' }), 'the assignee changing the status');
  denied(await patchTask(w, 'ana', { status: 'finished' }), 'the assignee using an unknown status');
  denied(await patchTask(w, 'ana', { title: 'Mine now' }), 'the assignee changing the title');
  denied(await patchTask(w, 'ana', { mustDo: true }), 'the assignee flagging their own task must-do');
  denied(await patchTask(w, 'ana', { status: 'done', priority: 'low' }), 'the assignee changing status and priority together');
  denied(await patchTask(w, 'ana', { assigneeUid: 'raj' }), 'the assignee handing the task to someone else');
  denied(await patchTask(w, 'ana', { deleted: true }), 'the assignee deleting it');
  denied(await patchTask(w, 'ana', { createdBy: 'ana' }), 'the assignee rewriting who created it');
  denied(await patchTask(w, 'raj', { status: 'done' }), 'another member changing the status');
  denied(await patchTask(w, 'eve', { status: 'done' }), 'an outsider changing the status');
  denied(await patchTask(w, 'ana', { status: 'done' }, []), 'a status change without the server time');
  denied(await patchTask(w, 'ana', { status: 'done', updatedAt: { $timestamp: '2020-01-01T00:00:00Z' } }, []), 'a status change with a client-chosen time');
});

test('tasks: a lead edits only what they created; an admin edits anything but cannot rewrite history', async () => {
  const w = await world();
  ok(await patchTask(w, 'lea', { title: 'Better copy', priority: 'high', mustDo: true }, undefined, w.leaTask), 'a lead editing their own task');
  ok(await patchTask(w, 'lea', { assigneeUid: 'ana' }, undefined, w.leaTask), 'a lead reassigning their own task');
  ok(await patchTask(w, 'lea', { deleted: true }, undefined, w.leaTask), 'a lead deleting their own task');
  denied(await patchTask(w, 'lea', { title: 'Mine now' }), 'a lead editing an admin’s task');
  denied(await patchTask(w, 'lea', { mustDo: true }), 'a lead flagging an admin’s task');
  denied(await patchTask(w, 'lea', { createdBy: 'owner' }, undefined, w.leaTask), 'a lead rewriting who created their task');
  denied(await patchTask(w, 'lea', { assigneeUid: 'eve' }, undefined, w.leaTask), 'a lead giving their task to an outsider');
  ok(await patchTask(w, 'owner', { assigneeUid: 'raj', priority: 'high', title: 'Draw it', mustDo: true }), 'an admin editing a task');
  ok(await patchTask(w, 'owner', { priority: 'low' }, undefined, w.leaTask), 'an admin editing a lead’s task');
  ok(await patchTask(w, 'owner', { deleted: true }), 'an admin marking a task deleted');
  denied(await patchTask(w, 'owner', { assigneeUid: 'eve' }), 'reassigning to a non-member');
  denied(await patchTask(w, 'owner', { createdBy: 'raj' }), 'changing who created it');
  denied(await patchTask(w, 'owner', { title: '' }), 'blanking the title');
  denied(await patchTask(w, 'owner', { surprise: 1 }), 'adding an unknown field');
});

test('tasks of someone who left: admins and leads can tidy them up but not hand them to a stranger', async () => {
  const w = await world();
  const t2 = await store('owner').createTask(w.team.id, { title: 'Another', assigneeUid: 'raj' });
  ok(await patchTeam(w, 'owner', {}, { remove: [['members', 'raj']], arrayRemove: [['memberIds', ['raj']]] }), 'an admin removing Raj');
  ok(await patch('owner', `${w.tasks}/${t2.id}`, { priority: 'high' }), 'an admin editing a task whose person left');
  ok(await patch('owner', `${w.tasks}/${t2.id}`, { deleted: true }), 'an admin deleting a task whose person left');
  ok(await patchTask(w, 'lea', { priority: 'low' }, undefined, w.leaTask), 'a lead editing their own task whose person left');
  denied(await patch('owner', `${w.tasks}/${t2.id}`, { assigneeUid: 'eve' }), 'giving it to someone outside the team');
  ok(await patch('owner', `${w.tasks}/${t2.id}`, { assigneeUid: 'ana' }), 'giving it to a current member');
  denied(await createTask(w, 'owner', taskData({ assigneeUid: 'raj' })), 'a brand-new task for someone who left');
  denied(await patchTask(w, 'raj', { status: 'done' }, undefined, w.leaTask), 'the person who left changing a status');
});

test('nothing is ever really deleted', async () => {
  const w = await world();
  for (const uid of ['owner', 'lea', 'ana', 'eve']) {
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
  denied(await raw('eve').query('', { collection: 'teams', where: [{ field: 'memberIds', op: 'array-contains', value: 'owner' }] }), 'listing teams that someone else belongs to');
  ok(await raw('eve').query('', { collection: 'teams', where: [{ field: 'memberIds', op: 'array-contains', value: 'eve' }] }), 'listing my own teams (none)');
});

test('joining: you need the current invite code, and you can only add yourself as a plain member', async () => {
  const w = await world();
  const profile = (o = {}) => ({ name: 'Eve', email: 'eve@example.com', photoURL: '', role: 'member', joinCode: w.team.inviteCode, ...o });
  const join = (uid, entry, extra = {}) => raw(uid).commit([R.patchWrite(PROJECT, w.T, { set: [[['members', uid], entry]], serverTime: ['updatedAt'], arrayUnion: [['memberIds', [uid]]], ...extra })]);
  denied(await join('eve', profile({ joinCode: 'WRONGCOD' })), 'joining with a wrong code');
  denied(await join('eve', profile({ joinCode: undefined })), 'joining with no code');
  denied(await join('eve', profile({ role: 'admin' })), 'joining as an admin');
  denied(await join('eve', profile({ role: 'lead' })), 'joining as a lead');
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

test('roles: only admins change them, nobody promotes themselves, and the owner is untouchable', async () => {
  const w = await world();
  denied(await patchTeam(w, 'ana', { 'members.ana.role': 'admin' }), 'a member making themselves admin');
  denied(await patchTeam(w, 'ana', { 'members.ana.role': 'lead' }), 'a member making themselves a lead');
  denied(await patchTeam(w, 'lea', { 'members.lea.role': 'admin' }), 'a lead making themselves admin');
  denied(await patchTeam(w, 'lea', { 'members.ana.role': 'lead' }), 'a lead promoting someone');
  denied(await patchTeam(w, 'eve', { 'members.eve.role': 'admin' }), 'an outsider writing a role');
  ok(await patchTeam(w, 'owner', { 'members.ana.role': 'lead' }), 'an admin promoting a member to lead');
  assert.ok((await store('ana').createTask(w.team.id, { title: 'Now allowed', assigneeUid: 'raj' })).id, 'the new lead giving a task');
  ok(await patchTeam(w, 'owner', { 'members.raj.role': 'admin' }), 'an admin making another admin');
  ok(await patchTeam(w, 'raj', { 'members.ana.role': 'member' }), 'the new admin demoting someone');
  denied(await patchTeam(w, 'raj', { 'members.owner.role': 'member' }), 'an admin demoting the owner');
  denied(await patchTeam(w, 'raj', { 'ownerUid': 'raj' }), 'an admin taking over as owner');
  denied(await raw('raj').commit([R.patchWrite(PROJECT, w.T, { remove: [['members', 'owner']], serverTime: ['updatedAt'], arrayRemove: [['memberIds', ['owner']]] })]), 'an admin removing the owner');
  denied(await raw('owner').commit([R.patchWrite(PROJECT, w.T, { remove: [['members', 'owner']], serverTime: ['updatedAt'], arrayRemove: [['memberIds', ['owner']]] })]), 'the owner removing themselves');
  ok(await raw('raj').commit([R.patchWrite(PROJECT, w.T, { remove: [['members', 'raj']], serverTime: ['updatedAt'], arrayRemove: [['memberIds', ['raj']]] })]), 'a second admin leaving');
});

test('people and the team itself: only admins rename, remove people or make codes; anyone but the owner leaves', async () => {
  const w = await world();
  denied(await patchTeam(w, 'ana', { name: 'Mine' }), 'a member renaming the team');
  denied(await patchTeam(w, 'lea', { name: 'Mine' }), 'a lead renaming the team');
  denied(await patchTeam(w, 'lea', { inviteCode: 'AAAAAAAA' }), 'a lead changing the invite code');
  denied(await raw('lea').commit([R.patchWrite(PROJECT, w.T, { remove: [['members', 'raj']], serverTime: ['updatedAt'], arrayRemove: [['memberIds', ['raj']]] })]), 'a lead removing someone');
  denied(await raw('ana').commit([R.patchWrite(PROJECT, w.T, { remove: [['members', 'raj']], serverTime: ['updatedAt'], arrayRemove: [['memberIds', ['raj']]] })]), 'a member removing someone else');
  ok(await patchTeam(w, 'owner', { name: 'Design team' }), 'an admin renaming the team');
  denied(await patchTeam(w, 'owner', { name: '' }), 'an empty team name');
  denied(await patchTeam(w, 'owner', { inviteCode: 'short' }), 'a malformed invite code');
  ok(await raw('lea').commit([R.patchWrite(PROJECT, w.T, { remove: [['members', 'lea']], serverTime: ['updatedAt'], arrayRemove: [['memberIds', ['lea']]] })]), 'a lead leaving');
  ok(await raw('owner').commit([R.patchWrite(PROJECT, w.T, { remove: [['members', 'raj']], serverTime: ['updatedAt'], arrayRemove: [['memberIds', ['raj']]] })]), 'an admin removing a member');
  denied(await raw('raj').get(w.T), 'a removed member reading the team');
});

test('creating a team: you can only make yourself its owner and first admin', async () => {
  await clearDatabase();
  const entry = (o = {}) => ({ name: 'Eve', email: 'e@x.com', photoURL: '', role: 'admin', ...o });
  const base = (o = {}) => ({ name: 'Mine', ownerUid: 'eve', memberIds: ['eve'], members: { eve: entry() }, inviteCode: 'ABCD2345', ...o });
  const make = (uid, id, data) => raw(uid).commit([R.createWrite(PROJECT, `teams/${id}`, data, { serverTime: ['createdAt', 'updatedAt'] })]);
  ok(await make('eve', 't-ok', base()), 'creating a team as its owner and admin');
  denied(await make('eve', 't-1', base({ ownerUid: 'owner' })), 'naming someone else as owner');
  denied(await make('eve', 't-2', base({ memberIds: ['eve', 'owner'] })), 'starting with extra members');
  denied(await make('eve', 't-3', base({ members: { eve: entry({ role: 'member' }) } })), 'starting as a plain member');
  denied(await make('eve', 't-3b', base({ members: { eve: entry({ role: 'lead' }) } })), 'starting as a lead');
  denied(await make('eve', 't-4', { ...base(), isAdmin: true }), 'an unknown extra field');
  denied(await make('eve', 't-5', base({ name: '' })), 'an empty name');
  denied(await make('eve', 't-6', base({ inviteCode: 'short' })), 'a malformed invite code');
  denied(await make('eve', 't-8', base({ members: { eve: entry({ name: 'x'.repeat(101) }) } })), 'a 101-character name');
  denied(await make('eve', 't-9', base({ members: { eve: entry({ email: 5 }) } })), 'an email that is not text');
  denied(await make(null, 't-7', base()), 'creating a team without signing in');
});

test('invites: look up one code you know, never list them, only an admin of the team makes or removes them', async () => {
  const w = await world();
  const code = w.team.inviteCode;
  ok(await raw('eve').get(`invites/${code}`), 'looking up a known code');
  denied(await raw(null).get(`invites/${code}`), 'looking up a code without signing in');
  denied(await raw('eve').query('', { collection: 'invites', where: [{ field: 'teamId', op: '==', value: w.team.id }] }), 'listing invite codes');
  denied(await raw('eve').commit([R.createWrite(PROJECT, 'invites/EVILCODE', { teamId: w.team.id, createdBy: 'eve' }, { serverTime: ['createdAt'] })]), 'an outsider making a code for someone else’s team');
  denied(await raw('lea').commit([R.createWrite(PROJECT, 'invites/LEACODE2', { teamId: w.team.id, createdBy: 'lea' }, { serverTime: ['createdAt'] })]), 'a lead making a code');
  denied(await raw('ana').commit([R.createWrite(PROJECT, 'invites/ANACODE2', { teamId: w.team.id, createdBy: 'ana' }, { serverTime: ['createdAt'] })]), 'a member making a code');
  denied(await raw('lea').commit([R.deleteWrite(PROJECT, `invites/${code}`)]), 'a lead deleting the code');
  denied(await raw('ana').commit([R.deleteWrite(PROJECT, `invites/${code}`)]), 'a member deleting the code');
  denied(await raw('owner').commit([R.patchWrite(PROJECT, `invites/${code}`, { set: [[['teamId'], 'other']] })]), 'changing where a code points');
  ok(await raw('owner').commit([R.deleteWrite(PROJECT, `invites/${code}`)]), 'an admin deleting the code');
});

test('events: admins and leads write them; a lead changes only their own; members cannot', async () => {
  const w = await world();
  const create = (uid, data) => raw(uid).commit([R.createWrite(PROJECT, `${w.events}/e${Math.random().toString(36).slice(2, 9)}`, data, { serverTime: ['createdAt', 'updatedAt'] })]);
  ok(await create('owner', eventData()), 'an admin creating an event');
  ok(await create('lea', eventData({ createdBy: 'lea' })), 'a lead creating an event');
  ok(await raw('ana').get(`${w.events}/${w.event.id}`), 'a member reading an event');
  denied(await create('ana', eventData({ createdBy: 'ana' })), 'a member creating an event');
  denied(await create('eve', eventData({ createdBy: 'eve' })), 'an outsider creating an event');
  denied(await create('owner', eventData({ startDate: '2026/11/03' })), 'a badly formatted date');
  denied(await create('owner', eventData({ startTime: '25:99' })), 'an impossible time');
  denied(await create('owner', eventData({ title: '' })), 'an empty title');
  denied(await create('owner', eventData({ title: 'x'.repeat(301) })), 'a 301-character title');
  denied(await create('owner', eventData({ createdBy: 'ana' })), 'faking who created it');
  ok(await patch('owner', `${w.events}/${w.event.id}`, { title: 'Daily standup' }), 'an admin editing an event');
  ok(await patch('owner', `${w.events}/${w.leaEvent.id}`, { title: 'Moved by the admin' }), 'an admin editing a lead’s event');
  ok(await patch('lea', `${w.events}/${w.leaEvent.id}`, { title: 'Lea’s own' }), 'a lead editing their own event');
  denied(await patch('lea', `${w.events}/${w.event.id}`, { title: 'Hijacked' }), 'a lead editing an admin’s event');
  denied(await patch('lea', `${w.events}/${w.leaEvent.id}`, { createdBy: 'owner' }), 'a lead rewriting who created their event');
  denied(await patch('ana', `${w.events}/${w.event.id}`, { title: 'Hijacked' }), 'a member editing an event');
  ok(await patch('owner', `${w.events}/${w.event.id}`, { deleted: true }), 'an admin marking an event deleted');
});
