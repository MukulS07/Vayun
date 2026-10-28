const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMemoryServer } = require('../team-store-memory');
const { createTeamService } = require('../team-service');
const { TeamError } = require('../team-error');

const USERS = {
  head: { uid: 'head', displayName: 'Mukul', email: 'mukul@example.com' },
  ana: { uid: 'ana', displayName: 'Ana', email: 'ana@example.com' },
};

// One person's copy of Vayun: own folder, own service, same shared server.
function person(server, key, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vayun-team-'));
  const ctx = { user: USERS[key], notes: [], dir, ticks: [], active: true, canSync: true };
  ctx.svc = createTeamService({
    dir,
    getUser: () => ctx.user,
    canSync: () => ctx.canSync,
    makeStore: me => server.storeFor(me),
    notify: s => ctx.notes.push(s),
    isActive: () => ctx.active,
    setTimer: fn => { ctx.ticks.push(fn); return { unref() {} }; },
    clearTimer: () => { ctx.ticks = []; },
    ...extra,
  });
  return ctx;
}

async function twoPeople() {
  const server = createMemoryServer();
  const head = person(server, 'head'), ana = person(server, 'ana');
  const made = await head.svc.createTeam('Design');
  assert.ok(made.ok, made.error);
  const joined = await ana.svc.joinTeam(made.state.team.inviteCode);
  assert.ok(joined.ok, joined.error);
  return { server, head, ana, made };
}

test('the creator of a team is its admin and a member who joins sees their own role', async () => {
  const { head, ana } = await twoPeople();
  assert.strictEqual(head.svc.state().role, 'admin');
  assert.strictEqual(ana.svc.state().role, 'member');
  assert.strictEqual(ana.svc.state().team.name, 'Design');
  assert.deepStrictEqual(head.svc.state().teams.map(t => t.name), ['Design']);
});

test('a task the head assigns reaches the other person on their next check', async () => {
  const { head, ana } = await twoPeople();
  const r = await head.svc.createTask({ title: 'Draw the logo', assigneeUid: 'ana', dueDate: '2026-11-05' });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(head.svc.state().tasks.map(t => t.title), ['Draw the logo']);
  assert.deepStrictEqual(ana.svc.state().tasks, [], 'not there until Ana checks');
  assert.ok((await ana.svc.refresh()).ok);
  assert.deepStrictEqual(ana.svc.state().tasks.map(t => [t.title, t.assigneeUid]), [['Draw the logo', 'ana']]);
  const id = ana.svc.state().tasks[0].id;
  assert.ok((await ana.svc.updateTask(id, { status: 'doing' })).ok);
  await head.svc.refresh();
  assert.strictEqual(head.svc.state().tasks[0].status, 'doing');
});

test('actions that are not allowed come back as an error and change nothing', async () => {
  const { head, ana } = await twoPeople();
  const denied = await ana.svc.createTask({ title: 'Sneaky', assigneeUid: 'ana' });
  assert.strictEqual(denied.code, 'forbidden');
  assert.match(denied.error, /admins and leads/i);
  assert.deepStrictEqual(ana.svc.state().tasks, []);
  assert.strictEqual(ana.svc.state().error.code, 'forbidden');
  const bad = await head.svc.createTask({ title: '', assigneeUid: 'ana' });
  assert.strictEqual(bad.code, 'invalid');
  assert.ok((await head.svc.createTask({ title: 'Fine', assigneeUid: 'ana' })).ok);
  assert.strictEqual(head.svc.state().error, null, 'a later success clears the error');
});

test('deleted tasks disappear for everyone after their next check', async () => {
  const { head, ana } = await twoPeople();
  await head.svc.createTask({ title: 'Keep', assigneeUid: 'ana' });
  await head.svc.createTask({ title: 'Remove', assigneeUid: 'ana' });
  await ana.svc.refresh();
  assert.strictEqual(ana.svc.state().tasks.length, 2);
  const id = head.svc.state().tasks.find(t => t.title === 'Remove').id;
  await head.svc.updateTask(id, { deleted: true });
  assert.deepStrictEqual(head.svc.state().tasks.map(t => t.title), ['Keep']);
  await ana.svc.refresh();
  assert.deepStrictEqual(ana.svc.state().tasks.map(t => t.title), ['Keep']);
});

test('team events reach members, and only on the every-third-check schedule unless asked for', async () => {
  const { head, ana } = await twoPeople();
  await head.svc.createEvent({ title: 'Standup', startDate: '2026-11-02', allDay: true });
  ana.ticks[0]?.();
  await ana.svc.refresh({ full: true });
  assert.deepStrictEqual(ana.svc.state().events.map(e => e.title), ['Standup']);
  await head.svc.createEvent({ title: 'Retro', startDate: '2026-11-03', allDay: true });
  await ana.svc.refresh(); // polls = 0 -> events included on the first check of each three
  assert.strictEqual(ana.svc.state().events.length, 2);
});

test('the local copy is kept, so the page opens with data before any check', async () => {
  const { head, ana } = await twoPeople();
  await head.svc.createTask({ title: 'Cached', assigneeUid: 'ana' });
  await ana.svc.refresh();
  ana.svc.flush();
  const reopened = createTeamService({ dir: ana.dir, getUser: () => ana.user, makeStore: () => { throw new Error('offline'); } });
  assert.deepStrictEqual(reopened.state().tasks.map(t => t.title), ['Cached']);
  assert.strictEqual(reopened.state().role, 'member');
});

test('a failed check keeps what is already shown and reports the problem', async () => {
  const { head, ana } = await twoPeople();
  await head.svc.createTask({ title: 'Stays', assigneeUid: 'ana' });
  await ana.svc.refresh();
  const flaky = createTeamService({
    dir: ana.dir, getUser: () => ana.user, makeStore: () => ({ myTeams: async () => { throw new TeamError('Could not reach the team server.', 'network'); }, getTeam: async () => { throw new TeamError('Could not reach the team server.', 'network'); }, changes: async () => { throw new TeamError('Could not reach the team server.', 'network'); } }),
  });
  ana.svc.flush();
  const r = await flaky.refresh({ teams: true });
  assert.strictEqual(r.code, 'network');
  assert.deepStrictEqual(flaky.state().tasks.map(t => t.title), ['Stays']);
  assert.strictEqual(flaky.state().error.code, 'network');
});

test('a person who was removed from the team loses it locally', async () => {
  const { head, ana } = await twoPeople();
  await head.svc.removeMember('ana');
  const r = await ana.svc.refresh({ full: true });
  assert.strictEqual(r.code, 'forbidden');
  assert.deepStrictEqual(ana.svc.state().teams, []);
  assert.strictEqual(ana.svc.state().team, null);
});

test('another person on the same PC never sees the first one’s data, and signing out forgets it', async () => {
  const { head } = await twoPeople();
  await head.svc.createTask({ title: 'Private', assigneeUid: 'ana' });
  head.user = USERS.ana;
  assert.deepStrictEqual(head.svc.state().tasks, [], 'Ana on the same PC starts empty');
  head.user = USERS.head;
  assert.strictEqual(head.svc.state().tasks.length, 1, 'the head’s copy is still there for the head');
  head.svc.forget('head');
  assert.strictEqual(head.svc.state().signedIn, true, 'getUser still returns someone in this test');
  head.user = null;
  assert.strictEqual(head.svc.state().signedIn, false);
  head.user = USERS.head;
  assert.deepStrictEqual(head.svc.state().tasks, [], 'forgotten after sign-out');
});

test('without a team or a long sign-in, actions explain what to do', async () => {
  const server = createMemoryServer();
  const p = person(server, 'head');
  assert.strictEqual((await p.svc.createTask({ title: 'x', assigneeUid: 'head' })).error, 'Join or create a team first.');
  p.canSync = false;
  assert.strictEqual((await p.svc.createTeam('X')).code, 'auth');
  assert.strictEqual(p.svc.state().canSync, false);
  p.canSync = true; p.user = null;
  assert.strictEqual((await p.svc.createTeam('X')).code, 'auth');
});

test('the schedule checks only while the window is in use and a team is open', async () => {
  const { head, ana } = await twoPeople();
  ana.svc.start();
  assert.strictEqual(ana.ticks.length, 1);
  await head.svc.createTask({ title: 'Later', assigneeUid: 'ana' });
  ana.active = false;
  ana.ticks[0]();
  await new Promise(r => setImmediate(r));
  assert.deepStrictEqual(ana.svc.state().tasks, [], 'not focused: no check');
  ana.active = true;
  ana.ticks[0]();
  await new Promise(r => setTimeout(r, 20));
  assert.deepStrictEqual(ana.svc.state().tasks.map(t => t.title), ['Later']);
  ana.svc.stop();
  assert.strictEqual(ana.ticks.length, 0);
});

test('the window is told after every change', async () => {
  const { head } = await twoPeople();
  const before = head.notes.length;
  await head.svc.createTask({ title: 'Ping', assigneeUid: 'head' });
  assert.ok(head.notes.length > before);
  assert.strictEqual(head.notes[head.notes.length - 1].tasks[0].title, 'Ping');
});

test('an admin changes a role: the person sees it on their next full check and gets the matching powers', async () => {
  const { head, ana } = await twoPeople();
  assert.strictEqual((await ana.svc.createTask({ title: 'x', assigneeUid: 'ana' })).code, 'forbidden');
  const r = await head.svc.setRole('ana', 'lead');
  assert.ok(r.ok, r.error);
  assert.strictEqual(head.svc.state().team.members.ana.role, 'lead');
  assert.strictEqual(ana.svc.state().role, 'member', 'not yet: Ana has not checked');
  await ana.svc.refresh({ full: true });
  assert.strictEqual(ana.svc.state().role, 'lead');
  assert.ok((await ana.svc.createTask({ title: 'Now allowed', assigneeUid: 'head' })).ok);
  assert.strictEqual((await ana.svc.setRole('head', 'member')).code, 'forbidden', 'a lead cannot change roles');
  assert.strictEqual((await head.svc.setRole('ana', 'boss')).code, 'invalid');
});

test('a lead can change only the team events they made', async () => {
  const { head, ana } = await twoPeople();
  await head.svc.setRole('ana', 'lead');
  await ana.svc.refresh({ full: true });
  await head.svc.createEvent({ title: 'Admin event', startDate: '2026-11-02', allDay: true });
  assert.ok((await ana.svc.createEvent({ title: 'Lead event', startDate: '2026-11-03', allDay: true })).ok);
  await ana.svc.refresh({ full: true });
  const byTitle = t => ana.svc.state().events.find(e => e.title === t);
  assert.ok((await ana.svc.updateEvent(byTitle('Lead event').id, { title: 'Lead event', startDate: '2026-11-04', allDay: true })).ok);
  assert.strictEqual((await ana.svc.updateEvent(byTitle('Admin event').id, { title: 'Hijacked', startDate: '2026-11-02', allDay: true })).code, 'forbidden');
  assert.strictEqual((await ana.svc.deleteEvent(byTitle('Admin event').id)).code, 'forbidden');
  assert.ok((await ana.svc.deleteEvent(byTitle('Lead event').id)).ok);
});
