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
