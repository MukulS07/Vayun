// The checks every team backend must pass. test/team-store.test.js runs them against the in-memory
// reference and against the Firestore version (talking to a fake Firestore); test-rules/rules.test.js runs
// the same checks against Google's emulator with the real security rules.
const test = require('node:test');
const assert = require('node:assert');

const USERS = {
  owner: { uid: 'owner', name: 'Owen', email: 'owen@example.com' },
  lea: { uid: 'lea', name: 'Lea', email: 'lea@example.com' },
  ana: { uid: 'ana', name: 'Ana', email: 'ana@example.com' },
  raj: { uid: 'raj', name: 'Raj', email: 'raj@example.com' },
  eve: { uid: 'eve', name: 'Eve', email: 'eve@example.com' },
};
const rejectsWith = (p, code) => assert.rejects(p, e => e.code === code, `expected a ${code} error`);

module.exports = function runContract(name, makeServer) {
  // A team: Owen created it (owner, admin), Lea is a lead, Ana and Raj are members, Eve is an outsider.
  async function setup() {
    const server = await makeServer();
    const s = Object.fromEntries(Object.entries(USERS).map(([k, u]) => [k, server.storeFor(u)]));
    const team = await s.owner.createTeam('Design');
    await s.lea.joinTeam(team.inviteCode);
    await s.ana.joinTeam(team.inviteCode);
    await s.raj.joinTeam(team.inviteCode);
    await s.owner.setRole(team.id, 'lea', 'lead');
    return { s, team };
  }
  const due = '2026-11-05';

  test(`${name}: the creator becomes the owner and admin, and people join with the code`, async () => {
    const { s, team } = await setup();
    assert.strictEqual(team.name, 'Design');
    assert.deepStrictEqual([team.ownerUid, team.members.owner.role], ['owner', 'admin']);
    assert.match(team.inviteCode, /^[A-HJ-NP-Z2-9]{8}$/);
    const joined = await s.ana.getTeam(team.id);
    assert.deepStrictEqual([...joined.memberIds].sort(), ['ana', 'lea', 'owner', 'raj']);
    assert.deepStrictEqual([joined.members.ana.role, joined.members.lea.role, joined.members.ana.name], ['member', 'lead', 'Ana']);
    assert.strictEqual((await s.ana.myTeams()).length, 1);
    assert.strictEqual((await s.eve.myTeams()).length, 0);
  });

  test(`${name}: joining checks the code, and joining twice changes nothing`, async () => {
    const { s, team } = await setup();
    await rejectsWith(s.eve.joinTeam('nope'), 'invalid');
    await rejectsWith(s.eve.joinTeam('ABCDEFGH'), 'not-found');
    const again = await s.ana.joinTeam(team.inviteCode.toLowerCase().replace(/(....)(....)/, '$1-$2'));
    assert.strictEqual(again.memberIds.filter(u => u === 'ana').length, 1);
    assert.strictEqual(again.members.ana.role, 'member', 'joining again never changes a role');
  });

  test(`${name}: outsiders cannot read a team`, async () => {
    const { s, team } = await setup();
    await rejectsWith(s.eve.getTeam(team.id), 'forbidden');
    await rejectsWith(s.eve.changes(team.id), 'forbidden');
  });

  test(`${name}: admins and leads give tasks; members cannot; everyone sees them`, async () => {
    const { s, team } = await setup();
    const task = await s.owner.createTask(team.id, { title: 'Draw the logo', assigneeUid: 'ana', priority: 'high', dueDate: due, mustDo: true });
    assert.deepStrictEqual([task.status, task.createdBy, task.mustDo], ['todo', 'owner', true]);
    const led = await s.lea.createTask(team.id, { title: 'Write copy', assigneeUid: 'raj' });
    assert.deepStrictEqual([led.createdBy, led.mustDo], ['lea', false]);
    const seen = await s.ana.changes(team.id);
    assert.deepStrictEqual(seen.tasks.map(t => t.title).sort(), ['Draw the logo', 'Write copy']);
    assert.ok(seen.cursors.tasks);
    await rejectsWith(s.ana.createTask(team.id, { title: 'Sneaky', assigneeUid: 'raj' }), 'forbidden');
    await rejectsWith(s.eve.createTask(team.id, { title: 'Sneaky', assigneeUid: 'raj' }), 'forbidden');
    await rejectsWith(s.owner.createTask(team.id, { title: 'x', assigneeUid: 'eve' }), 'invalid');
    await rejectsWith(s.lea.createTask(team.id, { title: '', assigneeUid: 'ana' }), 'invalid');
  });

  test(`${name}: the assignee changes only the status; an admin changes anything`, async () => {
    const { s, team } = await setup();
    const task = await s.owner.createTask(team.id, { title: 'Draw the logo', assigneeUid: 'ana' });
    assert.strictEqual((await s.ana.updateTask(team.id, task.id, { status: 'doing' })).status, 'doing');
    await rejectsWith(s.ana.updateTask(team.id, task.id, { title: 'Mine now' }), 'forbidden');
    await rejectsWith(s.ana.updateTask(team.id, task.id, { mustDo: true }), 'forbidden');
    await rejectsWith(s.ana.updateTask(team.id, task.id, { status: 'doing', priority: 'low' }), 'forbidden');
    await rejectsWith(s.raj.updateTask(team.id, task.id, { status: 'done' }), 'forbidden');
    const moved = await s.owner.updateTask(team.id, task.id, { assigneeUid: 'raj', priority: 'low', mustDo: true });
    assert.deepStrictEqual([moved.assigneeUid, moved.priority, moved.status, moved.mustDo], ['raj', 'low', 'doing', true]);
    assert.strictEqual((await s.raj.updateTask(team.id, task.id, { status: 'done' })).status, 'done');
    await rejectsWith(s.ana.updateTask(team.id, task.id, { status: 'todo' }), 'forbidden'); // no longer theirs
  });

  test(`${name}: a lead edits only the tasks they created`, async () => {
    const { s, team } = await setup();
    const mine = await s.lea.createTask(team.id, { title: 'Lea’s task', assigneeUid: 'ana' });
    const admins = await s.owner.createTask(team.id, { title: 'Owen’s task', assigneeUid: 'ana' });
    const edited = await s.lea.updateTask(team.id, mine.id, { title: 'Better', assigneeUid: 'raj', mustDo: true });
    assert.deepStrictEqual([edited.title, edited.assigneeUid, edited.mustDo], ['Better', 'raj', true]);
    await rejectsWith(s.lea.updateTask(team.id, admins.id, { title: 'Mine now' }), 'forbidden');
    await rejectsWith(s.lea.updateTask(team.id, admins.id, { mustDo: true }), 'forbidden');
    const toLead = await s.owner.createTask(team.id, { title: 'For Lea', assigneeUid: 'lea' });
    assert.strictEqual((await s.lea.updateTask(team.id, toLead.id, { status: 'doing' })).status, 'doing', 'a lead still updates the status of a task given to them');
    await rejectsWith(s.lea.updateTask(team.id, toLead.id, { priority: 'low' }), 'forbidden');
    assert.strictEqual((await s.owner.updateTask(team.id, mine.id, { priority: 'low' })).priority, 'low', 'an admin edits a lead’s task');
    assert.strictEqual((await s.lea.updateTask(team.id, mine.id, { deleted: true })).deleted, true);
  });

  test(`${name}: later checks return what changed, including deletions; a first load skips deleted tasks`, async () => {
    const { s, team } = await setup();
    const a = await s.owner.createTask(team.id, { title: 'A', assigneeUid: 'ana' });
    const first = await s.ana.changes(team.id);
    const b = await s.owner.createTask(team.id, { title: 'B', assigneeUid: 'ana' });
    await s.ana.updateTask(team.id, a.id, { status: 'done' });
    const next = await s.ana.changes(team.id, first.cursors);
    assert.deepStrictEqual(next.tasks.map(t => t.title).sort(), ['A', 'B']);
    assert.strictEqual(next.tasks.find(t => t.title === 'A').status, 'done');
    assert.ok(next.cursors.tasks >= first.cursors.tasks);
    await s.owner.updateTask(team.id, b.id, { deleted: true });
    const afterDelete = await s.ana.changes(team.id, next.cursors);
    assert.strictEqual(afterDelete.tasks.find(t => t.title === 'B').deleted, true);
    assert.deepStrictEqual((await s.raj.changes(team.id)).tasks.map(t => t.title), ['A']);
  });

  test(`${name}: events can be left out of a check without losing them later`, async () => {
    const { s, team } = await setup();
    const first = await s.ana.changes(team.id);
    await s.owner.createEvent(team.id, { title: 'Standup', startDate: '2026-11-02', allDay: true });
    await s.owner.createTask(team.id, { title: 'A', assigneeUid: 'ana' });
    const tasksOnly = await s.ana.changes(team.id, first.cursors, { events: false });
    assert.deepStrictEqual([tasksOnly.tasks.length, tasksOnly.events.length], [1, 0]);
    assert.strictEqual(tasksOnly.cursors.events, first.cursors.events);
    const later = await s.ana.changes(team.id, tasksOnly.cursors);
    assert.deepStrictEqual(later.events.map(e => e.title), ['Standup']);
  });

  test(`${name}: admins and leads add team events; a lead changes only their own; members cannot`, async () => {
    const { s, team } = await setup();
    const input = (o = {}) => ({ title: 'Standup', startDate: '2026-11-02', allDay: false, startTime: '10:00', endTime: '10:15', ...o });
    const adminEvent = await s.owner.createEvent(team.id, input());
    const leadEvent = await s.lea.createEvent(team.id, input({ title: 'Lea’s sync' }));
    assert.deepStrictEqual([adminEvent.createdBy, leadEvent.createdBy, leadEvent.startTime], ['owner', 'lea', '10:00']);
    assert.deepStrictEqual((await s.ana.changes(team.id)).events.map(e => e.title).sort(), ['Lea’s sync', 'Standup']);
    await rejectsWith(s.ana.createEvent(team.id, input()), 'forbidden');
    await rejectsWith(s.ana.updateEvent(team.id, adminEvent.id, input({ title: 'Changed' })), 'forbidden');
    await rejectsWith(s.owner.createEvent(team.id, input({ title: '' })), 'invalid');
    assert.strictEqual((await s.lea.updateEvent(team.id, leadEvent.id, input({ title: 'Lea’s sync', startTime: '11:00', endTime: '11:15' }))).startTime, '11:00');
    await rejectsWith(s.lea.updateEvent(team.id, adminEvent.id, input({ title: 'Hijacked' })), 'forbidden');
    await rejectsWith(s.lea.deleteEvent(team.id, adminEvent.id), 'forbidden');
    assert.strictEqual((await s.owner.updateEvent(team.id, leadEvent.id, input({ title: 'Owen moved it' }))).title, 'Owen moved it', 'an admin changes any');
    await rejectsWith(s.ana.deleteEvent(team.id, adminEvent.id), 'forbidden');
    assert.strictEqual((await s.lea.deleteEvent(team.id, leadEvent.id)).deleted, true);
    assert.strictEqual((await s.owner.deleteEvent(team.id, adminEvent.id)).deleted, true);
    assert.deepStrictEqual((await s.raj.changes(team.id)).events, []);
  });

  test(`${name}: only admins make a new invite code`, async () => {
    const { s, team } = await setup();
    await rejectsWith(s.ana.rotateInvite(team.id), 'forbidden');
    await rejectsWith(s.lea.rotateInvite(team.id), 'forbidden');
    const rotated = await s.owner.rotateInvite(team.id);
    assert.notStrictEqual(rotated.inviteCode, team.inviteCode);
    await rejectsWith(s.eve.joinTeam(team.inviteCode), 'not-found');
    const joined = await s.eve.joinTeam(rotated.inviteCode);
    assert.ok(joined.memberIds.includes('eve'));
  });

  test(`${name}: admins change roles, and a new role gives the matching powers`, async () => {
    const { s, team } = await setup();
    await rejectsWith(s.ana.createTask(team.id, { title: 'x', assigneeUid: 'raj' }), 'forbidden');
    const promoted = await s.owner.setRole(team.id, 'ana', 'lead');
    assert.strictEqual(promoted.members.ana.role, 'lead');
    assert.strictEqual((await s.ana.createTask(team.id, { title: 'Now a lead', assigneeUid: 'raj' })).createdBy, 'ana');
    await s.owner.setRole(team.id, 'ana', 'admin');
    assert.strictEqual((await s.ana.rotateInvite(team.id)).members.ana.role, 'admin', 'a second admin can do admin things');
    await s.ana.setRole(team.id, 'lea', 'member');
    await rejectsWith(s.lea.createTask(team.id, { title: 'x', assigneeUid: 'raj' }), 'forbidden');
    await s.owner.setRole(team.id, 'ana', 'member');
    await rejectsWith(s.ana.rotateInvite(team.id), 'forbidden');
  });

  test(`${name}: only admins change roles or remove people, and the owner is untouchable`, async () => {
    const { s, team } = await setup();
    await rejectsWith(s.lea.setRole(team.id, 'ana', 'lead'), 'forbidden');
    await rejectsWith(s.ana.setRole(team.id, 'ana', 'admin'), 'forbidden');
    await rejectsWith(s.owner.setRole(team.id, 'ana', 'boss'), 'invalid');
    await rejectsWith(s.owner.setRole(team.id, 'eve', 'lead'), 'not-found');
    await s.owner.setRole(team.id, 'raj', 'admin');
    await rejectsWith(s.raj.setRole(team.id, 'owner', 'member'), 'forbidden');
    await rejectsWith(s.raj.removeMember(team.id, 'owner'), 'forbidden');
    await rejectsWith(s.lea.removeMember(team.id, 'ana'), 'forbidden');
    await rejectsWith(s.owner.leaveTeam(team.id), 'forbidden');
    const after = await s.raj.removeMember(team.id, 'ana');
    assert.deepStrictEqual([...after.memberIds].sort(), ['lea', 'owner', 'raj']);
    assert.strictEqual(after.members.ana, undefined);
    await rejectsWith(s.ana.changes(team.id), 'forbidden');
    await s.raj.leaveTeam(team.id); // a second admin may leave
    await rejectsWith(s.raj.getTeam(team.id), 'forbidden');
  });

  test(`${name}: members can leave and rejoin`, async () => {
    const { s, team } = await setup();
    await s.ana.leaveTeam(team.id);
    await rejectsWith(s.ana.getTeam(team.id), 'forbidden');
    const back = await s.ana.joinTeam(team.inviteCode);
    assert.strictEqual(back.members.ana.role, 'member');
  });

  test(`${name}: after someone is removed, their tasks can still be tidied up`, async () => {
    const { s, team } = await setup();
    const a = await s.owner.createTask(team.id, { title: 'Raj’s task', assigneeUid: 'raj' });
    const b = await s.lea.createTask(team.id, { title: 'Another', assigneeUid: 'raj' });
    await s.owner.removeMember(team.id, 'raj');
    assert.strictEqual((await s.owner.updateTask(team.id, a.id, { priority: 'high' })).priority, 'high');
    assert.strictEqual((await s.owner.updateTask(team.id, a.id, { deleted: true })).deleted, true);
    await rejectsWith(s.lea.updateTask(team.id, b.id, { assigneeUid: 'eve' }), 'invalid');
    assert.strictEqual((await s.lea.updateTask(team.id, b.id, { assigneeUid: 'ana' })).assigneeUid, 'ana');
    await rejectsWith(s.owner.createTask(team.id, { title: 'New', assigneeUid: 'raj' }), 'invalid');
  });
};
