// Calendar page: month and week grids showing this workspace's events, dated database rows and,
// once linked, the user's primary Google Calendar (two-way). Also supplies the month grid used by
// the database "Calendar" view. Logic lives in calendar-logic.js.
(function (root) {
  const { h } = root.FolioUI;
  const C = root.FolioCalLogic;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MAX_CHIPS = 3;
  const today = () => C.dayKey(new Date());
  const monthLabel = date => { const [y, m] = date.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const shortDay = date => { const [, m, d] = date.split('-').map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${d}`; };

  // Days shown for a view; month grids include the leading/trailing days of the neighbouring months.
  function daysFor(view, anchor) {
    if (view === 'week') return C.weekOf(anchor);
    const [y, m] = anchor.split('-').map(Number);
    return C.monthGrid(y, m - 1).flat();
  }

  function chip(e, onEvent) {
    const time = e.allDay ? '' : e.startTime + ' ';
    return h('button', {
      type: 'button', class: `cal-chip cal-${e.source}`, title: `${time}${e.title}${e.source === 'google' ? ' · Google Calendar' : e.source === 'row' ? ` · ${e.notes}` : ''}`,
      onclick: ev => { ev.stopPropagation(); onEvent(e); },
    }, time && h('span', { class: 'cal-time' }, e.startTime), h('span', { class: 'cal-chip-title' }, e.title));
  }

  // Grid of day cells. opts: { view, anchor, events, onDay(date), onEvent(e), onMore(date) }
  function grid({ view, anchor, events, onDay, onEvent, onMore }) {
    const days = daysFor(view, anchor);
    const byDay = C.eventsByDay(events, days);
    const month = anchor.slice(0, 7), now = today();
    const cells = days.map(d => {
      const list = byDay.get(d) || [];
      const shown = view === 'week' || !onMore ? list : list.slice(0, MAX_CHIPS);
      const rest = list.length - shown.length;
      return h('div', {
        class: `cal-cell${d.slice(0, 7) !== month && view === 'month' ? ' out' : ''}${d === now ? ' today' : ''}`,
        role: 'gridcell', tabindex: '0', 'aria-label': `${shortDay(d)}, ${list.length} event${list.length === 1 ? '' : 's'}`,
        onclick: () => onDay(d),
        onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) onDay(d); },
      },
      h('div', { class: 'cal-date' }, view === 'week' ? `${WEEKDAYS[(new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7]} ${Number(d.slice(8))}` : String(Number(d.slice(8)))),
      shown.map(e => chip(e, onEvent)),
      rest > 0 && h('button', { type: 'button', class: 'cal-more', onclick: ev => { ev.stopPropagation(); onMore(d); } }, `+${rest} more`));
    });
    return h('div', { class: `cal-grid cal-${view}`, role: 'grid' },
      view === 'month' && WEEKDAYS.map(w => h('div', { class: 'cal-head', role: 'columnheader' }, w)),
      cells);
  }

  // Small modal; resolves with what `build` passes to done(), or null when dismissed.
  function dialog(title, build) {
    return new Promise(resolve => {
      const wrap = h('div', { class: 'backdrop visible' });
      const form = h('form', { class: 'panel form cal-form' }, h('h2', {}, title));
      const done = v => { wrap.remove(); resolve(v); };
      wrap.onmousedown = e => { if (e.target === wrap) done(null); };
      form.onkeydown = e => { if (e.key === 'Escape') done(null); };
      build(form, done);
      wrap.append(form);
      document.body.append(wrap);
      form.querySelector('input, select, textarea')?.focus();
    });
  }
  const field = (label, input) => h('label', {}, label, input);

  // Event form. Resolves { action: 'save', value } | { action: 'delete' } | null.
  function eventDialog(e, { canDelete, targets }) {
    return dialog(e.id ? 'Edit event' : 'New event', (form, done) => {
      const title = h('input', { type: 'text', value: e.title || '', maxlength: '300', 'aria-label': 'Title' });
      const allDay = h('input', { type: 'checkbox' });
      allDay.checked = e.allDay !== false;
      const startDate = h('input', { type: 'date', value: e.startDate });
      const endDate = h('input', { type: 'date', value: e.endDate || e.startDate });
      const startTime = h('input', { type: 'time', value: e.startTime || '09:00' });
      const endTime = h('input', { type: 'time', value: e.endTime || '10:00' });
      const notes = h('textarea', { rows: '3' });
      notes.value = e.notes || '';
      const target = targets && h('select', {}, targets.map(([v, label]) => h('option', { value: v }, label)));
      const times = h('div', { class: 'cal-pair' }, field('Starts', startTime), field('Ends', endTime));
      const syncTimes = () => { times.hidden = allDay.checked; };
      allDay.onchange = syncTimes;
      startDate.onchange = () => { if (!endDate.value || endDate.value < startDate.value) endDate.value = startDate.value; };
      // Moving the start keeps the event's length, like Google Calendar does.
      let lastStart = startTime.value;
      const mins = t => { const [hh, mm] = t.split(':').map(Number); return hh * 60 + mm; };
      startTime.onchange = () => {
        if (!C.isTime(startTime.value) || !C.isTime(endTime.value) || !C.isTime(lastStart)) { lastStart = startTime.value; return; }
        const end = Math.min(mins(endTime.value) + mins(startTime.value) - mins(lastStart), 23 * 60 + 59);
        if (end > mins(startTime.value) || endDate.value > startDate.value) endTime.value = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
        else { const e = Math.min(mins(startTime.value) + 60, 23 * 60 + 59); endTime.value = `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`; }
        lastStart = startTime.value;
      };
      syncTimes();
      const err = h('p', { class: 'cal-error', role: 'alert' });
      form.append(
        field('Title', title),
        h('label', { class: 'cal-check' }, allDay, 'All day'),
        h('div', { class: 'cal-pair' }, field('Start date', startDate), field('End date', endDate)),
        times,
        field('Notes', notes),
        target ? field('Save to', target) : '',
        err,
        h('div', { class: 'cal-actions' },
          canDelete && h('button', { type: 'button', class: 'cal-del', onclick: () => done({ action: 'delete' }) }, 'Delete'),
          h('button', { type: 'submit' }, 'Save'),
          h('button', { type: 'button', onclick: () => done(null) }, 'Cancel')));
      form.onsubmit = ev => {
        ev.preventDefault();
        const value = C.normalizeEventInput({ title: title.value, allDay: allDay.checked, startDate: startDate.value, endDate: endDate.value, startTime: startTime.value, endTime: endTime.value, notes: notes.value });
        if (value.error) { err.textContent = value.error; return; }
        done({ action: 'save', value, target: target?.value });
      };
    });
  }

  // Google "G" mark for the sign-in button (same paths as the sidebar sign-in in auth-ui.js).
  const G_PATHS = [
    ['#4285F4', 'M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'],
    ['#34A853', 'M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'],
    ['#FBBC05', 'M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z'],
    ['#EA4335', 'M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z'],
  ];
  const gMark = () => h('svg', { viewBox: '0 0 24 24', width: '16', height: '16', 'aria-hidden': 'true' }, G_PATHS.map(([fill, d]) => h('path', { fill, d })));

  // One listener for the window; it reaches whichever calendar page is mounted.
  let onGcalChanged = null;
  root.api?.on('gcal:changed', () => onGcalChanged?.());

  // Full calendar page. page.events holds this workspace's own events.
  function mount(host, page, { getPages, dateProp, openRow, onChange }) {
    const api = root.api;
    let view = page.calView === 'week' ? 'week' : 'month';
    let anchor = today();
    let gstat = { connected: false, isConfigured: false };
    let gEvents = [], gKey = '', gLoading = false, gError = '';
    let alive = true;
    if (!Array.isArray(page.events)) page.events = [];
    host.innerHTML = '';
    host.className = 'calpage';

    const range = () => { const d = daysFor(view, anchor); return { from: d[0], to: d[d.length - 1] }; };
    async function loadGoogle(force) {
      if (!gstat.connected) { gEvents = []; gKey = ''; return; }
      const r = range(), key = `${r.from}|${r.to}`;
      if (!force && key === gKey) return;
      gKey = key; gLoading = true; gError = ''; draw();
      const res = await api.gcalList(r);
      if (!alive || key !== gKey) return; // a newer range was asked for meanwhile
      gLoading = false;
      if (res.error) { gError = res.error; gEvents = []; if (res.disconnected) gstat = await api.gcalStatus(); }
      else gEvents = res.events;
      draw();
    }
    async function refreshStatus() {
      gstat = await api.gcalStatus();
      gKey = '';
      await loadGoogle(true);
      draw();
    }

    function go(n) {
      anchor = view === 'week' ? C.addDays(anchor, 7 * n) : C.shiftMonth(anchor, n);
      draw(); loadGoogle();
    }
    function setView(v) { view = v; page.calView = v; onChange(); draw(); loadGoogle(); }

    async function onDay(date) { await editEvent({ title: '', startDate: date, endDate: date, allDay: true, source: gstat.connected ? 'google' : 'local' }); }
    function onMore(date) { anchor = date; setView('week'); }
    async function onEvent(e) {
      if (e.source === 'row') return openRow(e.rowId);
      await editEvent(e);
    }

    async function editEvent(e) {
      const isNew = !e.id;
      const targets = isNew && gstat.connected ? [['google', `Google Calendar${gstat.email ? ` (${gstat.email})` : ''}`], ['local', 'This workspace only']] : null;
      const r = await eventDialog(e, { canDelete: !isNew, targets });
      if (!r) return;
      const where = isNew ? (r.target || 'local') : e.source;
      if (where === 'local') {
        if (r.action === 'delete') page.events = page.events.filter(x => x.id !== e.id);
        else if (isNew) page.events.push({ id: 'l' + crypto.randomUUID().slice(0, 8), source: 'local', ...r.value });
        else Object.assign(page.events.find(x => x.id === e.id) || {}, r.value);
        onChange();
        return draw();
      }
      if (r.action === 'delete' && !confirm(`Delete "${e.title}" from Google Calendar?`)) return;
      gLoading = true; draw();
      const res = r.action === 'delete' ? await api.gcalDelete(e.googleId)
        : isNew ? await api.gcalCreate(r.value) : await api.gcalUpdate(e.googleId, r.value);
      gLoading = false;
      if (res.error) { alert(`Google Calendar: ${res.error}`); if (res.disconnected) return refreshStatus(); return draw(); }
      await loadGoogle(true);
    }

    async function signIn() {
      gError = 'Finish signing in with Google in your browser…'; draw();
      const r = await api.gcalConnect();
      gError = r.error || '';
      refreshStatus();
    }
    function googleBar() {
      if (!gstat.connected) {
        return h('button', { type: 'button', class: 'auth-btn-google cal-signin', onclick: signIn, disabled: !gstat.isConfigured,
          title: gstat.isConfigured ? 'Show and edit your Google Calendar events here' : 'Google sign-in for Calendar is not available in this build yet' },
        gMark(), h('span', {}, 'Sign in with Google'));
      }
      return h('div', { class: 'cal-gwrap' },
        h('span', { class: 'cal-gstat', title: 'Signed in to Google Calendar' }, gMark(), gstat.email || 'Google Calendar'),
        h('button', { type: 'button', class: 'cal-link', onclick: () => loadGoogle(true), disabled: gLoading }, gLoading ? 'Syncing…' : 'Refresh'),
        h('button', { type: 'button', class: 'cal-link', onclick: async () => { if (confirm('Sign out of Google Calendar? Your Google events stay in Google.')) { await api.gcalDisconnect(); refreshStatus(); } } }, 'Sign out'));
    }

    function draw() {
      if (!alive) return;
      const r = range();
      const label = view === 'week' ? `${shortDay(r.from)} – ${shortDay(r.to)}, ${r.to.slice(0, 4)}` : monthLabel(anchor);
      const events = [...page.events, ...C.rowEvents(getPages(), dateProp), ...gEvents];
      host.innerHTML = '';
      host.append(
        h('div', { class: 'cal-bar' },
          h('div', { class: 'cal-nav' },
            h('button', { type: 'button', 'aria-label': 'Previous', onclick: () => go(-1) }, '‹'),
            h('button', { type: 'button', onclick: () => { anchor = today(); draw(); loadGoogle(); } }, 'Today'),
            h('button', { type: 'button', 'aria-label': 'Next', onclick: () => go(1) }, '›'),
            h('h2', { class: 'cal-title' }, label)),
          h('div', { class: 'cal-tools' },
            h('div', { class: 'cal-seg', role: 'group', 'aria-label': 'View' },
              ['month', 'week'].map(v => h('button', { type: 'button', class: v === view ? 'on' : '', 'aria-pressed': String(v === view), onclick: () => setView(v) }, v[0].toUpperCase() + v.slice(1)))),
            h('button', { type: 'button', class: 'cal-new', onclick: () => onDay(r.from <= today() && today() <= r.to ? today() : view === 'week' ? r.from : anchor.slice(0, 8) + '01') }, '+ Event'),
            googleBar())),
        gError ? h('p', { class: 'cal-note' }, gError) : '',
        grid({ view, anchor, events, onDay, onEvent, onMore }),
        h('div', { class: 'cal-legend' },
          h('span', { class: 'cal-key cal-local' }, 'Workspace'),
          gstat.connected && h('span', { class: 'cal-key cal-google' }, 'Google Calendar'),
          h('span', { class: 'cal-key cal-row' }, 'Database rows')));
    }

    onGcalChanged = refreshStatus;
    draw();
    refreshStatus();
    return { destroy() { alive = false; onGcalChanged = null; host.innerHTML = ''; host.className = ''; } };
  }

  root.FolioCalendar = { grid, mount, daysFor, monthLabel };
})(typeof self !== 'undefined' ? self : globalThis);
