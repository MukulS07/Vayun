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

  // Start Firebase at once if a session may already exist, so a returning person is signed in when the page opens.
  firebase().then(() => team.start()).catch(() => {});
})();
