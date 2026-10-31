// Team page: admins and leads give tasks to people, everyone sees theirs (or the whole team's), sorted and grouped
// however they like. The data comes from the main process (team-service.js) as a snapshot; every action is a
// call to it and the page redraws when the snapshot changes. Rules and sorting live in team-logic.js.
(function (root) {
  const { h } = root.FolioUI;
  const T = root.FolioTeamLogic;
  const C = root.FolioCalLogic;
  const { dialog, field } = root.FolioCalendar;
  const today = () => C.dayKey(new Date());
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortDate = d => { const [, m, day] = d.split('-').map(Number); return `${MONTHS[m - 1]} ${day}`; };
  const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
  const SORTS = [['due', 'Due date'], ['priority', 'Priority'], ['status', 'Status'], ['title', 'Title'], ['updated', 'Recently changed']];

  // Friendlier wording for the few problems people can fix themselves.
  const problem = err => (err.code === 'setup'
    ? 'The team space is not switched on yet. The app owner needs to finish the one-time Firebase setup.'
    : err.message);

  // One listener for the window; it reaches whichever team page is mounted.
  let onTeamChanged = null;
  root.api?.on('team:changed', s => onTeamChanged?.(s));

  function mount(host, page, { onChange }) {
    const api = root.api;
    let S = null; // latest snapshot from the main process
    let alive = true;
    let listBox = null;
    host.innerHTML = '';
    host.className = 'teampage';

    // The page remembers how the list is sorted and filtered. Filled in place, so every part of the page shares one object.
    const VIEW_DEFAULTS = { group: 'none', sort: 'due', dir: 'asc', status: '', hideDone: false, overdue: false, mustDo: false, query: '', showMembers: false, showTools: false };
    const view = () => {
      const v = page.teamView || (page.teamView = {});
      for (const k of Object.keys(VIEW_DEFAULTS)) if (!(k in v)) v[k] = VIEW_DEFAULTS[k];
      return v;
    };
    const canLead = () => Boolean(S && S.role && S.role !== 'member'); // admins and leads give out work
    const isAdmin = () => Boolean(S && S.role === 'admin');
    const scope = () => view().scope || (canLead() ? 'all' : 'mine');
    const save = () => onChange();
    const fail = r => { if (r && r.error) alert(r.error); return !(r && r.error); };

    // ---- small pieces ----
    const notice = (title, text, ...extra) => h('div', { class: 'team-empty' }, h('h2', {}, title), h('p', {}, text), ...extra);
    const memberName = uid => T.nameOf(S.team, uid);
    const avatar = (uid, size) => h('span', { class: `team-avatar${size === 'lg' ? ' lg' : ''}`, title: memberName(uid) }, initials(memberName(uid)));
    const roleBadge = role => h('span', { class: `team-role role-${role}` }, T.ROLE_LABEL[role] || 'Member');

    // ---- setup: no team yet ----
    function setupView() {
      const msg = h('p', { class: 'team-error', role: 'alert' }, S.error ? problem(S.error) : '');
      const show = r => { if (r && r.error) msg.textContent = problem({ code: r.code, message: r.error }); };
      const name = h('input', { type: 'text', placeholder: 'Team name, for example Design team', maxlength: '60', 'aria-label': 'Team name' });
      const code = h('input', { type: 'text', placeholder: 'Invite code, for example K7M2QX9A', maxlength: '12', spellcheck: 'false', 'aria-label': 'Invite code' });
      const create = h('form', { class: 'team-card', onsubmit: async e => { e.preventDefault(); show(await api.teamCreate(name.value)); } },
        h('h3', {}, 'Start a team'), h('p', { class: 'small' }, 'You become its owner and first admin: you set roles, give tasks and add team events.'), name, h('button', { type: 'submit', class: 'cal-new' }, 'Create team'));
      const join = h('form', { class: 'team-card', onsubmit: async e => { e.preventDefault(); show(await api.teamJoin(code.value)); } },
        h('h3', {}, 'Join a team'), h('p', { class: 'small' }, 'Ask a team admin for the invite code. You join as a member.'), code, h('button', { type: 'submit', class: 'cal-new' }, 'Join'));
      return h('div', {}, h('h2', { class: 'team-title' }, 'Team'), h('p', { class: 'team-lead' }, 'Share tasks and a calendar with the people you work with. Your personal pages stay on this PC.'),
        h('div', { class: 'team-cards' }, create, join), msg);
    }

    // ---- header, controls ----
    function headerView() {
      const v = view();
      const open = S.tasks.filter(t => t.status !== 'done' && (scope() === 'all' || t.assigneeUid === S.uid));
      const late = open.filter(t => T.isOverdue(t, today())).length;
      const sync = S.syncing ? 'Syncing…' : S.syncedAt ? `Updated ${new Date(S.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
      return h('div', { class: 'team-head' },
        h('div', { class: 'team-head-top' },
          S.teams.length > 1
            ? h('select', { class: 'team-switch', 'aria-label': 'Team', onchange: async e => fail(await api.teamSelect(e.target.value)) }, S.teams.map(t => h('option', { value: t.id, selected: t.id === S.team.id }, t.name)))
            : h('h2', { class: 'team-title' }, S.team.name),
          canLead() && h('button', { type: 'button', class: 'team-add', onclick: () => editTask(null) }, '+ New task')),
        h('div', { class: 'team-head-sub' },
          h('span', { class: 'team-count' }, roleBadge(S.role), ` ${open.length} open`, late ? h('b', { class: 'late' }, ` · ${late} overdue`) : ''),
          h('span', { class: 'team-head-links' },
            S.error ? '' : h('span', { class: 'team-sync' }, sync),
            h('button', { type: 'button', class: 'team-link', onclick: async () => fail(await api.teamRefresh()), disabled: S.syncing }, 'Refresh'),
            h('button', { type: 'button', class: 'team-link team-people-btn', 'aria-expanded': String(Boolean(v.showMembers)), onclick: () => { v.showMembers = !v.showMembers; save(); draw(); } }, v.showMembers ? 'Hide people' : `People · ${S.team.memberIds.length}`))),
        S.error ? h('p', { class: 'team-error', role: 'alert' }, problem(S.error)) : '');
    }

    function toolbarView() {
      const v = view();
      const again = () => { save(); draw(); };
      const scoped = scope() === 'mine' ? S.tasks.filter(t => t.assigneeUid === S.uid) : S.tasks;
      const lateN = scoped.filter(t => t.status !== 'done' && T.isOverdue(t, today())).length;
      const mustN = scoped.filter(t => t.mustDo && t.status !== 'done').length;
      const chip = (label, key, n) => h('button', { type: 'button', class: `team-chip${v[key] ? ' on' : ''}`, 'aria-pressed': String(Boolean(v[key])), onclick: () => { v[key] = !v[key]; again(); } },
        label, n ? h('span', { class: 'team-chip-n' }, String(n)) : '');
      const sel = (label, value, options, set) => h('label', { class: 'team-field' }, h('span', {}, label),
        h('select', { 'aria-label': label, onchange: e => { set(e.target.value); save(); drawList(); } }, options.map(([val, text]) => h('option', { value: val, selected: val === value }, text))));
      const activeTools = [v.group !== 'none', v.sort !== 'due', v.dir !== 'asc', v.status !== ''].filter(Boolean).length;
      const query = h('input', { type: 'search', class: 'team-search', placeholder: 'Search tasks…', value: v.query, 'aria-label': 'Search tasks', oninput: e => { v.query = e.target.value; save(); drawList(); } });
      return h('div', { class: 'team-filters' },
        h('div', { class: 'cal-seg team-scope', role: 'group', 'aria-label': 'Whose tasks' },
          [['mine', 'My tasks'], ['all', 'Everyone']].map(([k, label]) => h('button', { type: 'button', class: scope() === k ? 'on' : '', 'aria-pressed': String(scope() === k), onclick: () => { v.scope = k; again(); } }, label))),
        query,
        h('div', { class: 'team-chips' },
          chip('Overdue', 'overdue', lateN), chip('Must do', 'mustDo', mustN), chip('Hide done', 'hideDone', 0),
          h('button', { type: 'button', class: `team-chip team-tools-btn${v.showTools ? ' on' : ''}`, 'aria-expanded': String(Boolean(v.showTools)), onclick: () => { v.showTools = !v.showTools; again(); } },
            'Sort & group', activeTools ? h('span', { class: 'team-chip-n' }, String(activeTools)) : '')),
        v.showTools ? h('div', { class: 'team-tools' },
          sel('Group by', v.group, [['none', 'None'], ['assignee', 'Person'], ['status', 'Status']], x => { v.group = x; }),
          sel('Sort by', v.sort, SORTS, x => { v.sort = x; }),
          sel('Status', v.status, [['', 'Any'], ...T.STATUSES.map(s => [s, T.STATUS_LABEL[s]])], x => { v.status = x; }),
          h('button', { type: 'button', class: 'team-link team-dir', title: 'Reverse the order', onclick: () => { v.dir = v.dir === 'asc' ? 'desc' : 'asc'; again(); } }, v.dir === 'asc' ? '↑ Ascending' : '↓ Descending')) : '');
    }

    // ---- the task list ----
    const NEXT_STATUS = { todo: 'doing', doing: 'done', done: 'todo' };
    function taskRow(t, grouped) {
      const mine = t.assigneeUid === S.uid;
      const manage = T.canManageTask(S.team, S.uid, t); // an admin, or the lead who created it
      const canStatus = manage || mine;
      const overdue = T.isOverdue(t, today()) && t.status !== 'done';
      const first = memberName(t.assigneeUid).split(' ')[0];
      const tick = h('button', { type: 'button', class: `team-tick st-${t.status}`, disabled: !canStatus,
        'aria-label': `${t.title}: ${T.STATUS_LABEL[t.status]}. Tap to mark as ${T.STATUS_LABEL[NEXT_STATUS[t.status]]}`,
        title: canStatus ? `Mark as ${T.STATUS_LABEL[NEXT_STATUS[t.status]]}` : 'Only the person it is given to, or whoever manages it, can change this',
        onclick: async () => { if (!fail(await api.teamUpdateTask(t.id, { status: NEXT_STATUS[t.status] }))) draw(); } }, h('span', { class: 'team-tick-in' }));
      return h('div', { class: `team-task${t.status === 'done' ? ' done' : ''}${overdue ? ' overdue' : ''}${t.mustDo && t.status !== 'done' ? ' mustdo' : ''}` },
        tick,
        h('div', { class: 'team-task-top' },
          h('div', { class: 'team-task-title' }, t.mustDo && t.status !== 'done' ? h('span', { class: 'team-must', title: 'Stays on their landing screen until it is done' }, 'Must do') : '', t.title),
          manage ? h('button', { type: 'button', class: 'team-edit', onclick: () => editTask(t) }, 'Edit') : ''),
        t.notes && h('div', { class: 'team-task-notes' }, t.notes.length > 140 ? t.notes.slice(0, 140) + '…' : t.notes),
        h('div', { class: 'team-task-meta' },
          h('span', { class: `team-st st-${t.status}` }, T.STATUS_LABEL[t.status]),
          h('span', { class: `team-prio prio-${t.priority}` }, h('i'), PRIORITY_LABEL[t.priority]),
          t.dueDate ? h('span', { class: 'team-due' }, `${overdue ? 'Overdue · ' : ''}${shortDate(t.dueDate)}`) : h('span', { class: 'team-due none' }, 'No date'),
          h('span', { class: 'team-assignee', title: memberName(t.assigneeUid) }, avatar(t.assigneeUid), grouped === 'assignee' ? '' : first)));
    }

    function drawList() {
      if (!alive || !listBox) return;
      const v = view();
      const mineOnly = scope() === 'mine' ? S.uid : '';
      const filtered = T.filterTasks(S.tasks, { assigneeUid: mineOnly, status: v.status, hideDone: v.hideDone, overdueOnly: v.overdue, mustDoOnly: v.mustDo, query: v.query }, today());
      const sorted = T.sortTasks(filtered, v.sort, v.dir);
      const keepEmpty = v.group === 'assignee' && canLead() && scope() === 'all';
      const groups = T.groupTasks(sorted, v.group, S.team).filter(g => v.group === 'none' || g.tasks.length || keepEmpty || v.group === 'status');
      listBox.innerHTML = '';
      if (!sorted.length && v.group === 'none') {
        listBox.append(h('p', { class: 'team-none' }, S.tasks.length ? 'No tasks match these filters.' : canLead() ? 'No tasks yet. Use “+ New task” to give one to someone.' : 'Nothing has been given to you yet.'));
        return;
      }
      for (const g of groups) {
        if (g.label) listBox.append(h('h3', { class: 'team-group' }, g.label, h('span', { class: 'small' }, ` ${g.tasks.length}`)));
        if (!g.tasks.length) listBox.append(h('p', { class: 'team-none' }, 'No tasks.'));
        for (const t of g.tasks) listBox.append(taskRow(t, v.group));
      }
    }

    // ---- people panel ----
    function membersView() {
      const admin = isAdmin();
      const open = uid => S.tasks.filter(t => t.assigneeUid === uid && t.status !== 'done').length;
      const rank = u => ({ admin: 0, lead: 1, member: 2 }[T.roleOf(S.team, u)] ?? 3);
      const people = [...S.team.memberIds].sort((a, b) => (rank(a) - rank(b)) || memberName(a).localeCompare(memberName(b)));
      const copy = h('button', { type: 'button', class: 'cal-link', onclick: () => { navigator.clipboard?.writeText(S.team.inviteCode); copy.textContent = 'Copied'; } }, 'Copy');
      const owner = uid => T.isOwner(S.team, uid);
      const roleControl = uid => {
        if (!admin || owner(uid)) return roleBadge(T.roleOf(S.team, uid));
        return h('select', { class: 'team-role-pick', 'aria-label': `Role of ${memberName(uid)}`, onchange: async e => { if (!fail(await api.teamSetRole(uid, e.target.value))) draw(); } },
          T.ROLES.map(r => h('option', { value: r, selected: r === T.roleOf(S.team, uid) }, T.ROLE_LABEL[r])));
      };
      return h('div', { class: 'team-members' },
        h('h3', {}, `People (${people.length})`),
        h('p', { class: 'small team-rolehelp' }, 'Admin: everything. Lead: gives tasks and team events, and edits what they made. Member: changes the status of their own tasks.'),
        admin && h('div', { class: 'team-invite' }, 'Invite code ', h('code', {}, S.team.inviteCode), copy,
          h('button', { type: 'button', class: 'cal-link', onclick: async () => { if (confirm('Make a new invite code? The old one stops working.')) fail(await api.teamRotateInvite()); } }, 'New code')),
        ...people.map(uid => h('div', { class: 'team-person' }, avatar(uid, 'lg'),
          h('div', { class: 'team-person-main' }, h('div', {}, memberName(uid), owner(uid) ? h('span', { class: 'small team-owner' }, ' · owner') : ''),
            h('div', { class: 'small' }, `${S.team.members[uid].email || ''} · ${open(uid)} open`)),
          roleControl(uid),
          admin && !owner(uid) ? h('button', { type: 'button', class: 'cal-link', onclick: async () => { if (confirm(`Remove ${memberName(uid)} from the team?`)) fail(await api.teamRemoveMember(uid)); } }, 'Remove') : '')),
        !owner(S.uid) && h('button', { type: 'button', class: 'cal-del-btn', onclick: async () => { if (confirm('Leave this team? You will lose access to its tasks.')) fail(await api.teamLeave()); } }, 'Leave team'));
    }

    // ---- task dialog (admins and leads) ----
    async function editTask(t) {
      const isNew = !t;
      const r = await dialog(isNew ? 'New task' : 'Edit task', (form, done) => {
        const title = h('input', { type: 'text', value: t ? t.title : '', maxlength: '200', 'aria-label': 'Title' });
        const notes = h('textarea', { rows: '3' }); notes.value = t ? t.notes : '';
        const former = t && !T.isMember(S.team, t.assigneeUid); // the person left the team: keep the task theirs until it is given to someone
        const who = h('select', { 'aria-label': 'Give to' },
          former ? h('option', { value: t.assigneeUid, selected: true }, 'Former member (give to someone else)') : '',
          S.team.memberIds.map(uid => h('option', { value: uid, selected: uid === (t ? t.assigneeUid : '') }, memberName(uid) + (uid === S.uid ? ' (you)' : ''))));
        const prio = h('select', {}, T.PRIORITIES.map(p => h('option', { value: p, selected: p === (t ? t.priority : 'medium') }, PRIORITY_LABEL[p])));
        const due = h('input', { type: 'date', value: t ? t.dueDate : '' });
        const status = h('select', {}, T.STATUSES.map(s => h('option', { value: s, selected: s === (t ? t.status : 'todo') }, T.STATUS_LABEL[s])));
        const must = h('input', { type: 'checkbox' }); must.checked = Boolean(t && t.mustDo);
        const err = h('p', { class: 'cal-error', role: 'alert' });
        form.append(field('Title', title), field('Details', notes), h('div', { class: 'cal-pair' }, field('Give to', who), field('Priority', prio)),
          h('div', { class: 'cal-pair' }, field('Due date', due), isNew ? '' : field('Status', status)),
          h('label', { class: 'cal-check' }, must, 'Must do: keep it at the top of their landing screen every day until it is done'), err,
          h('div', { class: 'cal-actions' },
            isNew ? '' : h('button', { type: 'button', class: 'cal-del', onclick: () => done({ action: 'delete' }) }, 'Delete'),
            h('button', { type: 'submit' }, 'Save'), h('button', { type: 'button', onclick: () => done(null) }, 'Cancel')));
        form.onsubmit = ev => {
          ev.preventDefault();
          const value = T.normalizeTaskInput({ title: title.value, notes: notes.value, assigneeUid: who.value, priority: prio.value, dueDate: due.value, status: isNew ? 'todo' : status.value, mustDo: must.checked }, S.team, { keepAssignee: t ? t.assigneeUid : '' });
          if (value.error) { err.textContent = value.error; return; }
          done({ action: 'save', value });
        };
      });
      if (!r) return;
      if (r.action === 'delete') { if (confirm(`Delete "${t.title}"? It disappears for everyone.`)) fail(await api.teamUpdateTask(t.id, { deleted: true })); return; }
      if (isNew) return void fail(await api.teamCreateTask(r.value));
      const patch = Object.fromEntries(Object.entries(r.value).filter(([k, val]) => val !== t[k]));
      if (Object.keys(patch).length) fail(await api.teamUpdateTask(t.id, patch));
    }

    // ---- page ----
    function draw() {
      if (!alive) return;
      host.innerHTML = '';
      listBox = null;
      if (!S) return void host.append(h('p', { class: 'team-none' }, 'Loading…'));
      if (!S.signedIn) return void host.append(notice('Sign in to use teams', 'Teams are shared in real-time with the people you invite.', h('button', { type: 'button', class: 'cal-new auth-btn-google', style: 'margin-top:12px;', onclick: () => api.authSignIn() }, 'Sign in with Google')));
      if (!S.canSync) return void host.append(notice('One more sign-in needed', 'Teams need a fresh sign-in on this PC. It takes a few seconds.', h('button', { type: 'button', class: 'cal-new', onclick: () => api.authSignIn() }, 'Sign in again')));
      if (!S.team) return void host.append(setupView());
      listBox = h('div', { class: 'team-list' });
      host.append(headerView(), view().showMembers ? membersView() : '', toolbarView(), listBox);
      drawList();
    }

    onTeamChanged = snapshot => {
      const searching = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('team-search');
      const wasSetup = S && !S.team;
      S = snapshot;
      if (searching && S.team && !wasSetup) { drawList(); return; } // keep the cursor in the search box
      draw();
    };
    api.teamState().then(s => {
      if (!alive) return;
      onTeamChanged(s);
      const stale = !s.syncedAt || Date.now() - Date.parse(s.syncedAt) > 20000; // opening the page again right away needs no new check
      if (s.signedIn && s.canSync && stale) api.teamRefresh();
    });
    return { destroy() { alive = false; onTeamChanged = null; host.innerHTML = ''; host.className = ''; } };
  }

  root.FolioTeam = { mount };
})(typeof self !== 'undefined' ? self : globalThis);
