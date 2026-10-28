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
  constructor({ project, getToken, me, fetch: fetchImpl = globalThis.fetch }) {
    this.project = project;
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
  _url(suffix) { return `${R.BASE}/${R.docsRoot(this.project)}${suffix}`; }
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

  async _team(teamId) {
    const t = await this._get(`teams/${teamId}`);
    if (!t) throw new TeamError('Team not found.', 'not-found');
    return this._shapeTeam(t);
  }
  _shapeTeam(t) { return { ...t, memberIds: t.memberIds || [], members: t.members || {} }; }
  async _headTeam(teamId, what) {
    const t = await this._team(teamId);
    if (!T.isHead(t, this._me().uid)) throw new TeamError(`Only the team head can ${what}.`, 'forbidden');
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
      R.createWrite(this.project, `teams/${id}`, { name: n.name, headUid: me.uid, memberIds: [me.uid], members: { [me.uid]: this._profile('head') }, inviteCode: code }, { serverTime: ['createdAt', 'updatedAt'] }),
      R.createWrite(this.project, `invites/${code}`, { teamId: id, headUid: me.uid }, { serverTime: ['createdAt'] }),
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
    if (T.isHead(t, uid)) throw new TeamError('The head cannot leave the team.', 'forbidden');
    await this._removeFromTeam(teamId, uid);
  }

  async removeMember(teamId, uid) {
    const t = await this._headTeam(teamId, 'remove people');
    if (uid === t.headUid) throw new TeamError('The head cannot be removed.', 'forbidden');
    if (!T.isMember(t, uid)) throw new TeamError('That person is not in the team.', 'not-found');
    await this._removeFromTeam(teamId, uid);
    return this._team(teamId);
  }

  _removeFromTeam(teamId, uid) {
    return this._commit([R.patchWrite(this.project, `teams/${teamId}`, { remove: [['members', uid]], serverTime: ['updatedAt'], arrayRemove: [['memberIds', [uid]]] })]);
  }

  async rotateInvite(teamId) {
    const t = await this._headTeam(teamId, 'make a new invite code');
    const code = T.inviteCodeFrom(crypto.randomBytes(8));
    await this._commit([
      R.createWrite(this.project, `invites/${code}`, { teamId, headUid: t.headUid }, { serverTime: ['createdAt'] }),
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
    const t = await this._headTeam(teamId, 'add tasks');
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
    const r = T.checkTaskPatch(t, this._me().uid, task, patch);
    if (r.error) throw new TeamError(r.error, 'forbidden');
    await this._commit([R.patchWrite(this.project, `teams/${teamId}/tasks/${taskId}`, { set: Object.entries(r.patch).map(([k, v]) => [[k], v]), serverTime: ['updatedAt'] })]);
    return { ...(await this._get(`teams/${teamId}/tasks/${taskId}`)), teamId };
  }

  // ---- team calendar events (made by the head) ----
  async createEvent(teamId, input) {
    const t = await this._team(teamId);
    const v = T.normalizeTeamEventInput(input, t, this._me().uid);
    if (v.error) throw new TeamError(v.error, T.isHead(t, this._me().uid) ? 'invalid' : 'forbidden');
    const id = this._id();
    await this._commit([R.createWrite(this.project, `teams/${teamId}/events/${id}`, { ...v, createdBy: this._me().uid, deleted: false }, { serverTime: ['createdAt', 'updatedAt'] })]);
    return { ...(await this._get(`teams/${teamId}/events/${id}`)), teamId };
  }

  async updateEvent(teamId, eventId, input) {
    const t = await this._team(teamId);
    const v = T.normalizeTeamEventInput(input, t, this._me().uid);
    if (v.error) throw new TeamError(v.error, T.isHead(t, this._me().uid) ? 'invalid' : 'forbidden');
    await this._commit([R.patchWrite(this.project, `teams/${teamId}/events/${eventId}`, { set: Object.entries(v).map(([k, val]) => [[k], val]), serverTime: ['updatedAt'] })]);
    return { ...(await this._get(`teams/${teamId}/events/${eventId}`)), teamId };
  }

  async deleteEvent(teamId, eventId) {
    await this._headTeam(teamId, 'remove team events');
    await this._commit([R.patchWrite(this.project, `teams/${teamId}/events/${eventId}`, { set: [[['deleted'], true]], serverTime: ['updatedAt'] })]);
    return { ...(await this._get(`teams/${teamId}/events/${eventId}`)), teamId };
  }
}

module.exports = { FirestoreTeamStore };
