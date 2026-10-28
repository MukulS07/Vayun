const test = require('node:test');
const assert = require('node:assert');
const T = require('../app/team-logic');

// Owen created the team (owner, admin). Dev is a second admin, Lea a lead, Ana and Raj members.
const team = {
  id: 't1', name: 'Design', ownerUid: 'owen', memberIds: ['owen', 'dev', 'lea', 'ana', 'raj'],
  members: {
    owen: { name: 'Owen', role: 'admin' }, dev: { name: 'Dev', role: 'admin' }, lea: { name: 'Lea', role: 'lead' },
    ana: { name: 'Ana', role: 'member' }, raj: { name: 'Raj', role: 'member' },
  },
};
const task = (id, o = {}) => ({ id, title: 'Task ' + id, notes: '', assigneeUid: 'ana', status: 'todo', priority: 'medium', dueDate: '', mustDo: false, createdBy: 'owen', deleted: false, ...o });

test('invite codes use the 32-symbol alphabet and normalise what people type', () => {
  const code = T.inviteCodeFrom(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 255]));
  assert.ok(T.isInviteCode(code), code);
  assert.strictEqual(code.length, 8);
  assert.strictEqual(T.normalizeInviteCode(' abcd-2345 '), 'ABCD2345');
  assert.ok(!T.isInviteCode('ABCD234I')); // I is not in the alphabet
  assert.ok(!T.isInviteCode('ABC'));
  for (const c of T.INVITE_ALPHABET) assert.ok(!'IO01'.includes(c));
});

test('roles: admin, lead, member, owner and outsiders', () => {
  assert.deepStrictEqual(['owen', 'dev', 'lea', 'ana', 'nobody'].map(u => T.roleOf(team, u)), ['admin', 'admin', 'lead', 'member', '']);
  assert.ok(T.isAdmin(team, 'dev') && !T.isAdmin(team, 'lea') && !T.isAdmin(team, 'ana'));
  assert.ok(T.isLead(team, 'lea') && !T.isLead(team, 'dev'));
  assert.deepStrictEqual(['owen', 'dev', 'lea', 'ana', 'nobody'].map(u => T.canLead(team, u)), [true, true, true, false, false]);
  assert.ok(T.isOwner(team, 'owen') && !T.isOwner(team, 'dev'));
  assert.ok(T.isMember(team, 'raj') && !T.isMember(team, 'nobody') && !T.isMember(null, 'x'));
  assert.strictEqual(T.roleOf({ ...team, members: { ...team.members, ana: { role: 'superuser' } } }, 'ana'), '', 'an unknown role gives no powers');
});

test('normalizeTaskInput validates title, assignee, status, priority, due date and must-do', () => {
  assert.ok(T.normalizeTaskInput({ title: ' ', assigneeUid: 'ana' }, team).error);
  assert.ok(T.normalizeTaskInput({ title: 'x', assigneeUid: 'stranger' }, team).error);
  assert.ok(T.normalizeTaskInput({ title: 'x', assigneeUid: 'ana', dueDate: '31/12' }, team).error);
  assert.deepStrictEqual(T.normalizeTaskInput({ title: ' Ship it ', assigneeUid: 'ana', status: 'bogus', priority: 'high', dueDate: '2026-11-02' }, team),
    { title: 'Ship it', notes: '', assigneeUid: 'ana', status: 'todo', priority: 'high', dueDate: '2026-11-02', mustDo: false });
  assert.strictEqual(T.normalizeTaskInput({ title: 'x', assigneeUid: 'ana', mustDo: true }, team).mustDo, true);
});

test('checkTaskPatch: an admin edits anything', () => {
  const t = task('1');
  assert.deepStrictEqual(T.checkTaskPatch(team, 'dev', t, { assigneeUid: 'raj', priority: 'high', mustDo: true }), { patch: { assigneeUid: 'raj', priority: 'high', mustDo: true } });
  assert.deepStrictEqual(T.checkTaskPatch(team, 'owen', t, { deleted: 1 }), { patch: { deleted: true } });
  assert.ok(T.checkTaskPatch(team, 'dev', t, { assigneeUid: 'stranger' }).error);
  assert.ok(T.checkTaskPatch(team, 'dev', t, { createdBy: 'ana' }).error);
  assert.ok(T.checkTaskPatch(team, 'dev', t, { title: '' }).error);
  assert.ok(T.checkTaskPatch(team, 'dev', t, {}).error);
});

test('checkTaskPatch: a lead edits only the tasks they created', () => {
  const mine = task('2', { createdBy: 'lea' });
  assert.deepStrictEqual(T.checkTaskPatch(team, 'lea', mine, { title: 'Better', assigneeUid: 'raj', mustDo: true }), { patch: { title: 'Better', assigneeUid: 'raj', mustDo: true } });
  assert.deepStrictEqual(T.checkTaskPatch(team, 'lea', mine, { deleted: true }), { patch: { deleted: true } });
  const adminsTask = task('3', { createdBy: 'owen' });
  assert.ok(T.checkTaskPatch(team, 'lea', adminsTask, { title: 'Mine now' }).error, 'not theirs');
  assert.ok(T.checkTaskPatch(team, 'lea', adminsTask, { mustDo: true }).error, 'a lead cannot flag an admin’s task');
  const givenToLead = task('4', { createdBy: 'owen', assigneeUid: 'lea' });
  assert.deepStrictEqual(T.checkTaskPatch(team, 'lea', givenToLead, { status: 'doing' }), { patch: { status: 'doing' } }, 'a lead can still update the status of a task given to them');
  assert.ok(T.checkTaskPatch(team, 'lea', givenToLead, { status: 'doing', priority: 'low' }).error);
});

test('checkTaskPatch: a member changes only the status of their own task; others change nothing', () => {
  const t = task('5');
  assert.deepStrictEqual(T.checkTaskPatch(team, 'ana', t, { status: 'doing' }), { patch: { status: 'doing' } });
  assert.ok(T.checkTaskPatch(team, 'ana', t, { status: 'doing', title: 'Mine now' }).error);
  assert.ok(T.checkTaskPatch(team, 'ana', t, { title: 'x' }).error);
  assert.ok(T.checkTaskPatch(team, 'ana', t, { mustDo: true }).error, 'a member cannot flag a task');
  assert.ok(T.checkTaskPatch(team, 'ana', t, { status: 'finished' }).error);
  assert.ok(T.checkTaskPatch(team, 'raj', t, { status: 'done' }).error, 'not their task');
  assert.ok(T.checkTaskPatch(team, 'stranger', t, { status: 'done' }).error);
});

test('a task whose person left the team can still be edited or deleted, but not handed to a stranger', () => {
  const orphan = task('9', { assigneeUid: 'gone' });
  assert.deepStrictEqual(T.checkTaskPatch(team, 'dev', orphan, { priority: 'high' }), { patch: { priority: 'high' } });
  assert.deepStrictEqual(T.checkTaskPatch(team, 'dev', orphan, { deleted: true }), { patch: { deleted: true } });
  assert.deepStrictEqual(T.checkTaskPatch(team, 'dev', orphan, { assigneeUid: 'raj' }), { patch: { assigneeUid: 'raj' } });
  assert.ok(T.checkTaskPatch(team, 'dev', orphan, { assigneeUid: 'stranger' }).error);
  assert.ok(T.normalizeTaskInput({ title: 'x', assigneeUid: 'gone' }, team).error, 'a new task still needs a current member');
  assert.strictEqual(T.nameOf(team, 'gone'), 'Former member');
});

test('team events: admins and leads add them; a lead changes only their own', () => {
  const input = { title: 'Standup', startDate: '2026-11-02', allDay: true };
  assert.strictEqual(T.normalizeTeamEventInput(input, team, 'dev').title, 'Standup');
  assert.strictEqual(T.normalizeTeamEventInput(input, team, 'lea').title, 'Standup');
  assert.ok(T.normalizeTeamEventInput(input, team, 'ana').error);
  assert.ok(T.normalizeTeamEventInput(input, team, 'stranger').error);
  assert.strictEqual(T.normalizeTeamEventInput(input, team, 'lea', { createdBy: 'lea' }).title, 'Standup');
  assert.ok(T.normalizeTeamEventInput(input, team, 'lea', { createdBy: 'owen' }).error, 'a lead cannot change an admin’s event');
  assert.strictEqual(T.normalizeTeamEventInput(input, team, 'dev', { createdBy: 'lea' }).title, 'Standup', 'an admin changes any');
  assert.ok(T.canEditEvent(team, 'dev', { createdBy: 'lea' }) && !T.canEditEvent(team, 'ana', { createdBy: 'ana' }));
});

test('roles and removal: admins only, and the owner is untouchable', () => {
  assert.deepStrictEqual(T.checkRoleChange(team, 'dev', 'ana', 'lead'), { ok: true });
  assert.deepStrictEqual(T.checkRoleChange(team, 'owen', 'lea', 'admin'), { ok: true });
  assert.ok(T.checkRoleChange(team, 'lea', 'ana', 'lead').error, 'a lead cannot change roles');
  assert.ok(T.checkRoleChange(team, 'ana', 'ana', 'admin').error, 'nobody promotes themselves');
  assert.ok(T.checkRoleChange(team, 'dev', 'owen', 'member').error, 'the owner stays an admin');
  assert.ok(T.checkRoleChange(team, 'dev', 'ana', 'boss').error);
  assert.ok(T.checkRoleChange(team, 'dev', 'stranger', 'lead').error);
  assert.deepStrictEqual(T.checkRemoveMember(team, 'dev', 'ana'), { ok: true });
  assert.ok(T.checkRemoveMember(team, 'lea', 'ana').error);
  assert.ok(T.checkRemoveMember(team, 'dev', 'owen').error);
  assert.ok(T.checkRemoveMember(team, 'dev', 'stranger').error);
});

test('filterTasks by person, status, text, hide done, overdue, must-do; deleted tasks never show', () => {
  const tasks = [task('1', { dueDate: '2026-10-01' }), task('2', { assigneeUid: 'raj', status: 'done', title: 'Budget' }), task('3', { deleted: true }), task('4', { notes: 'call the printer', mustDo: true })];
  assert.deepStrictEqual(T.filterTasks(tasks).map(t => t.id), ['1', '2', '4']);
  assert.deepStrictEqual(T.filterTasks(tasks, { assigneeUid: 'raj' }).map(t => t.id), ['2']);
  assert.deepStrictEqual(T.filterTasks(tasks, { hideDone: true }).map(t => t.id), ['1', '4']);
  assert.deepStrictEqual(T.filterTasks(tasks, { query: 'PRINTER' }).map(t => t.id), ['4']);
  assert.deepStrictEqual(T.filterTasks(tasks, { overdueOnly: true }, '2026-10-28').map(t => t.id), ['1']);
  assert.deepStrictEqual(T.filterTasks(tasks, { mustDoOnly: true }).map(t => t.id), ['4']);
});

test('important means must-do or high priority', () => {
  assert.ok(T.isImportant(task('a', { mustDo: true })) && T.isImportant(task('b', { priority: 'high' })) && !T.isImportant(task('c')));
});

test('sortTasks: due date with empty last, priority, status; ties fall back to due date, priority then title', () => {
  const tasks = [task('a', { dueDate: '2026-11-05' }), task('b'), task('c', { dueDate: '2026-11-01', priority: 'low' }), task('d', { dueDate: '2026-11-01', priority: 'high' })];
  assert.deepStrictEqual(T.sortTasks(tasks, 'due').map(t => t.id), ['d', 'c', 'a', 'b']);
  assert.deepStrictEqual(T.sortTasks(tasks, 'due', 'desc').map(t => t.id), ['a', 'd', 'c', 'b']); // empty still last
  assert.deepStrictEqual(T.sortTasks(tasks, 'priority').map(t => t.id)[0], 'd');
  const same = [task('late', { priority: 'high', dueDate: '2026-12-01' }), task('soon', { priority: 'high', dueDate: '2026-11-01' }), task('none', { priority: 'high' }), task('low', { priority: 'low', dueDate: '2026-10-01' })];
  assert.deepStrictEqual(T.sortTasks(same, 'priority').map(t => t.id), ['soon', 'late', 'none', 'low'], 'equal priority: soonest due first, undated last');
  const st = [task('x', { status: 'done' }), task('y', { status: 'todo' }), task('z', { status: 'doing' })];
  assert.deepStrictEqual(T.sortTasks(st, 'status').map(t => t.id), ['y', 'z', 'x']);
});

test('groupTasks by person lists every member (admins, then leads, then members); by status keeps the order', () => {
  const tasks = [task('1', { assigneeUid: 'ana' }), task('2', { assigneeUid: 'ana', status: 'done' })];
  const g = T.groupTasks(tasks, 'assignee', team);
  assert.deepStrictEqual(g.map(x => x.label), ['Dev', 'Owen', 'Lea', 'Ana', 'Raj']);
  assert.deepStrictEqual(g.map(x => x.tasks.length), [0, 0, 0, 2, 0]);
  assert.deepStrictEqual(T.groupTasks(tasks, 'status', team).map(x => [x.label, x.tasks.length]), [['To do', 1], ['Doing', 0], ['Done', 1]]);
  assert.strictEqual(T.groupTasks(tasks, 'none', team).length, 1);
});

test('calendar items: admins and leads see every dated task, members only their own; team events keep their times', () => {
  const tasks = [task('1', { dueDate: '2026-11-02' }), task('2', { assigneeUid: 'raj', dueDate: '2026-11-03' }), task('3'), task('4', { dueDate: '2026-11-04', deleted: true })];
  const events = [{ id: 'e1', title: 'Standup', startDate: '2026-11-02', allDay: false, startTime: '10:00', endTime: '10:15', createdBy: 'lea' }, { id: 'e2', title: 'Old', startDate: '2026-11-02', deleted: true }];
  assert.deepStrictEqual(T.calendarItems(tasks, events, team, 'owen').map(e => e.id), ['t:1', 't:2', 'e:e1']);
  assert.deepStrictEqual(T.calendarItems(tasks, events, team, 'lea').map(e => e.id), ['t:1', 't:2', 'e:e1']);
  assert.deepStrictEqual(T.calendarItems(tasks, events, team, 'ana').map(e => e.id), ['t:1', 'e:e1']);
  const ev = T.calendarItems(tasks, events, team, 'raj').find(e => e.id === 'e:e1');
  assert.deepStrictEqual([ev.startTime, ev.createdBy], ['10:00', 'lea']);
});

test('server timestamps compare by their fraction as text and can be shifted back', () => {
  assert.ok(T.cmpTs('2026-10-28T10:00:00.5Z', '2026-10-28T10:00:00.45Z') > 0);
  assert.ok(T.cmpTs('2026-10-28T10:00:00.123456Z', '2026-10-28T10:00:00.123457Z') < 0);
  assert.ok(T.cmpTs('2026-10-28T10:00:01Z', '2026-10-28T10:00:00.999999999Z') > 0);
  assert.strictEqual(T.cmpTs('2026-10-28T10:00:00Z', '2026-10-28T10:00:00.000000Z'), 0);
  assert.strictEqual(T.maxTs(['2026-10-28T10:00:00Z', '2026-10-28T11:00:00.5Z', '2026-10-28T11:00:00.25Z']), '2026-10-28T11:00:00.5Z');
  assert.strictEqual(T.shiftTs('2026-10-28T10:02:00.5Z', -120), '2026-10-28T10:00:00.000Z');
});
