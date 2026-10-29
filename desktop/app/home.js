// Home: the landing screen that opens every time Vayun opens. It shows what needs you today (must-do tasks,
// overdue work, what is due, important work, today's calendar), your own reminders and the pages you pinned.
// What is shown is worked out in home-logic.js; this file only draws it and handles the clicks.
(function (root) {
  const { h } = root.FolioUI;
  const H = root.FolioHomeLogic;
  const C = root.FolioCalLogic;
  const today = () => C.dayKey(new Date());
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortDate = d => { const [, m, day] = d.split('-').map(Number); return `${MONTHS[m - 1]} ${day}`; };
  const TONE = { mustdo: 'tone-must', attention: 'tone-must', overdue: 'tone-late', soon: 'tone-soon', important: 'tone-imp', calendar: 'tone-cal' };

  // One listener for the window; it reaches whichever Home page is mounted.
  let onHomeTeam = null;
  root.api?.on('team:changed', s => onHomeTeam?.(s));

  // The reminder popup lives on the window, so it stays when the person moves to another page. One at a time.
  let toastEl = null, snoozeTimer = null, toastDone = false;
  function closePopup() { if (toastEl) { toastEl.remove(); toastEl = null; } }
  function popup({ label, title, note, open, snooze }) {
    closePopup(); clearTimeout(snoozeTimer);
    const close = () => closePopup();
    toastEl = h('div', { class: 'home-toast', role: 'status', onkeydown: e => { if (e.key === 'Escape') close(); } },
      h('div', { class: 'home-toast-head' },
        h('div', {}, h('p', { class: 'home-eyebrow late' }, label), h('p', { class: 'home-toast-title' }, title), note ? h('p', { class: 'home-toast-note' }, note) : ''),
        h('button', { type: 'button', class: 'home-toast-x', 'aria-label': 'Close reminder', onclick: close }, '✕')),
      h('div', { class: 'home-toast-actions' },
        h('button', { type: 'button', class: 'home-open primary', onclick: () => { close(); open(); } }, 'Open task'),
        h('button', { type: 'button', class: 'home-open', onclick: () => { close(); snooze(); } }, 'Snooze 1 hour')));
    document.body.append(toastEl);
  }

  // ctx: { data(): the workspace, home(): its Home settings (changed in place), save(), openPage(id), openCalendar(),
  //        openTeam(), markRowDone(id) }
  function mount(host, page, ctx) {
    const api = root.api;
    let alive = true;
    let team = null; // team snapshot from the main process
    let google = []; // today's Google Calendar events, if linked
    let userName = '';
    let customizing = false;
    host.innerHTML = '';
    host.className = 'homepage';

    const greeting = () => { const hr = new Date().getHours(); return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; };
    const fail = r => { if (r && r.error) alert(r.error); return !(r && r.error); };

    function compute() {
      const data = ctx.data(), home = ctx.home();
      const calPage = data.pages.find(p => p.kind === 'calendar');
      return H.build({
        today: today(), uid: team && team.uid ? team.uid : '',
        team: team && team.team ? { tasks: team.tasks, events: team.events, team: team.team, role: team.role } : null,
        rows: H.rowsFromPages(data.pages),
        reminders: home.reminders, localEvents: calPage && Array.isArray(calPage.events) ? calPage.events : [], googleEvents: google,
        pins: home.pins, pages: data.pages, hidden: home.hidden,
      });
    }

    const openItem = it => {
      if (it.ref.type === 'team-task') ctx.openTeam();
      else if (it.ref.type === 'row' || it.ref.type === 'page') ctx.openPage(it.ref.id);
      else if (it.ref.type === 'event') ctx.openCalendar();
    };
    const dueText = it => it.dueDate ? (it.dueDate < today() ? 'Overdue · ' : it.dueDate === today() ? 'Today · ' : '') + shortDate(it.dueDate) : '';

    // ---- the buttons that finish or start an item (used on the focus card and in the lists) ----
    function itemActions(sec, it) {
      let actions = '';
      if (it.kind === 'task' && sec.id !== 'attention') {
        actions = [
          it.status === 'todo' && h('button', { type: 'button', class: 'cal-link', onclick: async () => fail(await api.teamUpdateTask(it.ref.id, { status: 'doing' })) }, 'Start'),
          h('button', { type: 'button', class: 'home-done', onclick: async () => fail(await api.teamUpdateTask(it.ref.id, { status: 'done' })) }, 'Done'),
        ];
      } else if (it.kind === 'row') {
        actions = h('button', { type: 'button', class: 'home-done', onclick: () => { ctx.markRowDone(it.ref.id); draw(); } }, 'Done');
      } else if (it.kind === 'reminder') {
        actions = [
          h('button', { type: 'button', class: 'home-done', onclick: () => { const r = ctx.home().reminders.find(x => x.id === it.ref.id); if (r) r.done = true; ctx.save(); draw(); } }, 'Done'),
          h('button', { type: 'button', class: 'cal-link', title: 'Remove', onclick: () => { const home = ctx.home(); home.reminders = home.reminders.filter(x => x.id !== it.ref.id); ctx.save(); draw(); } }, '✕'),
        ];
      } else if (it.kind === 'page') {
        actions = h('button', { type: 'button', class: 'cal-link', title: 'Unpin from Home', onclick: () => { const home = ctx.home(); home.pins = home.pins.filter(x => x !== it.ref.id); ctx.save(); draw(); } }, '✕');
      }
      return actions;
    }

    // ---- one line in a section ----
    function itemRow(sec, it) {
      const overdue = it.dueDate && it.dueDate < today();
      const due = it.dueDate ? h('span', { class: `home-due${overdue ? ' late' : ''}` }, dueText(it)) : '';
      const colorTag = it.color ? h('span', { class: 'home-tag-dot', style: `background-color:${it.color};` }) : '';
      const title = h('button', { type: 'button', class: 'home-item-title', onclick: () => openItem(it), disabled: it.kind === 'reminder' }, it.mustDo ? h('span', { class: 'team-must' }, 'Must do') : '', colorTag, it.title);
      return h('div', { class: `home-item${it.kind === 'reminder' ? ' static' : ''}` },
        it.kind === 'event' ? h('span', { class: 'home-time' }, it.time) : '',
        h('div', { class: 'home-item-main' }, title, h('div', { class: 'home-sub' }, it.sub || '')),
        due, h('span', { class: 'home-actions' }, itemActions(sec, it)));
    }

    function sectionCard(sec) {
      return h('section', { class: `home-card ${TONE[sec.id] || ''}` },
        h('h2', {}, sec.title, h('span', { class: 'home-count' }, String(sec.items.length + sec.more))),
        sec.items.map(it => itemRow(sec, it)),
        sec.more ? h('p', { class: 'small home-more' }, `+ ${sec.more} more on the Team page`) : '');
    }

    // ---- the dark "start here" card and the three small counts beside it ----
    const FOCUS_LABEL = { mustdo: 'Start here · Must do', overdue: 'Start here · Overdue', soon: 'Start here · Due soon', important: 'Start here · Important' };
    function focusCard(focus) {
      const it = focus.item;
      return h('section', { class: 'home-focus' },
        h('div', {},
          h('p', { class: 'home-eyebrow' }, FOCUS_LABEL[focus.sectionId]),
          h('h2', {}, it.title),
          h('p', { class: 'home-focus-sub' }, [it.sub, dueText(it)].filter(Boolean).join(' · '))),
        h('div', { class: 'home-focus-actions' }, itemActions({ id: focus.sectionId }, it), it.kind === 'reminder' ? '' : h('button', { type: 'button', class: 'home-open', onclick: () => openItem(it) }, 'Open')));
    }
    const stat = (label, n, note, tone) => h('div', { class: `home-stat${tone ? ' ' + tone : ''}` },
      h('div', {}, h('p', { class: 'home-eyebrow' }, label), h('p', { class: 'home-stat-n' }, String(n))), h('span', {}, note));

    // ---- the reminder popup: shown once when Vayun opens, and again after a snooze ----
    function toastFor(r) {
      if (!r.focus || !(r.summary.mustDo || r.summary.overdue)) return false;
      const it = r.focus.item;
      const more = r.summary.needYou - 1;
      popup({
        label: r.focus.sectionId === 'mustdo' ? 'Must do' + (it.dueDate ? ' · ' + (it.dueDate === today() ? 'due today' : dueText(it).replace('Overdue · ', 'overdue since ')) : '') : dueText(it) || 'Overdue',
        title: it.title,
        note: more > 0 ? `and ${more} more ${more === 1 ? 'thing needs' : 'things need'} you today.` : (it.sub || ''),
        open: () => openItem(it),
        snooze: () => { snoozeTimer = setTimeout(() => toastFor(compute()), 60 * 60 * 1000); },
      });
      return true;
    }

    // ---- the whole screen ----
    function addForm() {
      const text = h('input', { type: 'text', maxlength: '200', placeholder: 'Add a reminder for yourself…', 'aria-label': 'New reminder' });
      const date = h('input', { type: 'date', 'aria-label': 'Reminder date' });
      const err = h('span', { class: 'team-error' });
      return h('form', { class: 'home-add', onsubmit: e => {
        e.preventDefault();
        const v = H.normalizeReminder({ text: text.value, date: date.value });
        if (v.error) { err.textContent = v.error; return; }
        ctx.home().reminders.push({ id: crypto.randomUUID().slice(0, 8), text: v.text, date: v.date, done: false, createdAt: Date.now() });
        ctx.save(); draw();
      } }, text, date, h('button', { type: 'submit', class: 'cal-new' }, 'Add'), err);
    }

    function customizePanel() {
      const home = ctx.home();
      return h('div', { class: 'home-custom' },
        h('p', { class: 'small' }, 'Choose what this screen shows. To add a page here, open it and use ••• → Pin to Home.'),
        H.SECTIONS.map(s => h('label', { class: 'home-custom-row' },
          h('input', { type: 'checkbox', checked: !home.hidden.includes(s.id), onchange: e => { home.hidden = e.target.checked ? home.hidden.filter(x => x !== s.id) : [...home.hidden, s.id]; ctx.save(); draw(); } }),
          h('span', {}, h('strong', {}, s.title), h('span', { class: 'small' }, ' — ' + s.hint)))));
    }

    function draw() {
      if (!alive) return;
      const r = compute();
      const s = r.summary;
      const parts = [s.mustDo && `${s.mustDo} must do`, s.overdue && `${s.overdue} overdue`, s.dueSoon && `${s.dueSoon} due today or tomorrow`].filter(Boolean);
      const line = s.needYou ? `${s.needYou} ${s.needYou === 1 ? 'thing needs' : 'things need'} you: ${parts.join(' · ')}` : 'Nothing is overdue or due soon.';
      // the focus card shows the lead item, so the lists below leave it out
      const fk = r.focus && r.focus.item.key;
      const lists = r.sections.map(sec => ({ ...sec, items: sec.items.filter(i => i.key !== fk) })).filter(sec => sec.items.length || sec.more);
      host.innerHTML = '';
      host.append(
        h('div', { class: 'home-hero' },
          h('div', {},
            h('p', { class: 'home-eyebrow' }, new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })),
            h('h1', {}, userName ? `${greeting()}, ${userName}` : greeting()),
            h('p', { class: `home-summary${s.needYou ? ' urgent' : ''}` }, line + (s.events ? ` · ${s.events} event${s.events === 1 ? '' : 's'} today` : ''))),
          h('button', { type: 'button', class: 'home-open', onclick: () => { customizing = !customizing; draw(); } }, customizing ? 'Done customizing' : 'Customize')),
        customizing ? customizePanel() : '',
        r.focus ? h('div', { class: 'home-top' }, focusCard(r.focus), h('div', { class: 'home-stats' },
          stat('Overdue', s.overdue, 'needs a decision', s.overdue ? 'late' : ''), stat('Due soon', s.dueSoon, 'today and tomorrow'), stat('Today', s.events, s.events === 1 ? 'event' : 'events'))) : '',
        r.empty
          ? h('div', { class: 'home-clear' }, h('h2', {}, 'You’re all clear'), h('p', {}, 'Nothing needs you right now. Add a reminder below, or pin a page with ••• → Pin to Home.'))
          : h('div', { class: 'home-grid' }, lists.map(sectionCard)),
        addForm());
      if (teamReady && !toastDone && toastFor(r)) toastDone = true; // once per session, as soon as there is something to say
    }

    let teamReady = false; // the popup waits until the team's tasks have arrived (or we know there are none to wait for)
    onHomeTeam = snapshot => { team = snapshot; draw(); };
    draw();
    api.authStatus().then(st => { if (!alive) return; const n = (st && st.user && (st.user.displayName || st.user.email)) || ''; userName = String(n).split(/[ @]/)[0]; draw(); }).catch(() => {});
    api.teamState().then(s => {
      if (!alive) return;
      team = s;
      const stale = !s.syncedAt || Date.now() - Date.parse(s.syncedAt) > 20000;
      const refreshing = s.signedIn && s.canSync && stale;
      teamReady = !refreshing; draw();
      if (refreshing) Promise.resolve(api.teamRefresh()).catch(() => {}).then(() => { if (!teamReady) { teamReady = true; draw(); } }); // fresh must-dos every time Vayun opens
    });
    api.gcalStatus().then(async st => {
      if (!alive || !st || !st.connected) return;
      const res = await api.gcalList({ from: today(), to: today() });
      if (alive && res && !res.error) { google = res.events || []; draw(); }
    }).catch(() => {});
    return { destroy() { alive = false; onHomeTeam = null; host.innerHTML = ''; host.className = ''; } };
  }

  root.FolioHome = { mount };
})(typeof self !== 'undefined' ? self : globalThis);
