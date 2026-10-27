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
    if (allDay) return { title, startDate, endDate, allDay: true, startTime: '', endTime: '', notes };
    const startTime = isTime(input.startTime) ? input.startTime : '09:00';
    let endTime = isTime(input.endTime) ? input.endTime : '';
    if (!endTime) {
      const [h, m] = startTime.split(':').map(Number);
      if (h === 23) endTime = '23:59';
      else endTime = `${pad(h + 1)}:${pad(m)}`;
    }
    if (endDate === startDate && endTime <= startTime) return { error: 'The event must end after it starts.' };
    return { title, startDate, endDate, allDay: false, startTime, endTime, notes };
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
  function fromGoogleEvent(g) {
    if (!g || typeof g !== 'object' || g.status === 'cancelled' || !g.id || !g.start) return null;
    const base = { id: 'g:' + g.id, googleId: String(g.id), source: 'google', title: String(g.summary || '(No title)'), notes: String(g.description || ''), link: typeof g.htmlLink === 'string' ? g.htmlLink : '' };
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
