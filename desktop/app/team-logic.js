// Team logic shared by the renderer, the main process and tests: roles, task rules, sorting, grouping
// and the shape of what the Calendar shows. The permission rules here mirror firestore.rules, so a
// change to one needs the matching change in the other.
//
// Roles:
//   admin  - everything: tasks, team events, roles, people, invite code. The team's creator is its owner:
//            always an admin, never removed or demoted.
//   lead   - gives tasks and team events, and edits the ones they made; sees everyone's work.
//   member - sees the team's tasks and changes the status of the tasks given to them.
(function (root, factory) {
  const api = factory(typeof module !== 'undefined' ? require('./calendar-logic') : root.FolioCalLogic);
  if (typeof module !== 'undefined') module.exports = api;
  else root.FolioTeamLogic = api;
})(typeof self !== 'undefined' ? self : globalThis, function (C) {
  const STATUSES = ['todo', 'doing', 'done'];
  const STATUS_LABEL = { todo: 'To do', doing: 'Doing', done: 'Done' };
  const PRIORITIES = ['low', 'medium', 'high'];
  const ROLES = ['admin', 'lead', 'member'];
  const ROLE_LABEL = { admin: 'Admin', lead: 'Lead', member: 'Member' };
  const ROLE_RANK = { admin: 0, lead: 1, member: 2 };

  // Invite codes: 8 symbols from 32 (no I, O, 0 or 1, which are easy to mix up) = about 10^12 codes.
  const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const INVITE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
  const inviteCodeFrom = bytes => Array.from({ length: 8 }, (_, i) => INVITE_ALPHABET[bytes[i] & 31]).join('');
  const normalizeInviteCode = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isInviteCode = s => INVITE_RE.test(s);

  const isMember = (team, uid) => Boolean(team && uid && Array.isArray(team.memberIds) && team.memberIds.includes(uid));
  const roleOf = (team, uid) => (isMember(team, uid) && team.members && team.members[uid] && ROLES.includes(team.members[uid].role) ? team.members[uid].role : '');
  const isAdmin = (team, uid) => roleOf(team, uid) === 'admin';
  const isLead = (team, uid) => roleOf(team, uid) === 'lead';
  const canLead = (team, uid) => isAdmin(team, uid) || isLead(team, uid); // may give tasks and add team events
  const isOwner = (team, uid) => Boolean(team && uid && team.ownerUid === uid);
  const nameOf = (team, uid) => team?.members?.[uid]?.name || team?.members?.[uid]?.email || 'Former member';

  function normalizeTeamName(name) {
    const n = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return n ? { name: n } : { error: 'Give the team a name.' };
  }

  // Checks what the task form produced. Returns { error } or a clean task (without id/author/times).
  // keepAssignee: the person a task already has. They may stay on it even after leaving the team, so it can still
  // be edited or deleted; giving it to anyone new still needs a current member.
  // mustDo: a reminder that stays at the top of the person's landing screen every day until the task is done.
  function normalizeTaskInput(input = {}, team, { keepAssignee = '' } = {}) {
    const title = String(input.title ?? '').trim().slice(0, 200);
    if (!title) return { error: 'Give the task a title.' };
    const assigneeUid = String(input.assigneeUid || '');
    if (!isMember(team, assigneeUid) && !(keepAssignee && assigneeUid === keepAssignee)) return { error: 'Pick a team member to give the task to.' };
    const status = STATUSES.includes(input.status) ? input.status : 'todo';
    const priority = PRIORITIES.includes(input.priority) ? input.priority : 'medium';
    const dueDate = input.dueDate ? String(input.dueDate) : '';
    if (dueDate && !C.isDate(dueDate)) return { error: 'The due date is not valid.' };
    const notes = String(input.notes ?? '').slice(0, 4000);
    return { title, notes, assigneeUid, status, priority, dueDate, mustDo: Boolean(input.mustDo) };
  }

  // Who may change what on a task. An admin edits everything. A lead edits the tasks they created. The person a
  // task is given to changes only its status. Nobody else changes anything. Returns { error } or { patch }.
  const MANAGE_FIELDS = ['title', 'notes', 'assigneeUid', 'status', 'priority', 'dueDate', 'deleted', 'mustDo'];
  const canManageTask = (team, uid, task) => isAdmin(team, uid) || (isLead(team, uid) && Boolean(task) && task.createdBy === uid);
  function checkTaskPatch(team, uid, task, patch = {}) {
    const keys = Object.keys(patch);
    if (!keys.length) return { error: 'Nothing to change.' };
    if (canManageTask(team, uid, task)) {
      const bad = keys.filter(k => !MANAGE_FIELDS.includes(k));
      if (bad.length) return { error: `Cannot change ${bad.join(', ')}.` };
      const merged = normalizeTaskInput({ ...task, ...patch }, team, { keepAssignee: task && task.assigneeUid });
      if (merged.error) return merged;
      const clean = {};
      for (const k of keys) clean[k] = k === 'deleted' ? Boolean(patch[k]) : merged[k];
      return { patch: clean };
    }
    if (isMember(team, uid) && task && task.assigneeUid === uid) {
      if (keys.length !== 1 || keys[0] !== 'status' || !STATUSES.includes(patch.status)) return { error: 'You can only change the status of a task given to you.' };
      return { patch: { status: patch.status } };
    }
    return { error: 'You cannot change this task.' };
  }

  // Team calendar events are made by admins and leads; an admin edits any, a lead the ones they made.
  // event: the existing event when editing; leave it out when creating one.
  const canEditEvent = (team, uid, event) => isAdmin(team, uid) || (isLead(team, uid) && (!event || event.createdBy === uid));
  function normalizeTeamEventInput(input, team, uid, event) {
    if (!canLead(team, uid)) return { error: 'Only admins and leads can add team events.' };
    if (event && !canEditEvent(team, uid, event)) return { error: 'A lead can only change the team events they made.' };
    return C.normalizeEventInput(input);
  }

  // People management: admins only. The owner is always an admin and cannot be removed.
  // A refusal carries a code: forbidden (not allowed), invalid (bad input) or not-found.
  function checkRoleChange(team, actorUid, targetUid, role) {
    if (!isAdmin(team, actorUid)) return { error: 'Only admins can change roles.', code: 'forbidden' };
    if (!ROLES.includes(role)) return { error: 'Pick admin, lead or member.', code: 'invalid' };
    if (!isMember(team, targetUid)) return { error: 'That person is not in the team.', code: 'not-found' };
    if (isOwner(team, targetUid)) return { error: 'The person who created the team always stays an admin.', code: 'forbidden' };
    return { ok: true };
  }
  function checkRemoveMember(team, actorUid, targetUid) {
    if (!isAdmin(team, actorUid)) return { error: 'Only admins can remove people.', code: 'forbidden' };
    if (!isMember(team, targetUid)) return { error: 'That person is not in the team.', code: 'not-found' };
    if (isOwner(team, targetUid)) return { error: 'The person who created the team cannot be removed.', code: 'forbidden' };
    return { ok: true };
  }

  const isOverdue = (task, today) => Boolean(task.dueDate) && task.dueDate < today && task.status !== 'done';
  // Important = flagged must-do, or high priority.
  const isImportant = task => Boolean(task.mustDo) || task.priority === 'high';

  function filterTasks(tasks, f = {}, today = '') {
    const q = String(f.query || '').trim().toLowerCase();
    return tasks.filter(t => !t.deleted
      && (!f.assigneeUid || t.assigneeUid === f.assigneeUid)
      && (!f.status || t.status === f.status)
      && (!f.hideDone || t.status !== 'done')
      && (!f.overdueOnly || isOverdue(t, today))
      && (!f.mustDoOnly || t.mustDo)
      && (!q || String(t.title).toLowerCase().includes(q) || String(t.notes || '').toLowerCase().includes(q)));
  }

  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  const STATUS_RANK = { todo: 0, doing: 1, done: 2 };
  const byTitle = (a, b) => String(a.title).localeCompare(String(b.title), undefined, { numeric: true, sensitivity: 'base' });
  // Sort keys: due, priority, status, title, updated. Tasks without a due date always come last when sorting by due.
  // Equal tasks fall back to the soonest due date, so "high priority" lists the most urgent first.
  function sortTasks(tasks, key = 'due', dir = 'asc') {
    const k = dir === 'desc' ? -1 : 1;
    const by = {
      due: (a, b) => {
        if (!a.dueDate || !b.dueDate) return a.dueDate ? -1 : b.dueDate ? 1 : 0;
        return k * a.dueDate.localeCompare(b.dueDate);
      },
      priority: (a, b) => k * (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]),
      status: (a, b) => k * (STATUS_RANK[a.status] - STATUS_RANK[b.status]),
      title: (a, b) => k * byTitle(a, b),
      updated: (a, b) => -k * cmpTs(a.updatedAt, b.updatedAt),
    }[key] || (() => 0);
    const dueFirst = (a, b) => (!a.dueDate || !b.dueDate ? (a.dueDate ? -1 : b.dueDate ? 1 : 0) : a.dueDate.localeCompare(b.dueDate));
    // Ties: soonest due date first, then higher priority, then title.
    return [...tasks].sort((a, b) => by(a, b) || dueFirst(a, b) || (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || byTitle(a, b));
  }

  // Groups: by assignee (every member gets a group, admins then leads then members, so whoever manages can see who has
  // nothing), by status, or one group with everything.
  function groupTasks(tasks, by, team) {
    if (by === 'status') return STATUSES.map(s => ({ key: s, label: STATUS_LABEL[s], tasks: tasks.filter(t => t.status === s) }));
    if (by === 'assignee') {
      const rank = u => (ROLE_RANK[roleOf(team, u)] ?? 3);
      const uids = [...(team?.memberIds || [])].sort((a, b) => (rank(a) - rank(b)) || nameOf(team, a).localeCompare(nameOf(team, b)));
      return uids.map(uid => ({ key: uid, label: nameOf(team, uid), tasks: tasks.filter(t => t.assigneeUid === uid) }));
    }
    return [{ key: '', label: '', tasks }];
  }

  // Calendar items. A task with a due date becomes an all-day item on that day; team events keep their times.
  function taskToEvent(t) {
    if (!t || t.deleted || !C.isDate(t.dueDate)) return null;
    return { id: 't:' + t.id, source: 'team', kind: 'task', taskId: t.id, title: t.title, startDate: t.dueDate, endDate: t.dueDate, allDay: true, startTime: '', endTime: '', notes: t.notes || '', assigneeUid: t.assigneeUid, status: t.status };
  }
  function teamEventToEvent(e) {
    if (!e || e.deleted || !C.isDate(e.startDate)) return null;
    return { id: 'e:' + e.id, source: 'team', kind: 'event', teamEventId: e.id, createdBy: e.createdBy || '', title: e.title, startDate: e.startDate, endDate: C.isDate(e.endDate) ? e.endDate : e.startDate, allDay: Boolean(e.allDay), startTime: e.startTime || '', endTime: e.endTime || '', notes: e.notes || '' };
  }
  // Admins and leads see every task; members see their own tasks. Everyone sees all team events.
  function calendarItems(tasks, events, team, uid) {
    const mine = canLead(team, uid) ? tasks : tasks.filter(t => t.assigneeUid === uid);
    return [...mine.map(taskToEvent), ...events.map(teamEventToEvent)].filter(Boolean);
  }

  // Server timestamps are ISO strings with up to 9 fraction digits, so compare the fraction as text, not as a Date.
  function tsParts(ts) {
    const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?Z$/.exec(String(ts || ''));
    return m ? [Date.parse(m[1] + 'Z'), (m[2] || '').padEnd(9, '0')] : null;
  }
  function cmpTs(a, b) {
    const x = tsParts(a), y = tsParts(b);
    if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
    return (x[0] - y[0]) || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);
  }
  const maxTs = list => list.reduce((m, t) => (cmpTs(t, m) > 0 ? t : m), '');
  const shiftTs = (ts, seconds) => new Date(tsParts(ts)[0] + seconds * 1000).toISOString();

  return {
    STATUSES, STATUS_LABEL, PRIORITIES, ROLES, ROLE_LABEL, INVITE_ALPHABET,
    inviteCodeFrom, normalizeInviteCode, isInviteCode, isMember, roleOf, isAdmin, isLead, canLead, isOwner, nameOf, normalizeTeamName,
    normalizeTaskInput, checkTaskPatch, canManageTask, canEditEvent, normalizeTeamEventInput, checkRoleChange, checkRemoveMember,
    isOverdue, isImportant, filterTasks, sortTasks, groupTasks,
    taskToEvent, teamEventToEvent, calendarItems, cmpTs, maxTs, shiftTs,
  };
});
