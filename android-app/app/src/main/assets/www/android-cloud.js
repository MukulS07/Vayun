// The cloud parts of Vayun on the web: Google sign-in (Firebase Auth) and Teams (Cloud Firestore), using the same team
// code as the desktop app (web-team.js). It replaces the "not available" answers in web-api.js when the page has Firebase
// settings (web-config.js). Everything here runs in the person's own browser; there is no Vayun server in between.
(function () {
  const cfg = window.VAYUN_WEB_CONFIG || {};
  const api = window.api;
  const { emit } = window.__vayunWeb;
  if (!cfg.apiKey || !window.VayunWebTeam) return; // no Firebase settings in this build: sign-in stays switched off

  const V = '10.12.2';
  const CDN = `https://www.gstatic.com/firebasejs/${V}`;

  // ---- Firebase, loaded only when the person needs it ----
  let fbPromise = null;
  function firebase() {
    if (!fbPromise) {
      fbPromise = (async () => {
        const [appMod, authMod] = await Promise.all([import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`)]);
        const app = appMod.initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, appId: cfg.appId });
        const auth = authMod.getAuth(app);
        await auth.authStateReady();
        authMod.onAuthStateChanged(auth, user => {
          const u = toUser(user);
          emit('auth:changed', u);
          if (u) team.refresh({ full: true, teams: true }).catch(() => {});
        });
        return { auth, A: authMod };
      })().catch(e => { fbPromise = null; throw e; });
    }
    return fbPromise;
  }
  let current = null; // the signed-in person, known synchronously once Firebase has started
  const toUser = u => {
    current = u ? {
      uid: u.uid, email: u.email || '', displayName: u.displayName || (u.email ? u.email.split('@')[0] : 'User'),
      photoURL: u.photoURL || null, providerId: 'google.com',
    } : null;
    return current;
  };

  // ---- teams: the desktop's team service, with the browser's own storage and Firebase token ----
  const { createTeamService, FirestoreTeamStore } = window.VayunWebTeam;
  const team = createTeamService({
    dir: 'web',
    getUser: () => current,
    canSync: () => Boolean(current),
    makeStore: async me => new FirestoreTeamStore({
      project: cfg.projectId, me,
      getToken: async () => { const { auth } = await firebase(); if (!auth.currentUser) throw new Error('Sign in to use teams.'); return auth.currentUser.getIdToken(); },
    }),
    notify: snapshot => emit('team:changed', snapshot),
    isActive: () => document.visibilityState === 'visible' && document.hasFocus(),
  });
  addEventListener('focus', () => team.focus());
  const obj = v => (v && typeof v === 'object' ? v : {});

  const statusOf = () => ({
    isConfigured: true, missing: [], user: current, canSync: Boolean(current),
    config: { projectId: cfg.projectId, authDomain: cfg.authDomain },
  });

  Object.assign(api, {
    authStatus: async () => { await firebase().catch(() => {}); return statusOf(); },
    authSignIn: async () => {
      try {
        const { auth, A } = await firebase();
        const before = current && current.uid;
        const r = await A.signInWithPopup(auth, new A.GoogleAuthProvider());
        toUser(r.user);
        if (before && before !== current.uid) team.forget(before);
        team.start();
        return { ok: true, user: current };
      } catch (e) {
        const code = e && e.code || '';
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return { error: 'Sign-in was cancelled.' };
        if (code === 'auth/popup-blocked') return { error: 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.' };
        if (code === 'auth/unauthorized-domain') return { error: 'This website address is not allowed to sign in yet. Add it under Authentication, Settings, Authorized domains in the Firebase console.' };
        return { error: 'Could not sign in. ' + (e && e.message ? e.message : '') };
      }
    },
    authSignOut: async () => {
      const uid = current && current.uid;
      try { const { auth, A } = await firebase(); await A.signOut(auth); } catch { /* already signed out */ }
      current = null;
      try { sessionStorage.removeItem('vayun-gcal-token'); } catch { /* ignore */ }
      if (uid) team.forget(uid);
      emit('auth:changed', null);
      return { ok: true };
    },
    teamState: async () => { await firebase().catch(() => {}); return team.state(); },
    teamRefresh: async () => { await firebase().catch(() => {}); return team.refresh({ full: true, teams: true }); },
    teamCreate: name => team.createTeam(String(name ?? '')),
    teamJoin: code => team.joinTeam(String(code ?? '')),
    teamSelect: id => team.selectTeam(String(id ?? '')),
    teamLeave: () => team.leaveTeam(),
    teamRotateInvite: () => team.rotateInvite(),
    teamRemoveMember: uid => team.removeMember(String(uid ?? '')),
    teamSetRole: (uid, role) => team.setRole(String(uid ?? ''), String(role ?? '')),
    teamCreateTask: input => team.createTask(obj(input)),
    teamUpdateTask: (id, patch) => team.updateTask(String(id ?? ''), obj(patch)),
    teamCreateEvent: input => team.createEvent(obj(input)),
    teamUpdateEvent: (id, input) => team.updateEvent(String(id ?? ''), obj(input)),
    teamDeleteEvent: id => team.deleteEvent(String(id ?? '')),
  });

  // ---- Google Calendar, through the same Google sign-in (no second client to set up) ----
  // Signing in again with the two Calendar permissions added gives this page a short-lived access token (about an hour).
  // It is kept for this browser tab only. When it runs out the Calendar page shows its Sign in button again.
  const GCAL = 'https://www.googleapis.com/calendar/v3';
  const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
  const TOKEN_KEY = 'vayun-gcal-token';
  const isGoogleId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,1024}$/.test(id);
  const isCalendarId = id => typeof id === 'string' && /^[a-zA-Z0-9_.#@%+-]{1,1024}$/.test(id);
  const readToken = () => { try { const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); return t && t.expires > Date.now() && t.uid === (current && current.uid) ? t : null; } catch { return null; } };
  const gStatus = () => { const t = readToken(); return { isConfigured: true, connected: Boolean(t), email: t ? t.email : '' }; };
  const linkAgain = () => Object.assign(new Error('Google Calendar needs to be linked again. Press Sign in with Google.'), { disconnected: true });

  async function gapi(method, pathname, { query, body } = {}) {
    const t = readToken();
    if (!t) throw linkAgain();
    const r = await fetch(GCAL + pathname + (query ? '?' + new URLSearchParams(query) : ''), {
      method, headers: { Authorization: 'Bearer ' + t.token, Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { sessionStorage.removeItem(TOKEN_KEY); emit('gcal:changed', gStatus()); throw linkAgain(); }
    if (r.status === 204) return {};
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((json.error && json.error.message) || 'Google Calendar error ' + r.status);
    return json;
  }
  const wrap = fn => async (...args) => {
    try { return await fn(...args); } catch (e) { return { error: e.message || 'Could not reach Google Calendar.', disconnected: Boolean(e.disconnected) }; }
  };
  const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const L = () => window.FolioCalLogic; // loaded with the screens, after this file

  Object.assign(api, {
    gcalStatus: async () => { await firebase().catch(() => {}); return gStatus(); },
    gcalConnect: async () => {
      try {
        const { auth, A } = await firebase();
        const provider = new A.GoogleAuthProvider();
        SCOPES.forEach(s => provider.addScope(s));
        if (current && current.email) provider.setCustomParameters({ login_hint: current.email });
        const r = await A.signInWithPopup(auth, provider);
        toUser(r.user);
        const cred = A.GoogleAuthProvider.credentialFromResult(r);
        if (!cred || !cred.accessToken) return { error: 'Google did not give Vayun calendar access. Try again and allow the calendar permissions.' };
        sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: cred.accessToken, uid: r.user.uid, email: r.user.email || '', expires: Date.now() + 55 * 60 * 1000 }));
        const st = gStatus();
        emit('gcal:changed', st);
        team.start();
        return { ok: true, ...st };
      } catch (e) {
        const code = (e && e.code) || '';
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return { error: 'Sign-in was cancelled.' };
        if (code === 'auth/popup-blocked') return { error: 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.' };
        if (code === 'auth/unauthorized-domain') return { error: 'This website address is not allowed to sign in yet. Add it under Authentication, Settings, Authorized domains in the Firebase console.' };
        return { error: 'Could not link Google Calendar. ' + (e && e.message ? e.message : '') };
      }
    },
    gcalDisconnect: async () => { sessionStorage.removeItem(TOKEN_KEY); const st = gStatus(); emit('gcal:changed', st); return st; },
    gcalList: wrap(async range => {
      const C = L();
      if (!C.isDate(range && range.from) || !C.isDate(range && range.to) || range.to < range.from) return { error: 'Bad range.' };
      let calendars = [{ id: 'primary', summary: 'Primary', primary: true }];
      let note = '';
      try {
        const cl = await gapi('GET', '/users/me/calendarList');
        if (Array.isArray(cl.items) && cl.items.length) {
          calendars = cl.items.filter(c => c && c.id && c.selected !== false).map(c => ({ id: c.id, summary: c.summary || c.id, primary: Boolean(c.primary), color: c.backgroundColor || '', accessRole: c.accessRole || 'reader' }));
        }
      } catch (e) {
        if (e.disconnected) throw e;
        if (/403|permission|scope/i.test(e.message || '')) note = 'To see your other calendars (like Family), press Sign in with Google again and allow the calendar permissions.';
      }
      const events = [], seen = new Set();
      const fetchCalendar = async cal => {
        let pageToken;
        for (let i = 0; i < 5; i++) {
          const query = {
            timeMin: new Date(range.from + 'T00:00:00').toISOString(), timeMax: new Date(C.addDays(range.to, 1) + 'T00:00:00').toISOString(),
            singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(pageToken && { pageToken }),
          };
          const r = await gapi('GET', '/calendars/' + encodeURIComponent(cal.id) + '/events', { query });
          for (const g of r.items || []) { const e = C.fromGoogleEvent(g, cal); if (e && !seen.has(e.id)) { seen.add(e.id); events.push(e); } }
          pageToken = r.nextPageToken;
          if (!pageToken) break;
        }
      };
      const results = await Promise.allSettled(calendars.map(fetchCalendar));
      results.forEach((res, i) => { if (res.status === 'rejected' && calendars[i].primary && res.reason && res.reason.disconnected) throw res.reason; });
      return { events, calendars, ...(note && { note }) };
    }),
    gcalCreate: wrap(async (arg, calendarId) => {
      const input = arg && arg.event ? arg.event : arg; const calId = isCalendarId(arg && arg.calendarId || calendarId) ? (arg && arg.calendarId || calendarId) : 'primary';
      const C = L(), e = C.normalizeEventInput(input);
      if (e.error) return e;
      return { event: C.fromGoogleEvent(await gapi('POST', '/calendars/' + encodeURIComponent(calId) + '/events', { body: C.toGoogleEvent(e, zone()) }), { id: calId }) };
    }),
    gcalUpdate: wrap(async (googleId, input, calendarId) => {
      if (googleId && typeof googleId === 'object') { calendarId = googleId.calendarId || calendarId; input = googleId.event; googleId = googleId.googleId; }
      if (!isGoogleId(googleId)) return { error: 'Bad event id.' };
      const calId = isCalendarId(calendarId) ? calendarId : 'primary';
      const C = L(), e = C.normalizeEventInput(input);
      if (e.error) return e;
      const body = C.toGoogleEvent(e, zone());
      if (e.allDay) { body.start.dateTime = null; body.end.dateTime = null; } else { body.start.date = null; body.end.date = null; }
      return { event: C.fromGoogleEvent(await gapi('PATCH', '/calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(googleId), { body }), { id: calId }) };
    }),
    gcalDelete: wrap(async (googleId, calendarId) => {
      if (googleId && typeof googleId === 'object') { calendarId = googleId.calendarId || calendarId; googleId = googleId.googleId; }
      if (!isGoogleId(googleId)) return { error: 'Bad event id.' };
      const calId = isCalendarId(calendarId) ? calendarId : 'primary';
      await gapi('DELETE', '/calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(googleId));
      return { ok: true };
    }),
  });

  // Start Firebase at once if a session may already exist, so a returning person is signed in when the page opens.
  firebase().then(() => team.start()).catch(() => {});
})();
