// What the landing screen (Home) shows, worked out from plain data. No screen code here, so it is easy to test.
// Sections, in order: Must do, Overdue, Due today and tomorrow, Important, Today's calendar, My reminders, Pinned,
// and (for admins and leads) Needs your attention across the team. A task is shown once, in the most urgent
// section it belongs to.
(function (root, factory) {
  const api = factory(
    typeof module !== 'undefined' ? require('./calendar-logic') : root.FolioCalLogic,
    typeof module !== 'undefined' ? require('./team-logic') : root.FolioTeamLogic,
  );
  if (typeof module !== 'undefined') module.exports = api;
  else root.FolioHomeLogic = api;
})(typeof self !== 'undefined' ? self : globalThis, function (C, T) {
  // The sections a person can switch on or off (Customize). Calendar, pinned and reminders can be hidden too.
  const SECTIONS = [
    { id: 'mustdo', title: 'Must do', hint: 'Tasks an admin or lead flagged. They stay here every day until you finish them.' },
    { id: 'attention', title: 'Needs your attention (team)', hint: 'For admins and leads: overdue and must-do work that is still open for other people.' },
    { id: 'overdue', title: 'Overdue', hint: 'Open work whose date has passed.' },
    { id: 'soon', title: 'Due today and tomorrow', hint: 'Open work coming up in the next two days.' },
    { id: 'important', title: 'Important', hint: 'High-priority work that is still open and not already shown above.' },
    { id: 'calendar', title: 'Today’s calendar', hint: 'Today’s events: your workspace, Google Calendar and the team.' },
    { id: 'reminders', title: 'My reminders', hint: 'Things you added to this screen yourself.' },
    { id: 'pinned', title: 'Pinned', hint: 'Pages you pinned to this screen.' },
  ];
  const PRIORITY_FROM_LABEL = { high: 'high', medium: 'medium', low: 'low' };
  const ATTENTION_LIMIT = 8;

  // ---- what is stored in the workspace for this screen: { reminders, pins, hidden } ----
  const cleanText = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  function cleanHome(raw) {
    const h = raw && typeof raw === 'object' ? raw : {};
    const reminders = (Array.isArray(h.reminders) ? h.reminders : []).filter(r => r && typeof r.id === 'string' && cleanText(r.text, 200)).map(r => ({
      id: r.id, text: cleanText(r.text, 200), date: C.isDate(r.date) ? r.date : '', done: Boolean(r.done), createdAt: Number(r.createdAt) || 0,
    }));
    const pins = [...new Set((Array.isArray(h.pins) ? h.pins : []).filter(p => typeof p === 'string'))];
    const hidden = (Array.isArray(h.hidden) ? h.hidden : []).filter(id => SECTIONS.some(s => s.id === id));
    return { reminders, pins, hidden };
  }
  function normalizeReminder(input = {}) {
    const text = cleanText(input.text, 200);
    if (!text) return { error: 'Write what you want to be reminded of.' };
    const date = input.date ? String(input.date) : '';
    if (date && !C.isDate(date)) return { error: 'The date is not valid.' };
    return { text, date };
  }

  // ---- task rows from the workspace's own "Tasks" databases (the ones with Status and Due) ----
  function rowsFromPages(pages) {
    const out = [];
    for (const db of pages.filter(p => p.kind === 'database')) {
      const has = (id, type) => (db.schema || []).some(p => p.id === id && p.type === type);
      if (!has('status', 'select') || !has('due', 'date')) continue;
      for (const r of pages) {
        if (r.parentId !== db.id) continue;
        const status = String(r.props?.status ?? '');
        if (status === 'Done') continue;
        const due = String(r.props?.due ?? '').slice(0, 10);
        out.push({
          id: r.id, title: r.title || 'Untitled', dueDate: C.isDate(due) ? due : '',
          priority: PRIORITY_FROM_LABEL[String(r.props?.priority ?? '').toLowerCase()] || 'medium', status, database: db.title || 'Tasks',
        });
      }
    }
    return out;
  }

  // ---- building the screen ----
  const byUrgency = (a, b) => {
    if (a.dueDate !== b.dueDate) return !a.dueDate ? 1 : !b.dueDate ? -1 : a.dueDate.localeCompare(b.dueDate);
    const rank = { high: 0, medium: 1, low: 2 };
    return ((rank[a.priority] ?? 1) - (rank[b.priority] ?? 1)) || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
  };
  const eventToday = (e, today) => C.isDate(e.startDate) && e.startDate <= today && today <= (C.isDate(e.endDate) ? e.endDate : e.startDate);
  const timeLabel = e => (e.allDay || !e.startTime ? 'All day' : e.endTime ? `${e.startTime}–${e.endTime}` : e.startTime);

  // input: { today, uid, team: { tasks, events, team, role } | null, rows, reminders, localEvents, googleEvents,
  //          pins, pages (array), hidden }
  function build(input) {
    const { today, uid = '', team = null, rows = [], reminders = [], localEvents = [], googleEvents = [], pins = [], pages = [], hidden = [] } = input;
    const tomorrow = C.addDays(today, 1);
    const seen = new Set();
    const take = items => items.filter(i => (seen.has(i.key) ? false : (seen.add(i.key), true)));

    const mineTasks = team && team.tasks ? team.tasks.filter(t => !t.deleted && t.assigneeUid === uid && t.status !== 'done') : [];
    const taskItem = t => ({ key: 't:' + t.id, kind: 'task', title: t.title, sub: team && team.team ? team.team.name : 'Team', dueDate: t.dueDate || '', priority: t.priority, mustDo: Boolean(t.mustDo), status: t.status, ref: { type: 'team-task', id: t.id } });
    const rowItem = r => ({ key: 'r:' + r.id, kind: 'row', title: r.title, sub: r.database, dueDate: r.dueDate, priority: r.priority, mustDo: false, status: r.status, ref: { type: 'row', id: r.id } });
    const remItem = r => ({ key: 'm:' + r.id, kind: 'reminder', title: r.text, sub: 'Reminder', dueDate: r.date, priority: 'medium', mustDo: false, status: '', ref: { type: 'reminder', id: r.id } });
    const open = [
      ...mineTasks.map(taskItem), ...rows.map(rowItem), ...reminders.filter(r => !r.done).map(remItem),
    ];

    const mustdo = take(open.filter(i => i.mustDo).sort(byUrgency));
    const overdue = take(open.filter(i => i.dueDate && i.dueDate < today).sort(byUrgency));
    const soon = take(open.filter(i => i.dueDate === today || i.dueDate === tomorrow).sort(byUrgency));
    const important = take(open.filter(i => i.kind !== 'reminder' && i.priority === 'high').sort(byUrgency));
    const loose = take(open.filter(i => i.kind === 'reminder').sort(byUrgency)); // reminders with no near date

    // Admins and leads also see what is stuck for other people.
    let attention = [];
    if (team && team.team && (team.role === 'admin' || team.role === 'lead')) {
      const others = (team.tasks || []).filter(t => !t.deleted && t.status !== 'done' && t.assigneeUid !== uid);
      attention = others.filter(t => t.mustDo || (t.dueDate && t.dueDate < today)).map(t => ({
        ...taskItem(t), key: 'a:' + t.id, sub: `${T.nameOf(team.team, t.assigneeUid)} · ${team.team.name}`, ref: { type: 'team-task', id: t.id },
      })).sort(byUrgency);
    }

    const calendar = [
      ...localEvents.filter(e => eventToday(e, today)).map(e => ({ ...e, source: 'workspace' })),
      ...googleEvents.filter(e => eventToday(e, today)).map(e => ({ ...e, source: 'google' })),
      ...((team && team.events) || []).filter(e => !e.deleted && eventToday(e, today)).map(e => ({ ...e, source: 'team' })),
    ].map(e => ({ key: 'e:' + e.source + ':' + (e.id || e.googleId || e.title), kind: 'event', title: e.title, sub: { workspace: 'Workspace', google: 'Google Calendar', team: 'Team' }[e.source], time: timeLabel(e), startTime: e.allDay ? '' : (e.startTime || ''), ref: { type: 'event', source: e.source }, color: e.color || '' }))
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title));

    const byId = new Map(pages.map(p => [p.id, p]));
    const pinned = pins.map(id => byId.get(id)).filter(Boolean).map(p => ({ key: 'p:' + p.id, kind: 'page', title: p.title || 'Untitled', sub: p.kind === 'database' ? 'Database' : p.kind === 'team' ? 'Team' : p.kind === 'calendar' ? 'Calendar' : 'Page', ref: { type: 'page', id: p.id } }));

    const all = { mustdo, attention, overdue, soon, important, calendar, reminders: loose, pinned };
    const sections = SECTIONS.filter(s => !hidden.includes(s.id)).map(s => {
      const items = all[s.id];
      const more = s.id === 'attention' && items.length > ATTENTION_LIMIT ? items.length - ATTENTION_LIMIT : 0;
      return { id: s.id, title: s.title, items: s.id === 'attention' ? items.slice(0, ATTENTION_LIMIT) : items, more };
    }).filter(s => s.items.length);

    const summary = { mustDo: mustdo.length, overdue: overdue.length, dueSoon: soon.length, important: important.length, events: calendar.length, attention: attention.length };
    summary.needYou = summary.mustDo + summary.overdue + summary.dueSoon;
    // The one thing to start with: the first item of the most urgent section that is not a calendar or team overview.
    const lead = ['mustdo', 'overdue', 'soon', 'important'].map(id => sections.find(s => s.id === id)).find(Boolean);
    const focus = lead ? { sectionId: lead.id, item: lead.items[0] } : null;
    return { sections, summary, focus, empty: !sections.length };
  }

  return { SECTIONS, cleanHome, normalizeReminder, rowsFromPages, build, timeLabel };
});
