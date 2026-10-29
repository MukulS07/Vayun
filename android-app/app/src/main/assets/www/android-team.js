// Generated into web-team.js by build.js: a tiny module loader so the desktop's team code runs, unchanged, in a browser.
// The marker line inside "defs" is replaced with one entry per Node module; the stand-ins below cover the three Node modules they use.
(function () {
  const store = (() => { try { return JSON.parse(localStorage.getItem('vayun-team-cache') || '{}'); } catch { return {}; } })();
  const persist = () => { try { localStorage.setItem('vayun-team-cache', JSON.stringify(store)); } catch { /* full or blocked: the cache is optional */ } };
  const nodeFs = {
    readFileSync: p => { if (!(p in store)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return store[p]; },
    writeFileSync: (p, d) => { store[p] = String(d); persist(); },
    renameSync: (a, b) => { store[b] = store[a]; delete store[a]; persist(); },
    existsSync: p => p in store,
    mkdirSync: () => {},
  };
  const nodePath = { join: (...parts) => parts.join('/').replace(/\/+/g, '/') };
  const nodeCrypto = {
    randomUUID: () => crypto.randomUUID(),
    randomBytes: n => crypto.getRandomValues(new Uint8Array(n)),
  };
  const defs = {
  "./team-error.js": function (module, exports, require) {
// An error that is safe to show to a person. code: invalid | forbidden | not-found | conflict | quota | auth | setup | network
class TeamError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'TeamError';
    this.code = code;
  }
}

module.exports = { TeamError };

  },
  "./firestore-rest.js": function (module, exports, require) {
// Minimal Cloud Firestore REST helpers: value encoding, write and query builders, and error mapping.
// https://firebase.google.com/docs/firestore/reference/rest
const { TeamError } = require('./team-error');

const BASE = 'https://firestore.googleapis.com/v1';
const docsRoot = project => `projects/${project}/databases/(default)/documents`;

// ---- values ----
// Strings stay strings, whole numbers become integers, { $timestamp: iso } becomes a Firestore timestamp.
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object' && '$timestamp' in v) return { timestampValue: v.$timestamp };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  throw new Error('Unsupported value type: ' + typeof v);
}
const toFields = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toValue(v)]));

// Timestamps stay ISO strings (exact, with their full fraction) so they can be sent back as a cursor.
function fromValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}
const fromFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, fromValue(v)]));
const fromDocument = doc => ({ id: doc.name.split('/').pop(), ...fromFields(doc.fields) });

// ---- writes ----
const fieldPath = parts => [].concat(parts).map(p => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) ? p : '`' + p.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`')).join('.');
const serverTimeTransforms = names => names.map(f => ({ fieldPath: fieldPath(f), setToServerValue: 'REQUEST_TIME' }));

function setIn(obj, parts, value) {
  let o = obj;
  parts.slice(0, -1).forEach(p => { o = o[p] = o[p] || {}; });
  o[parts[parts.length - 1]] = value;
}

// Creates a document; the write fails if it already exists. serverTime: fields set to the server's time.
function createWrite(project, path, data, { serverTime = [] } = {}) {
  return {
    update: { name: `${docsRoot(project)}/${path}`, fields: toFields(data) },
    currentDocument: { exists: false },
    ...(serverTime.length && { updateTransforms: serverTimeTransforms(serverTime) }),
  };
}

// Changes only the listed fields of an existing document. set: [[pathParts, value]], remove: [pathParts],
// arrayUnion / arrayRemove: [[field, values]].
function patchWrite(project, path, { set = [], remove = [], serverTime = [], arrayUnion = [], arrayRemove = [] } = {}) {
  const nested = {};
  for (const [parts, value] of set) setIn(nested, [].concat(parts), value);
  const transforms = [
    ...serverTimeTransforms(serverTime),
    ...arrayUnion.map(([f, vals]) => ({ fieldPath: fieldPath(f), appendMissingElements: { values: vals.map(toValue) } })),
    ...arrayRemove.map(([f, vals]) => ({ fieldPath: fieldPath(f), removeAllFromArray: { values: vals.map(toValue) } })),
  ];
  return {
    update: { name: `${docsRoot(project)}/${path}`, fields: toFields(nested) },
    updateMask: { fieldPaths: [...set.map(([p]) => fieldPath(p)), ...remove.map(fieldPath)] },
    currentDocument: { exists: true },
    ...(transforms.length && { updateTransforms: transforms }),
  };
}

const deleteWrite = (project, path) => ({ delete: `${docsRoot(project)}/${path}` });

// ---- queries ----
const OPS = { '==': 'EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', '<': 'LESS_THAN', 'array-contains': 'ARRAY_CONTAINS' };
function structuredQuery({ collection, where = [], orderBy, limit }) {
  const filters = where.map(({ field, op, value }) => ({ fieldFilter: { field: { fieldPath: field }, op: OPS[op], value: toValue(value) } }));
  const q = { from: [{ collectionId: collection }] };
  if (filters.length === 1) q.where = filters[0];
  else if (filters.length > 1) q.where = { compositeFilter: { op: 'AND', filters } };
  if (orderBy) q.orderBy = [{ field: { fieldPath: orderBy.field }, direction: orderBy.desc ? 'DESCENDING' : 'ASCENDING' }];
  if (limit) q.limit = limit;
  return q;
}
// An empty result still arrives as one entry without a document.
const parseQueryResponse = rows => (rows || []).filter(r => r.document).map(r => fromDocument(r.document));

// ---- requests ----
function firestoreError(status, json) {
  const code = json?.error?.status || '';
  const msg = json?.error?.message || '';
  if (status === 401 || code === 'UNAUTHENTICATED') return new TeamError('Your sign-in expired. Sign in again.', 'auth');
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') return new TeamError('The free daily limit for team sync was reached. It resets tomorrow.', 'quota');
  if (/has not been used|is disabled|does not exist|database .* not found/i.test(msg)) return new TeamError('The team space is not set up yet.', 'setup');
  if (status === 403 || code === 'PERMISSION_DENIED') return new TeamError('You are not allowed to do that.', 'forbidden');
  if (status === 404 || code === 'NOT_FOUND') return new TeamError('Not found.', 'not-found');
  if (status === 409 || code === 'ALREADY_EXISTS' || code === 'FAILED_PRECONDITION' || code === 'ABORTED') return new TeamError('That changed while you were working. Try again.', 'conflict');
  return new TeamError(`Team sync failed (${status}).`, 'network');
}

async function request(fetchImpl, token, method, url, body) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new TeamError('Could not reach the team server. Check your internet connection.', 'network');
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw firestoreError(res.status, json);
  return json;
}

module.exports = {
  BASE, docsRoot, toValue, toFields, fromValue, fromFields, fromDocument, fieldPath,
  createWrite, patchWrite, deleteWrite, structuredQuery, parseQueryResponse, firestoreError, request,
};

  },
  "./app/calendar-logic.js": function (module, exports, require) {
// Calendar logic shared by the renderer, the main process (Google mapping) and tests.
// Dates are 'YYYY-MM-DD' strings and times 'HH:MM', both local. An event's endDate is inclusive.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else root.FolioCalLogic = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const pad = n => String(n).padStart(2, '0');

  const isDate = s => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
  const isTime = s => typeof s === 'string' && TIME_RE.test(s);
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeKey = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  // UTC arithmetic so daylight-saving changes never skip or repeat a day.
  function addDays(date, n) {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  const weekday = date => new Date(date + 'T00:00:00Z').getUTCDay(); // 0 = Sunday

  // Month view: 6 weeks of 7 days starting on Monday, covering the whole month.
  function monthGrid(year, month) {
    const first = `${year}-${pad(month + 1)}-01`;
    const start = addDays(first, -((weekday(first) + 6) % 7));
    return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
  }
  function weekOf(date) {
    const start = addDays(date, -((weekday(date) + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  function shiftMonth(date, n) {
    const [y, m] = date.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return d.toISOString().slice(0, 10);
  }

  // Events per day for the given days. Multi-day events appear on every day they cover.
  // All-day events come first, then by start time, then by title.
  function eventsByDay(events, days) {
    const map = new Map(days.map(d => [d, []]));
    const first = days[0], last = days[days.length - 1];
    for (const e of events) {
      if (!isDate(e.startDate)) continue;
      const end = isDate(e.endDate) && e.endDate >= e.startDate ? e.endDate : e.startDate;
      if (end < first || e.startDate > last) continue;
      for (let d = e.startDate < first ? first : e.startDate, n = 0; d <= end && d <= last && n < 400; d = addDays(d, 1), n++) {
        map.get(d)?.push(e);
      }
    }
    const order = e => (e.allDay ? '' : e.startTime || '99:99');
    for (const list of map.values()) list.sort((a, b) => order(a).localeCompare(order(b)) || String(a.title).localeCompare(String(b.title)));
    return map;
  }

  // Checks what the event form produced. Returns { error } or a clean event (without id/source).
  function normalizeEventInput(input = {}) {
    const title = String(input.title ?? '').trim().slice(0, 300);
    if (!title) return { error: 'Give the event a title.' };
    const startDate = String(input.startDate || '');
    if (!isDate(startDate)) return { error: 'Pick a start date.' };
    let endDate = isDate(input.endDate) ? input.endDate : startDate;
    if (endDate < startDate) return { error: 'The event cannot end before it starts.' };
    const allDay = Boolean(input.allDay);
    const notes = String(input.notes ?? '').slice(0, 8000);
    const color = typeof input.color === 'string' && (/^#[0-9a-fA-F]{6}$/.test(input.color) || input.color === '') ? input.color : '';
    if (allDay) {
      const out = { title, startDate, endDate, allDay: true, startTime: '', endTime: '', notes };
      if (color) out.color = color;
      return out;
    }
    const startTime = isTime(input.startTime) ? input.startTime : '09:00';
    let endTime = isTime(input.endTime) ? input.endTime : '';
    if (!endTime) {
      const [h, m] = startTime.split(':').map(Number);
      if (h === 23) endTime = '23:59';
      else endTime = `${pad(h + 1)}:${pad(m)}`;
    }
    if (endDate === startDate && endTime <= startTime) return { error: 'The event must end after it starts.' };
    const out = { title, startDate, endDate, allDay: false, startTime, endTime, notes };
    if (color) out.color = color;
    return out;
  }

  // Database rows with a date become read-only calendar items that open the row.
  function rowEvents(pages, dateProp) {
    const out = [];
    for (const db of pages.filter(p => p.kind === 'database')) {
      const dp = dateProp(db);
      if (!dp) continue;
      for (const r of pages) {
        if (r.parentId !== db.id) continue;
        const date = String(r.props?.[dp.id] ?? '').slice(0, 10);
        if (!isDate(date)) continue;
        out.push({ id: 'row:' + r.id, rowId: r.id, source: 'row', title: r.title || 'Untitled', startDate: date, endDate: date, allDay: true, startTime: '', endTime: '', notes: db.title || '' });
      }
    }
    return out;
  }

  // Google Calendar event resource -> calendar event. Timed events are shown in local time.
  // Google's all-day end date is exclusive, ours is inclusive.
  function fromGoogleEvent(g, calInfo) {
    if (!g || typeof g !== 'object' || g.status === 'cancelled' || !g.id || !g.start) return null;
    const calId = calInfo?.id || 'primary';
    const calTitle = calInfo?.summary || '';
    const base = {
      id: calId === 'primary' ? 'g:' + g.id : 'g:' + encodeURIComponent(calId) + ':' + g.id,
      googleId: String(g.id),
      calendarId: calId,
      calendarTitle: calTitle,
      color: calInfo?.color || '',
      calendarAccessRole: calInfo?.accessRole || '',
      source: 'google',
      title: String(g.summary || '(No title)'),
      notes: String(g.description || ''),
      link: typeof g.htmlLink === 'string' ? g.htmlLink : '',
    };
    if (g.start.date) {
      const startDate = g.start.date;
      const endDate = g.end?.date ? addDays(g.end.date, -1) : startDate;
      return { ...base, startDate, endDate: endDate < startDate ? startDate : endDate, allDay: true, startTime: '', endTime: '' };
    }
    const s = new Date(g.start.dateTime), e = new Date(g.end?.dateTime || g.start.dateTime);
    if (Number.isNaN(s.getTime())) return null;
    const end = Number.isNaN(e.getTime()) || e < s ? s : e;
    return { ...base, startDate: dayKey(s), endDate: dayKey(end), allDay: false, startTime: timeKey(s), endTime: timeKey(end) };
  }

  // Calendar event -> Google Calendar event resource (for insert and patch).
  function toGoogleEvent(e, timeZone) {
    const body = { summary: e.title, description: e.notes || '' };
    if (e.allDay) {
      body.start = { date: e.startDate };
      body.end = { date: addDays(e.endDate || e.startDate, 1) };
    } else {
      body.start = { dateTime: `${e.startDate}T${e.startTime}:00`, timeZone };
      body.end = { dateTime: `${e.endDate || e.startDate}T${e.endTime}:00`, timeZone };
    }
    return body;
  }

  return { isDate, isTime, dayKey, addDays, monthGrid, weekOf, shiftMonth, eventsByDay, normalizeEventInput, rowEvents, fromGoogleEvent, toGoogleEvent };
});

  },
  "./app/team-logic.js": function (module, exports, require) {
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

  },
  "./team-store-firestore.js": function (module, exports, require) {
// Team backend on Cloud Firestore, over its REST API. It has the same methods as team-store-memory.js
// (that file is the reference for how they behave), so the rest of Vayun never talks to Firestore directly.
// firestore.rules is what actually stops people doing things they should not; the checks here give clear
// messages first and keep ordinary use from ever reaching the rules.
const crypto = require('node:crypto');
const T = require('./app/team-logic');
const R = require('./firestore-rest');
const { TeamError } = require('./team-error');

const OVERLAP_SECONDS = 120; // re-read recent changes so a write that committed late is never missed

class FirestoreTeamStore {
  // project: Firebase project id. getToken(): async Firebase ID token. me(): { uid, name, email, photoURL }.
  // baseUrl: only for tests, to talk to Google's local Firestore emulator instead of the real service.
  constructor({ project, getToken, me, fetch: fetchImpl = globalThis.fetch, baseUrl = R.BASE }) {
    this.project = project;
    this.base = baseUrl;
    this.getToken = getToken;
    this.meSource = me;
    this.fetch = fetchImpl;
  }

  // ---- plumbing ----
  _me() {
    const u = typeof this.meSource === 'function' ? this.meSource() : this.meSource;
    if (!u || !u.uid) throw new TeamError('Sign in to use teams.', 'auth');
    return u;
  }
  _id() { return crypto.randomUUID().replace(/-/g, '').slice(0, 20); }
  _url(suffix) { return `${this.base}/${R.docsRoot(this.project)}${suffix}`; }
  async _call(method, url, body) { return R.request(this.fetch, await this.getToken(), method, url, body); }
  async _commit(writes) { return this._call('POST', this._url(':commit'), { writes }); }
  async _get(path) {
    try { return R.fromDocument(await this._call('GET', this._url('/' + path))); }
    catch (e) { if (e.code === 'not-found') return null; throw e; }
  }
  async _query(parent, q) {
    return R.parseQueryResponse(await this._call('POST', this._url((parent ? '/' + parent : '') + ':runQuery'), { structuredQuery: R.structuredQuery(q) }));
  }
  _profile(role, extra = {}) { const u = this._me(); return { name: u.name || u.email || 'Someone', email: u.email || '', photoURL: u.photoURL || '', role, ...extra }; }
  _refuse(r) { if (r.error) throw new TeamError(r.error, r.code || 'invalid'); }

  async _team(teamId) {
    const t = await this._get(`teams/${teamId}`);
    if (!t) throw new TeamError('Team not found.', 'not-found');
    return this._shapeTeam(t);
  }
  _shapeTeam(t) { return { ...t, memberIds: t.memberIds || [], members: t.members || {} }; }
  async _adminTeam(teamId, what) {
    const t = await this._team(teamId);
    if (!T.isAdmin(t, this._me().uid)) throw new TeamError(`Only admins can ${what}.`, 'forbidden');
    return t;
  }
  async _leadTeam(teamId, what) {
    const t = await this._team(teamId);
    if (!T.canLead(t, this._me().uid)) throw new TeamError(`Only admins and leads can ${what}.`, 'forbidden');
    return t;
  }

  // ---- teams ----
  async myTeams() {
    const docs = await this._query('', { collection: 'teams', where: [{ field: 'memberIds', op: 'array-contains', value: this._me().uid }] });
    return docs.map(d => this._shapeTeam(d));
  }

  async createTeam(name) {
    const n = T.normalizeTeamName(name);
    if (n.error) throw new TeamError(n.error);
    const me = this._me();
    const id = this._id();
    const code = T.inviteCodeFrom(crypto.randomBytes(8));
    await this._commit([
      R.createWrite(this.project, `teams/${id}`, { name: n.name, ownerUid: me.uid, memberIds: [me.uid], members: { [me.uid]: this._profile('admin') }, inviteCode: code }, { serverTime: ['createdAt', 'updatedAt'] }),
      R.createWrite(this.project, `invites/${code}`, { teamId: id, createdBy: me.uid }, { serverTime: ['createdAt'] }),
    ]);
    return this._team(id);
  }

  async getTeam(teamId) { return this._team(teamId); }

  async joinTeam(code) {
    const c = T.normalizeInviteCode(code);
    if (!T.isInviteCode(c)) throw new TeamError('That code does not look right. It has 8 letters and numbers.');
    const invite = await this._get(`invites/${c}`);
    if (!invite) throw new TeamError('No team has that code.', 'not-found');
    const me = this._me();
    try { return await this._team(invite.teamId); } catch (e) { if (e.code !== 'forbidden') throw e; } // already a member: nothing to do
    await this._commit([R.patchWrite(this.project, `teams/${invite.teamId}`, {
      set: [[['members', me.uid], this._profile('member', { joinCode: c })]],
      serverTime: ['updatedAt'],
      arrayUnion: [['memberIds', [me.uid]]],
    })]);
    return this._team(invite.teamId);
  }

  async leaveTeam(teamId) {
    const t = await this._team(teamId);
    const uid = this._me().uid;
    if (T.isOwner(t, uid)) throw new TeamError('The person who created the team cannot leave it.', 'forbidden');
    await this._removeFromTeam(teamId, uid);
  }

  async removeMember(teamId, uid) {
    const t = await this._team(teamId);
    this._refuse(T.checkRemoveMember(t, this._me().uid, uid));
    await this._removeFromTeam(teamId, uid);
    return this._team(teamId);
  }

  _removeFromTeam(teamId, uid) {
    return this._commit([R.patchWrite(this.project, `teams/${teamId}`, { remove: [['members', uid]], serverTime: ['updatedAt'], arrayRemove: [['memberIds', [uid]]] })]);
  }

  async setRole(teamId, uid, role) {
    const t = await this._team(teamId);
    this._refuse(T.checkRoleChange(t, this._me().uid, uid, role));
    await this._commit([R.patchWrite(this.project, `teams/${teamId}`, { set: [[['members', uid, 'role'], role]], serverTime: ['updatedAt'] })]);
    return this._team(teamId);
  }

  async rotateInvite(teamId) {
    const t = await this._adminTeam(teamId, 'make a new invite code');
    const code = T.inviteCodeFrom(crypto.randomBytes(8));
    await this._commit([
      R.createWrite(this.project, `invites/${code}`, { teamId, createdBy: this._me().uid }, { serverTime: ['createdAt'] }),
      R.deleteWrite(this.project, `invites/${t.inviteCode}`),
      R.patchWrite(this.project, `teams/${teamId}`, { set: [[['inviteCode'], code]], serverTime: ['updatedAt'] }),
    ]);
    return this._team(teamId);
  }

  // ---- sync ----
  // cursors: { tasks, events }, the newest updatedAt seen for each. With no cursor it loads what still exists;
  // after that only what changed since (with a little overlap), so an idle check costs about one read per kind.
  // { events: false } leaves events out of this check (they change rarely); their cursor stays where it was.
  async changes(teamId, cursors = {}, opts = {}) {
    const load = (collection, cursor) => this._query(`teams/${teamId}`, {
      collection,
      where: cursor
        ? [{ field: 'updatedAt', op: '>=', value: { $timestamp: T.shiftTs(cursor, -OVERLAP_SECONDS) } }]
        : [{ field: 'deleted', op: '==', value: false }],
    });
    const [tasks, events] = await Promise.all([load('tasks', cursors.tasks), opts.events === false ? [] : load('events', cursors.events)]);
    const withTeam = d => ({ ...d, teamId });
    return {
      tasks: tasks.map(withTeam),
      events: events.map(withTeam),
      cursors: {
        tasks: T.maxTs([cursors.tasks || '', ...tasks.map(d => d.updatedAt)]),
        events: opts.events === false ? (cursors.events || '') : T.maxTs([cursors.events || '', ...events.map(d => d.updatedAt)]),
      },
    };
  }

  // ---- tasks ----
  async createTask(teamId, input) {
    const t = await this._leadTeam(teamId, 'give out tasks');
    const v = T.normalizeTaskInput(input, t);
    if (v.error) throw new TeamError(v.error);
    const id = this._id();
    await this._commit([R.createWrite(this.project, `teams/${teamId}/tasks/${id}`, { ...v, createdBy: this._me().uid, deleted: false }, { serverTime: ['createdAt', 'updatedAt'] })]);
    return { ...(await this._get(`teams/${teamId}/tasks/${id}`)), teamId };
  }

  // ctx: { team, task } the caller already has, to save two reads.
  async updateTask(teamId, taskId, patch, ctx = {}) {
    const t = ctx.team || await this._team(teamId);
    const task = ctx.task || await this._get(`teams/${teamId}/tasks/${taskId}`);
    if (!task) throw new TeamError('Task not found.', 'not-found');
    const uid = this._me().uid;
    const r = T.checkTaskPatch(t, uid, task, patch);
    if (r.error) throw new TeamError(r.error, T.canManageTask(t, uid, task) ? 'invalid' : 'forbidden');
    await this._commit([R.patchWrite(this.project, `teams/${teamId}/tasks/${taskId}`, { set: Object.entries(r.patch).map(([k, v]) => [[k], v]), serverTime: ['updatedAt'] })]);
    return { ...(await this._get(`teams/${teamId}/tasks/${taskId}`)), teamId };
  }

  // ---- team calendar events (admins and leads) ----
  async createEvent(teamId, input) {
    const t = await this._team(teamId);
    const uid = this._me().uid;
    const v = T.normalizeTeamEventInput(input, t, uid);
    if (v.error) throw new TeamError(v.error, T.canLead(t, uid) ? 'invalid' : 'forbidden');
    const id = this._id();
    await this._commit([R.createWrite(this.project, `teams/${teamId}/events/${id}`, { ...v, createdBy: uid, deleted: false }, { serverTime: ['createdAt', 'updatedAt'] })]);
    return { ...(await this._get(`teams/${teamId}/events/${id}`)), teamId };
  }

  // ctx: { team, event } the caller already has, to save two reads.
  async updateEvent(teamId, eventId, input, ctx = {}) {
    const t = ctx.team || await this._team(teamId);
    const ev = ctx.event || await this._get(`teams/${teamId}/events/${eventId}`);
    if (!ev) throw new TeamError('Event not found.', 'not-found');
    const uid = this._me().uid;
    const v = T.normalizeTeamEventInput(input, t, uid, ev);
    if (v.error) throw new TeamError(v.error, T.canEditEvent(t, uid, ev) ? 'invalid' : 'forbidden');
    await this._commit([R.patchWrite(this.project, `teams/${teamId}/events/${eventId}`, { set: Object.entries(v).map(([k, val]) => [[k], val]), serverTime: ['updatedAt'] })]);
    return { ...(await this._get(`teams/${teamId}/events/${eventId}`)), teamId };
  }

  async deleteEvent(teamId, eventId, ctx = {}) {
    const t = ctx.team || await this._team(teamId);
    const ev = ctx.event || await this._get(`teams/${teamId}/events/${eventId}`);
    if (!ev) throw new TeamError('Event not found.', 'not-found');
    if (!T.canEditEvent(t, this._me().uid, ev)) throw new TeamError('Only admins, or the lead who made it, can remove a team event.', 'forbidden');
    await this._commit([R.patchWrite(this.project, `teams/${teamId}/events/${eventId}`, { set: [[['deleted'], true]], serverTime: ['updatedAt'] })]);
    return { ...(await this._get(`teams/${teamId}/events/${eventId}`)), teamId };
  }
}

module.exports = { FirestoreTeamStore };

  },
  "./team-service.js": function (module, exports, require) {
// The team brain in the main process. It keeps a local copy of the active team's data (so the page opens
// instantly and works offline), checks the backend for changes on a gentle schedule, and exposes plain
// actions for the app window. It only knows the store interface (team-store-memory.js is the reference),
// so the backend can change without touching it.
const fs = require('node:fs');
const path = require('node:path');
const T = require('./app/team-logic');
const { TeamError } = require('./team-error');

const POLL_MS = 90_000; // while Vayun is open and focused. Idle checks cost a few reads of the free daily limit.
const EVENTS_EVERY = 3; // events and the member list change rarely: look at them less often
const TEAM_EVERY = 5;

// dir: where the local copy lives. getUser(): the signed-in person or null. canSync(): can we talk to the backend.
// makeStore(me): the backend for this person (may be async). notify(): tell the app window something changed.
function createTeamService({ dir, getUser, canSync = () => true, makeStore, notify = () => {}, isActive = () => true, intervalMs = POLL_MS, setTimer = setInterval, clearTimer = clearInterval }) {
  const emptyModel = uid => ({ uid, teams: [], activeTeamId: null, data: {}, syncedAt: null });
  let model = emptyModel(null);
  let store = null;
  let error = null;
  let syncing = false;
  let polls = 0;
  let timer = null;
  let saveTimer = null;
  let queue = Promise.resolve(); // one backend call at a time
  let lastRefreshAt = 0;

  // ---- local copy ----
  const cacheFile = () => path.join(dir, 'team-cache.json');
  const readCache = () => { try { return JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { return { users: {} }; } };
  function flush() {
    clearTimeout(saveTimer);
    if (!model.uid) return;
    const c = readCache();
    c.users = c.users || {};
    c.users[model.uid] = model;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cacheFile() + '.tmp', JSON.stringify(c));
    fs.renameSync(cacheFile() + '.tmp', cacheFile());
  }
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); saveTimer.unref?.(); }

  function ensureUser() {
    const u = getUser();
    const uid = u ? u.uid : null;
    if (uid !== model.uid) {
      flush(); // keep the previous person's latest changes before switching
      model = uid ? (readCache().users?.[uid] || emptyModel(uid)) : emptyModel(null);
      store = null; error = null; polls = 0;
    }
    return u;
  }
  async function theStore() {
    const u = ensureUser();
    if (!u) throw new TeamError('Sign in to use teams.', 'auth');
    if (!canSync()) throw new TeamError('Sign in once more to turn on teams.', 'auth');
    if (!store) store = await makeStore({ uid: u.uid, name: u.displayName || u.email || 'Someone', email: u.email || '', photoURL: u.photoURL || '' });
    return store;
  }

  // ---- what the window sees ----
  function snapshot() {
    const u = ensureUser();
    const d = model.activeTeamId ? model.data[model.activeTeamId] : null;
    const live = m => Object.values(m || {}).filter(x => !x.deleted);
    return {
      signedIn: Boolean(u),
      canSync: Boolean(u) && canSync(),
      uid: model.uid,
      teams: model.teams.map(t => ({ id: t.id, name: t.name })),
      activeTeamId: model.activeTeamId,
      team: d ? d.team : null,
      role: d && d.team ? (T.roleOf(d.team, model.uid) || 'member') : null,
      tasks: live(d && d.tasks),
      events: live(d && d.events),
      syncedAt: model.syncedAt,
      syncing,
      error: error ? { message: error.message, code: error.code } : null,
    };
  }
  const changed = () => { save(); notify(snapshot()); };
  const asTeamError = e => (e instanceof TeamError ? e : new TeamError('Something went wrong with team sync.', 'network'));

  // Runs backend work one step at a time; remembers a failure so the page can show it, keeps the data it has.
  function run(fn) {
    const job = queue.then(async () => {
      syncing = true; notify(snapshot());
      try { const r = await fn(); error = null; return r; } finally { syncing = false; lastRefreshAt = Date.now(); changed(); }
    });
    queue = job.catch(() => {});
    return job;
  }
  // Every action returns { ok: true, state } or { error, code, state }.
  async function action(fn) {
    try { await run(fn); return { ok: true, state: snapshot() }; }
    catch (e) { error = asTeamError(e); changed(); return { error: error.message, code: error.code, state: snapshot() }; }
  }

  // ---- syncing ----
  const dataFor = teamId => model.data[teamId] || (model.data[teamId] = { team: null, tasks: {}, events: {}, cursors: {} });
  async function syncTeam(teamId, { events = true, team = true } = {}) {
    const s = await theStore();
    const d = dataFor(teamId);
    try {
      if (team || !d.team) d.team = await s.getTeam(teamId);
      const r = await s.changes(teamId, d.cursors, { events });
      for (const t of r.tasks) d.tasks[t.id] = t;
      for (const e of r.events) d.events[e.id] = e;
      d.cursors = r.cursors;
    } catch (e) {
      if (e.code === 'forbidden') { dropTeam(teamId); throw new TeamError('You are no longer in that team.', 'forbidden'); } // removed by the head
      throw e;
    }
  }
  function dropTeam(teamId) {
    model.teams = model.teams.filter(t => t.id !== teamId);
    delete model.data[teamId];
    if (model.activeTeamId === teamId) model.activeTeamId = model.teams[0] ? model.teams[0].id : null;
  }
  function adopt(team) {
    model.teams = [...model.teams.filter(t => t.id !== team.id), team];
    model.activeTeamId = team.id;
    dataFor(team.id).team = team;
  }

  // opts.full: also look at events and the member list; opts.teams: reload which teams I am in.
  function refresh(opts = {}) {
    return action(async () => {
      const s = await theStore();
      if (opts.teams || !model.teams.length) {
        model.teams = await s.myTeams();
        if (!model.teams.some(t => t.id === model.activeTeamId)) model.activeTeamId = model.teams[0] ? model.teams[0].id : null;
      }
      if (model.activeTeamId) await syncTeam(model.activeTeamId, { events: opts.full || polls % EVENTS_EVERY === 0, team: opts.full || polls % TEAM_EVERY === 0 });
      model.syncedAt = new Date().toISOString();
    });
  }

  // ---- actions ----
  const withActive = async fn => {
    if (!model.activeTeamId) throw new TeamError('Join or create a team first.');
    const s = await theStore();
    return fn(s, model.activeTeamId, dataFor(model.activeTeamId));
  };

  const api = {
    state: snapshot,
    flush,
    refresh,

    createTeam: name => action(async () => {
      adopt(await (await theStore()).createTeam(name));
      await syncTeam(model.activeTeamId, { events: true, team: false });
    }),
    joinTeam: code => action(async () => {
      adopt(await (await theStore()).joinTeam(code));
      await syncTeam(model.activeTeamId, { events: true, team: false });
    }),
    selectTeam: teamId => action(async () => {
      if (!model.teams.some(t => t.id === teamId)) throw new TeamError('Team not found.', 'not-found');
      model.activeTeamId = teamId;
      await syncTeam(teamId, { events: true, team: true });
    }),
    leaveTeam: () => action(() => withActive(async (s, id) => { await s.leaveTeam(id); dropTeam(id); })),
    rotateInvite: () => action(() => withActive(async (s, id, d) => { d.team = await s.rotateInvite(id); })),
    removeMember: uid => action(() => withActive(async (s, id, d) => { d.team = await s.removeMember(id, uid); })),
    setRole: (uid, role) => action(() => withActive(async (s, id, d) => { d.team = await s.setRole(id, uid, role); })),

    createTask: input => action(() => withActive(async (s, id, d) => { const t = await s.createTask(id, input); d.tasks[t.id] = t; })),
    updateTask: (taskId, patch) => action(() => withActive(async (s, id, d) => {
      const t = await s.updateTask(id, taskId, patch, { team: d.team, task: d.tasks[taskId] });
      d.tasks[t.id] = t;
    })),
    createEvent: input => action(() => withActive(async (s, id, d) => { const e = await s.createEvent(id, input); d.events[e.id] = e; })),
    updateEvent: (eventId, input) => action(() => withActive(async (s, id, d) => { const e = await s.updateEvent(id, eventId, input, { team: d.team, event: d.events[eventId] }); d.events[e.id] = e; })),
    deleteEvent: eventId => action(() => withActive(async (s, id, d) => { const e = await s.deleteEvent(id, eventId, { team: d.team, event: d.events[eventId] }); d.events[e.id] = e; })),

    // Someone signed out (or was replaced): forget their local copy so the next person on this PC never sees it.
    forget(uid) {
      if (!uid) return;
      const c = readCache();
      if (c.users && c.users[uid]) { delete c.users[uid]; try { fs.writeFileSync(cacheFile(), JSON.stringify(c)); } catch { /* ignore */ } }
      if (model.uid === uid) { clearTimeout(saveTimer); model = emptyModel(null); store = null; error = null; polls = 0; }
      notify(snapshot());
    },

    // The window came back into focus: catch up, but not more than once in a while.
    focus() {
      if (!model.activeTeamId || !ensureUser() || !canSync() || Date.now() - lastRefreshAt < 20_000) return;
      refresh({ full: true });
    },

    // Checks for changes on a schedule, only while the window is in use.
    start() {
      if (timer) return;
      timer = setTimer(() => {
        if (!isActive() || !model.activeTeamId || !ensureUser() || !canSync()) return;
        polls++;
        refresh();
      }, intervalMs);
      timer.unref?.();
    },
    stop() { if (timer) { clearTimer(timer); timer = null; } },
  };
  return api;
}

module.exports = { createTeamService, POLL_MS };

  }
  };
  const cache = {};
  const norm = id => id.replace(/^\.\//, '').replace(/\.js$/, '') + '.js';
  function load(name) {
    const want = norm(name);
    const keys = Object.keys(defs);
    const plain = k => k.replace(/^\.\//, '');
    // a relative name from inside app/ ("./calendar-logic") is matched by its file name
    const key = keys.find(k => plain(k) === want) || keys.find(k => plain(k).split('/').pop() === want.split('/').pop());
    if (!key) throw new Error('Unknown module ' + name);
    if (cache[key]) return cache[key].exports;
    const module = cache[key] = { exports: {} };
    defs[key].call(module.exports, module, module.exports, req);
    return module.exports;
  }
  function req(id) {
    if (id === 'node:fs') return nodeFs;
    if (id === 'node:path') return nodePath;
    if (id === 'node:crypto') return nodeCrypto;
    return load(id);
  }
  window.VayunWebTeam = { createTeamService: load('./team-service.js').createTeamService, FirestoreTeamStore: load('./team-store-firestore.js').FirestoreTeamStore };
})();
