// Team logic shared by the renderer, the main process and tests: roles, task rules, sorting, grouping
// and the shape of what the Calendar shows. The permission rules here mirror firestore.rules, so a
// change to one needs the matching change in the other.
(function (root, factory) {
  const api = factory(typeof module !== 'undefined' ? require('./calendar-logic') : root.FolioCalLogic);
  if (typeof module !== 'undefined') module.exports = api;
  else root.FolioTeamLogic = api;
})(typeof self !== 'undefined' ? self : globalThis, function (C) {
  const STATUSES = ['todo', 'doing', 'done'];
  const STATUS_LABEL = { todo: 'To do', doing: 'Doing', done: 'Done' };
  const PRIORITIES = ['low', 'medium', 'high'];
  const ROLES = ['head', 'member'];

  // Invite codes: 8 symbols from 32 (no I, O, 0 or 1, which are easy to mix up) = about 10^12 codes.
  const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const INVITE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
  const inviteCodeFrom = bytes => Array.from({ length: 8 }, (_, i) => INVITE_ALPHABET[bytes[i] & 31]).join('');
  const normalizeInviteCode = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isInviteCode = s => INVITE_RE.test(s);

  const isMember = (team, uid) => Boolean(team && uid && Array.isArray(team.memberIds) && team.memberIds.includes(uid));
  const isHead = (team, uid) => Boolean(team && uid && team.members && team.members[uid] && team.members[uid].role === 'head');
  const nameOf = (team, uid) => team?.members?.[uid]?.name || team?.members?.[uid]?.email || 'Someone';

  function normalizeTeamName(name) {
    const n = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return n ? { name: n } : { error: 'Give the team a name.' };
  }

  // Checks what the task form produced. Returns { error } or a clean task (without id/author/times).
  function normalizeTaskInput(input = {}, team) {
    const title = String(input.title ?? '').trim().slice(0, 200);
    if (!title) return { error: 'Give the task a title.' };
    const assigneeUid = String(input.assigneeUid || '');
    if (!isMember(team, assigneeUid)) return { error: 'Pick a team member to give the task to.' };
    const status = STATUSES.includes(input.status) ? input.status : 'todo';
    const priority = PRIORITIES.includes(input.priority) ? input.priority : 'medium';
    const dueDate = input.dueDate ? String(input.dueDate) : '';
    if (dueDate && !C.isDate(dueDate)) return { error: 'The due date is not valid.' };
    const notes = String(input.notes ?? '').slice(0, 4000);
    return { title, notes, assigneeUid, status, priority, dueDate };
  }

  // Who may change what. The head may edit everything; the person a task is assigned to may only
  // change its status; nobody else may change it. Returns { error } or { patch } with clean values.
  const HEAD_FIELDS = ['title', 'notes', 'assigneeUid', 'status', 'priority', 'dueDate', 'deleted'];
  function checkTaskPatch(team, uid, task, patch = {}) {
    const keys = Object.keys(patch);
    if (!keys.length) return { error: 'Nothing to change.' };
    if (isHead(team, uid)) {
      const bad = keys.filter(k => !HEAD_FIELDS.includes(k));
      if (bad.length) return { error: `Cannot change ${bad.join(', ')}.` };
      const merged = normalizeTaskInput({ ...task, ...patch }, team);
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

  // Team calendar events are made by the head. Same fields as a normal calendar event.
  function normalizeTeamEventInput(input, team, uid) {
    if (!isHead(team, uid)) return { error: 'Only the team head can add team events.' };
    return C.normalizeEventInput(input);
  }

  const isOverdue = (task, today) => Boolean(task.dueDate) && task.dueDate < today && task.status !== 'done';

  function filterTasks(tasks, f = {}, today = '') {
    const q = String(f.query || '').trim().toLowerCase();
    return tasks.filter(t => !t.deleted
      && (!f.assigneeUid || t.assigneeUid === f.assigneeUid)
      && (!f.status || t.status === f.status)
      && (!f.hideDone || t.status !== 'done')
      && (!f.overdueOnly || isOverdue(t, today))
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

  // Groups: by assignee (every member gets a group, head first, so the head can see who has nothing),
  // by status, or one group with everything.
  function groupTasks(tasks, by, team) {
    if (by === 'status') return STATUSES.map(s => ({ key: s, label: STATUS_LABEL[s], tasks: tasks.filter(t => t.status === s) }));
    if (by === 'assignee') {
      const uids = [...(team?.memberIds || [])].sort((a, b) => (isHead(team, b) - isHead(team, a)) || nameOf(team, a).localeCompare(nameOf(team, b)));
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
    return { id: 'e:' + e.id, source: 'team', kind: 'event', teamEventId: e.id, title: e.title, startDate: e.startDate, endDate: C.isDate(e.endDate) ? e.endDate : e.startDate, allDay: Boolean(e.allDay), startTime: e.startTime || '', endTime: e.endTime || '', notes: e.notes || '' };
  }
  // The head sees every task; everyone else sees their own tasks plus all team events.
  function calendarItems(tasks, events, team, uid) {
    const mine = isHead(team, uid) ? tasks : tasks.filter(t => t.assigneeUid === uid);
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
    STATUSES, STATUS_LABEL, PRIORITIES, ROLES, INVITE_ALPHABET,
    inviteCodeFrom, normalizeInviteCode, isInviteCode, isMember, isHead, nameOf, normalizeTeamName,
    normalizeTaskInput, checkTaskPatch, normalizeTeamEventInput, isOverdue, filterTasks, sortTasks, groupTasks,
    taskToEvent, teamEventToEvent, calendarItems, cmpTs, maxTs, shiftTs,
  };
});
