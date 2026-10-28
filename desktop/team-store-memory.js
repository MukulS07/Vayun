// In-memory team backend. It is the reference for how the store interface behaves, it is what the tests
// compare the Firestore version against, and it powers the optional demo mode (VAYUN_TEAM_BACKEND=memory).
// One "server" is shared by many people; each person gets their own view of it with storeFor(me).
const crypto = require('node:crypto');
const T = require('./app/team-logic');
const { TeamError } = require('./team-error');

const copy = o => JSON.parse(JSON.stringify(o));

function createMemoryServer() {
  const teams = new Map();
  const invites = new Map(); // code -> teamId
  const tasks = new Map(); // teamId -> Map(id -> task)
  const events = new Map();
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1) + (++tick) * 1000).toISOString().replace('.000Z', `.${String(tick).padStart(6, '0')}Z`);
  const newCode = () => { let c; do { c = T.inviteCodeFrom(crypto.randomBytes(8)); } while (invites.has(c)); return c; };
  const bucket = (m, teamId) => { if (!m.has(teamId)) m.set(teamId, new Map()); return m.get(teamId); };

  function storeFor(meSource) {
    const me = () => {
      const u = typeof meSource === 'function' ? meSource() : meSource;
      if (!u || !u.uid) throw new TeamError('Sign in to use teams.', 'auth');
      return u;
    };
    const teamFor = teamId => {
      const t = teams.get(teamId);
      if (!t) throw new TeamError('Team not found.', 'not-found');
      return t;
    };
    const memberTeam = teamId => {
      const t = teamFor(teamId);
      if (!T.isMember(t, me().uid)) throw new TeamError('You are not allowed to do that.', 'forbidden');
      return t;
    };
    const headTeam = (teamId, what) => {
      const t = memberTeam(teamId);
      if (!T.isHead(t, me().uid)) throw new TeamError(`Only the team head can ${what}.`, 'forbidden');
      return t;
    };
    const profile = role => { const u = me(); return { name: u.name || u.email || 'Someone', email: u.email || '', photoURL: u.photoURL || '', role }; };

    return {
      async myTeams() { return [...teams.values()].filter(t => T.isMember(t, me().uid)).map(copy); },

      async createTeam(name) {
        const n = T.normalizeTeamName(name);
        if (n.error) throw new TeamError(n.error);
        const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
        const code = newCode();
        const t = { id, name: n.name, headUid: me().uid, memberIds: [me().uid], members: { [me().uid]: profile('head') }, inviteCode: code, createdAt: now(), updatedAt: now() };
        teams.set(id, t);
        invites.set(code, id);
        return copy(t);
      },

      async getTeam(teamId) { return copy(memberTeam(teamId)); },

      async joinTeam(code) {
        const c = T.normalizeInviteCode(code);
        if (!T.isInviteCode(c)) throw new TeamError('That code does not look right. It has 8 letters and numbers.');
        const teamId = invites.get(c);
        if (!teamId) throw new TeamError('No team has that code.', 'not-found');
        const t = teamFor(teamId);
        if (!T.isMember(t, me().uid)) {
          t.memberIds.push(me().uid);
          t.members[me().uid] = profile('member');
          t.updatedAt = now();
        }
        return copy(t);
      },

      async leaveTeam(teamId) {
        const t = memberTeam(teamId);
        if (T.isHead(t, me().uid)) throw new TeamError('The head cannot leave the team.', 'forbidden');
        t.memberIds = t.memberIds.filter(u => u !== me().uid);
        delete t.members[me().uid];
        t.updatedAt = now();
      },

      async removeMember(teamId, uid) {
        const t = headTeam(teamId, 'remove people');
        if (uid === t.headUid) throw new TeamError('The head cannot be removed.', 'forbidden');
        if (!T.isMember(t, uid)) throw new TeamError('That person is not in the team.', 'not-found');
        t.memberIds = t.memberIds.filter(u => u !== uid);
        delete t.members[uid];
        t.updatedAt = now();
        return copy(t);
      },

      async rotateInvite(teamId) {
        const t = headTeam(teamId, 'make a new invite code');
        invites.delete(t.inviteCode);
        t.inviteCode = newCode();
        invites.set(t.inviteCode, t.id);
        t.updatedAt = now();
        return copy(t);
      },

      // Everything that changed since the cursors ({ tasks, events }; empty = first load, which returns only what
      // still exists). Pass { events: false } to leave events out of this check; their cursor stays where it was.
      async changes(teamId, cursors = {}, opts = {}) {
        memberTeam(teamId);
        const pick = (m, cursor) => [...bucket(m, teamId).values()].filter(d => (cursor ? T.cmpTs(d.updatedAt, T.shiftTs(cursor, -120)) >= 0 : !d.deleted)).map(copy);
        const t = pick(tasks, cursors.tasks);
        const e = opts.events === false ? [] : pick(events, cursors.events);
        return {
          tasks: t,
          events: e,
          cursors: {
            tasks: T.maxTs([cursors.tasks || '', ...t.map(d => d.updatedAt)]),
            events: opts.events === false ? (cursors.events || '') : T.maxTs([cursors.events || '', ...e.map(d => d.updatedAt)]),
          },
        };
      },

      async createTask(teamId, input) {
        const t = headTeam(teamId, 'add tasks');
        const v = T.normalizeTaskInput(input, t);
        if (v.error) throw new TeamError(v.error);
        const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
        const task = { id, teamId, ...v, createdBy: me().uid, deleted: false, createdAt: now(), updatedAt: now() };
        bucket(tasks, teamId).set(id, task);
        return copy(task);
      },

      async updateTask(teamId, taskId, patch) {
        const t = memberTeam(teamId);
        const task = bucket(tasks, teamId).get(taskId);
        if (!task) throw new TeamError('Task not found.', 'not-found');
        const r = T.checkTaskPatch(t, me().uid, task, patch);
        if (r.error) throw new TeamError(r.error, 'forbidden');
        Object.assign(task, r.patch, { updatedAt: now() });
        return copy(task);
      },

      async createEvent(teamId, input) {
        const t = memberTeam(teamId);
        const v = T.normalizeTeamEventInput(input, t, me().uid);
        if (v.error) throw new TeamError(v.error, T.isHead(t, me().uid) ? 'invalid' : 'forbidden');
        const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
        const ev = { id, teamId, ...v, createdBy: me().uid, deleted: false, createdAt: now(), updatedAt: now() };
        bucket(events, teamId).set(id, ev);
        return copy(ev);
      },

      async updateEvent(teamId, eventId, input) {
        const t = memberTeam(teamId);
        const ev = bucket(events, teamId).get(eventId);
        if (!ev) throw new TeamError('Event not found.', 'not-found');
        const v = T.normalizeTeamEventInput(input, t, me().uid);
        if (v.error) throw new TeamError(v.error, T.isHead(t, me().uid) ? 'invalid' : 'forbidden');
        Object.assign(ev, v, { updatedAt: now() });
        return copy(ev);
      },

      async deleteEvent(teamId, eventId) {
        headTeam(teamId, 'remove team events');
        const ev = bucket(events, teamId).get(eventId);
        if (!ev) throw new TeamError('Event not found.', 'not-found');
        Object.assign(ev, { deleted: true, updatedAt: now() });
        return copy(ev);
      },
    };
  }

  return { storeFor };
}

// A ready-made team so the Team page can be tried without Firebase (VAYUN_TEAM_BACKEND=memory).
// role "head": the signed-in person leads the team; "member": someone else leads it and they were given tasks.
async function seedDemo(server, me, role = 'head') {
  const C = require('./app/calendar-logic');
  const today = C.dayKey(new Date());
  const priya = { uid: 'demo-priya', name: 'Priya Nair', email: 'priya@example.com' };
  const ana = { uid: 'demo-ana', name: 'Ana Rao', email: 'ana@example.com' };
  const raj = { uid: 'demo-raj', name: 'Raj Mehta', email: 'raj@example.com' };
  const headUser = role === 'head' ? me : priya;
  const [a, b] = role === 'head' ? [ana, raj] : [me, ana];
  const h = server.storeFor(headUser);
  const team = await h.createTeam('Design team');
  await server.storeFor(a).joinTeam(team.inviteCode);
  await server.storeFor(b).joinTeam(team.inviteCode);
  await h.createTask(team.id, { title: 'Draw the launch logo', assigneeUid: a.uid, priority: 'high', dueDate: C.addDays(today, 2), notes: 'Three options, as vector files.' });
  const pricing = await h.createTask(team.id, { title: 'Write the pricing page', assigneeUid: b.uid, priority: 'medium', dueDate: C.addDays(today, 5) });
  await h.createTask(team.id, { title: 'Fix the signup form bug', assigneeUid: a.uid, priority: 'high', dueDate: C.addDays(today, -1) });
  await h.createTask(team.id, { title: 'Collect customer quotes', assigneeUid: b.uid, priority: 'low', dueDate: C.addDays(today, 9) });
  await h.createTask(team.id, { title: 'Update the brand colours', assigneeUid: headUser.uid, priority: 'low' });
  await server.storeFor(b).updateTask(team.id, pricing.id, { status: 'doing' });
  await h.createEvent(team.id, { title: 'Weekly sync', startDate: C.addDays(today, 1), allDay: false, startTime: '10:00', endTime: '10:30' });
  return team;
}

module.exports = { createMemoryServer, seedDemo };
