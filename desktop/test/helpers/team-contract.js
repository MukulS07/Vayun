// The checks every team backend must pass. test/team-store.test.js runs them against the in-memory
// reference and against the Firestore version (talking to a fake Firestore).
const test = require('node:test');
const assert = require('node:assert');

const USERS = {
  head: { uid: 'head', name: 'Mukul', email: 'mukul@example.com' },
  ana: { uid: 'ana', name: 'Ana', email: 'ana@example.com' },
  raj: { uid: 'raj', name: 'Raj', email: 'raj@example.com' },
  eve: { uid: 'eve', name: 'Eve', email: 'eve@example.com' },
};
const rejectsWith = (p, code) => assert.rejects(p, e => e.code === code, `expected a ${code} error`);

module.exports = function runContract(name, makeServer) {
  // A team with a head (Mukul), two members (Ana, Raj) and an outsider (Eve).
  async function setup() {
    const server = await makeServer();
    const s = Object.fromEntries(Object.entries(USERS).map(([k, u]) => [k, server.storeFor(u)]));
    const team = await s.head.createTeam('Design');
    await s.ana.joinTeam(team.inviteCode);
    await s.raj.joinTeam(team.inviteCode);
    return { s, team };
  }
  const due = '2026-11-05';

  test(`${name}: a head creates a team and people join with its code`, async () => {
    const { s, team } = await setup();
    assert.strictEqual(team.name, 'Design');
    assert.strictEqual(team.members.head.role, 'head');
    assert.match(team.inviteCode, /^[A-HJ-NP-Z2-9]{8}$/);
    const joined = await s.ana.getTeam(team.id);
    assert.deepStrictEqual([...joined.memberIds].sort(), ['ana', 'head', 'raj']);
    assert.strictEqual(joined.members.ana.role, 'member');
    assert.strictEqual(joined.members.ana.name, 'Ana');
    assert.strictEqual((await s.ana.myTeams()).length, 1);
    assert.strictEqual((await s.eve.myTeams()).length, 0);
  });

  test(`${name}: joining checks the code, and joining twice changes nothing`, async () => {
    const { s, team } = await setup();
    await rejectsWith(s.eve.joinTeam('nope'), 'invalid');
    await rejectsWith(s.eve.joinTeam('ABCDEFGH'), 'not-found');
    const again = await s.ana.joinTeam(team.inviteCode.toLowerCase().replace(/(....)(....)/, '$1-$2'));
    assert.strictEqual(again.memberIds.filter(u => u === 'ana').length, 1);
  });

  test(`${name}: outsiders cannot read a team`, async () => {
    const { s, team } = await setup();
    await rejectsWith(s.eve.getTeam(team.id), 'forbidden');
    await rejectsWith(s.eve.changes(team.id), 'forbidden');
  });

  test(`${name}: the head gives a task to a person and it shows up for them`, async () => {
    const { s, team } = await setup();
    const task = await s.head.createTask(team.id, { title: 'Draw the logo', assigneeUid: 'ana', priority: 'high', dueDate: due });
    assert.strictEqual(task.status, 'todo');
    assert.strictEqual(task.createdBy, 'head');
    const seen = await s.ana.changes(team.id);
    assert.deepStrictEqual(seen.tasks.map(t => [t.title, t.assigneeUid, t.priority, t.dueDate]), [['Draw the logo', 'ana', 'high', due]]);
    assert.ok(seen.cursors.tasks);
    await rejectsWith(s.ana.createTask(team.id, { title: 'Sneaky', assigneeUid: 'raj' }), 'forbidden');
    await rejectsWith(s.head.createTask(team.id, { title: 'x', assigneeUid: 'eve' }), 'invalid');
    await rejectsWith(s.head.createTask(team.id, { title: '', assigneeUid: 'ana' }), 'invalid');
  });

  test(`${name}: the assignee changes only the status; the head changes anything`, async () => {
    const { s, team } = await setup();
    const task = await s.head.createTask(team.id, { title: 'Draw the logo', assigneeUid: 'ana' });
    const doing = await s.ana.updateTask(team.id, task.id, { status: 'doing' });
    assert.strictEqual(doing.status, 'doing');
    await rejectsWith(s.ana.updateTask(team.id, task.id, { title: 'Mine now' }), 'forbidden');
    await rejectsWith(s.ana.updateTask(team.id, task.id, { status: 'doing', priority: 'low' }), 'forbidden');
    await rejectsWith(s.raj.updateTask(team.id, task.id, { status: 'done' }), 'forbidden');
    const moved = await s.head.updateTask(team.id, task.id, { assigneeUid: 'raj', priority: 'low' });
    assert.deepStrictEqual([moved.assigneeUid, moved.priority, moved.status], ['raj', 'low', 'doing']);
    assert.strictEqual((await s.raj.updateTask(team.id, task.id, { status: 'done' })).status, 'done');
    await rejectsWith(s.ana.updateTask(team.id, task.id, { status: 'todo' }), 'forbidden'); // no longer theirs
  });

  test(`${name}: later checks return what changed, including deletions; a first load skips deleted tasks`, async () => {
    const { s, team } = await setup();
    const a = await s.head.createTask(team.id, { title: 'A', assigneeUid: 'ana' });
    const first = await s.ana.changes(team.id);
    const b = await s.head.createTask(team.id, { title: 'B', assigneeUid: 'ana' });
    await s.ana.updateTask(team.id, a.id, { status: 'done' });
    const next = await s.ana.changes(team.id, first.cursors);
    assert.deepStrictEqual(next.tasks.map(t => t.title).sort(), ['A', 'B']);
    assert.strictEqual(next.tasks.find(t => t.title === 'A').status, 'done');
    assert.ok(next.cursors.tasks >= first.cursors.tasks);
    await s.head.updateTask(team.id, b.id, { deleted: true });
    const afterDelete = await s.ana.changes(team.id, next.cursors);
    assert.strictEqual(afterDelete.tasks.find(t => t.title === 'B').deleted, true);
    assert.deepStrictEqual((await s.raj.changes(team.id)).tasks.map(t => t.title), ['A']);
  });

  test(`${name}: events can be left out of a check without losing them later`, async () => {
    const { s, team } = await setup();
    const first = await s.ana.changes(team.id);
    await s.head.createEvent(team.id, { title: 'Standup', startDate: '2026-11-02', allDay: true });
    await s.head.createTask(team.id, { title: 'A', assigneeUid: 'ana' });
    const tasksOnly = await s.ana.changes(team.id, first.cursors, { events: false });
    assert.deepStrictEqual([tasksOnly.tasks.length, tasksOnly.events.length], [1, 0]);
    assert.strictEqual(tasksOnly.cursors.events, first.cursors.events);
    const later = await s.ana.changes(team.id, tasksOnly.cursors);
    assert.deepStrictEqual(later.events.map(e => e.title), ['Standup']);
  });

  test(`${name}: the head adds team events and everyone sees them`, async () => {
    const { s, team } = await setup();
    const ev = await s.head.createEvent(team.id, { title: 'Standup', startDate: '2026-11-02', allDay: false, startTime: '10:00', endTime: '10:15' });
    assert.deepStrictEqual([ev.title, ev.startTime, ev.createdBy], ['Standup', '10:00', 'head']);
    assert.deepStrictEqual((await s.ana.changes(team.id)).events.map(e => e.title), ['Standup']);
    await rejectsWith(s.ana.createEvent(team.id, { title: 'Mine', startDate: '2026-11-03', allDay: true }), 'forbidden');
    await rejectsWith(s.ana.updateEvent(team.id, ev.id, { title: 'Changed', startDate: '2026-11-03', allDay: true }), 'forbidden');
    await rejectsWith(s.head.createEvent(team.id, { title: '', startDate: '2026-11-03', allDay: true }), 'invalid');
    const moved = await s.head.updateEvent(team.id, ev.id, { title: 'Standup', startDate: '2026-11-02', allDay: false, startTime: '11:00', endTime: '11:15' });
    assert.strictEqual(moved.startTime, '11:00');
    await rejectsWith(s.ana.deleteEvent(team.id, ev.id), 'forbidden');
    assert.strictEqual((await s.head.deleteEvent(team.id, ev.id)).deleted, true);
    assert.deepStrictEqual((await s.raj.changes(team.id)).events, []);
  });

  test(`${name}: a new invite code replaces the old one`, async () => {
    const { s, team } = await setup();
    await rejectsWith(s.ana.rotateInvite(team.id), 'forbidden');
    const rotated = await s.head.rotateInvite(team.id);
    assert.notStrictEqual(rotated.inviteCode, team.inviteCode);
    await rejectsWith(s.eve.joinTeam(team.inviteCode), 'not-found');
    const joined = await s.eve.joinTeam(rotated.inviteCode);
    assert.ok(joined.memberIds.includes('eve'));
  });

  test(`${name}: members can leave, the head can remove people, the head cannot leave`, async () => {
    const { s, team } = await setup();
    await s.ana.leaveTeam(team.id);
    await rejectsWith(s.ana.getTeam(team.id), 'forbidden');
    await rejectsWith(s.head.leaveTeam(team.id), 'forbidden');
    await rejectsWith(s.raj.removeMember(team.id, 'head'), 'forbidden');
    await rejectsWith(s.head.removeMember(team.id, 'head'), 'forbidden');
    const after = await s.head.removeMember(team.id, 'raj');
    assert.deepStrictEqual(after.memberIds, ['head']);
    assert.strictEqual(after.members.raj, undefined);
    await rejectsWith(s.raj.changes(team.id), 'forbidden');
  });
};
