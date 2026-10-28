const test = require('node:test');
const assert = require('node:assert');
const C = require('../app/calendar-logic');
const M = require('../app/model');
const G = require('../gcal-logic');

test('monthGrid: 6 Monday-first weeks covering the month', () => {
  const g = C.monthGrid(2026, 9); // October 2026 starts on a Thursday
  assert.strictEqual(g.length, 6);
  assert.ok(g.every(w => w.length === 7));
  assert.strictEqual(g[0][0], '2026-09-28');
  assert.strictEqual(g[0][3], '2026-10-01');
  assert.ok(g.flat().includes('2026-10-31'));
});

test('addDays, weekOf and shiftMonth cross month, year and DST boundaries', () => {
  assert.strictEqual(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(C.addDays('2026-03-29', 1), '2026-03-30');
  assert.deepStrictEqual(C.weekOf('2026-10-27').slice(0, 1).concat(C.weekOf('2026-10-27').slice(-1)), ['2026-10-26', '2026-11-01']);
  assert.strictEqual(C.shiftMonth('2026-01-31', 1), '2026-02-01');
  assert.strictEqual(C.shiftMonth('2026-01-15', -1), '2025-12-01');
});

test('eventsByDay spreads multi-day events, sorts all-day first then by time', () => {
  const days = C.weekOf('2026-10-27');
  const map = C.eventsByDay([
    { id: 'a', title: 'Late', startDate: '2026-10-27', allDay: false, startTime: '15:00' },
    { id: 'b', title: 'Trip', startDate: '2026-10-25', endDate: '2026-10-28', allDay: true },
    { id: 'c', title: 'Early', startDate: '2026-10-27', allDay: false, startTime: '08:30' },
    { id: 'd', title: 'Outside', startDate: '2026-11-05', allDay: true },
  ], days);
  assert.deepStrictEqual(map.get('2026-10-27').map(e => e.id), ['b', 'c', 'a']);
  assert.deepStrictEqual(map.get('2026-10-26').map(e => e.id), ['b']);
  assert.deepStrictEqual(map.get('2026-10-29'), []);
});

test('normalizeEventInput validates and fills defaults', () => {
  assert.ok(C.normalizeEventInput({ title: ' ', startDate: '2026-10-27' }).error);
  assert.ok(C.normalizeEventInput({ title: 'x', startDate: 'nope' }).error);
  assert.ok(C.normalizeEventInput({ title: 'x', startDate: '2026-10-27', endDate: '2026-10-26', allDay: true }).error);
  assert.ok(C.normalizeEventInput({ title: 'x', startDate: '2026-10-27', startTime: '10:00', endTime: '09:00' }).error);
  const e = C.normalizeEventInput({ title: ' Standup ', startDate: '2026-10-27', startTime: '09:30' });
  assert.deepStrictEqual(e, { title: 'Standup', startDate: '2026-10-27', endDate: '2026-10-27', allDay: false, startTime: '09:30', endTime: '10:30', notes: '' });
  assert.strictEqual(C.normalizeEventInput({ title: 'x', startDate: '2026-10-27', startTime: '23:15' }).endTime, '23:59');
});

test('rowEvents picks dated rows from every database', () => {
  const db = M.makeDatabase('db', 'Tasks');
  const pages = [db, M.makeRow('r1', db, 'Ship', { due: '2026-10-30' }), M.makeRow('r2', db, 'Later', {}), { id: 'p', title: 'Note', parentId: null, blocks: [] }];
  const ev = C.rowEvents(pages, M.dateProp);
  assert.deepStrictEqual(ev.map(e => [e.rowId, e.startDate, e.source]), [['r1', '2026-10-30', 'row']]);
});

test('Google mapping: all-day end is exclusive; timed shows local time; round trip', () => {
  const allDay = C.fromGoogleEvent({ id: 'abc', summary: 'Holiday', start: { date: '2026-12-24' }, end: { date: '2026-12-26' } });
  assert.strictEqual(allDay.startDate, '2026-12-24');
  assert.strictEqual(allDay.endDate, '2026-12-25');
  assert.deepStrictEqual(C.toGoogleEvent(allDay, 'UTC'), { summary: 'Holiday', description: '', start: { date: '2026-12-24' }, end: { date: '2026-12-26' } });

  const iso = '2026-10-27T14:05:00Z', local = new Date(iso);
  const timed = C.fromGoogleEvent({ id: 'def', start: { dateTime: iso }, end: { dateTime: '2026-10-27T15:05:00Z' } });
  assert.strictEqual(timed.title, '(No title)');
  assert.strictEqual(timed.startDate, C.dayKey(local));
  assert.strictEqual(timed.startTime, `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`);
  const body = C.toGoogleEvent({ title: 'Call', startDate: '2026-10-27', endDate: '2026-10-27', allDay: false, startTime: '09:00', endTime: '09:30' }, 'Asia/Kolkata');
  assert.deepStrictEqual(body.start, { dateTime: '2026-10-27T09:00:00', timeZone: 'Asia/Kolkata' });

  assert.strictEqual(C.fromGoogleEvent({ id: 'x', status: 'cancelled', start: { date: '2026-01-01' } }), null);

  const familyEv = C.fromGoogleEvent({ id: 'fam1', summary: 'Dinner', start: { date: '2026-10-28' }, end: { date: '2026-10-28' } }, { id: 'family123@group.calendar.google.com', summary: 'Family', color: '#ff8800' });
  assert.strictEqual(familyEv.calendarId, 'family123@group.calendar.google.com');
  assert.strictEqual(familyEv.calendarTitle, 'Family');
  assert.strictEqual(familyEv.color, '#ff8800');
  assert.strictEqual(familyEv.id, 'g:' + encodeURIComponent('family123@group.calendar.google.com') + ':fam1');
});

test('gcal-logic: config validation, PKCE and auth URL', () => {
  const cfg = G.normalizeGcalConfig({ GOOGLE_CLIENT_ID: ' 123-abc.apps.googleusercontent.com ', GOOGLE_CLIENT_SECRET: 'GOCSPX-x' });
  assert.deepStrictEqual(G.validateGcalConfig(cfg), { valid: true, missing: [] });
  // Placeholders from .env.local.example fall back to the client bundled with the app.
  assert.deepStrictEqual(G.normalizeGcalConfig({ GOOGLE_CLIENT_ID: 'your_client_id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'your_client_secret' }), G.DEFAULT_GCAL_CLIENT);
  assert.deepStrictEqual(G.normalizeGcalConfig({}), G.DEFAULT_GCAL_CLIENT);
  assert.deepStrictEqual(G.validateGcalConfig({ clientId: 'nope', clientSecret: '' }).missing, ['clientId', 'clientSecret']);

  const { verifier, challenge } = G.makePkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  const expected = require('node:crypto').createHash('sha256').update(verifier).digest('base64url');
  assert.strictEqual(challenge, expected);

  const u = new URL(G.buildAuthUrl({ clientId: cfg.clientId, redirectUri: 'http://127.0.0.1:5555/callback', state: 's1', challenge }));
  assert.strictEqual(u.origin + u.pathname, G.AUTH_ENDPOINT);
  assert.strictEqual(u.searchParams.get('access_type'), 'offline');
  assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(u.searchParams.get('scope').includes('calendar.events'));
  assert.ok(u.searchParams.get('scope').includes('calendar.calendarlist.readonly'));
  assert.strictEqual(u.searchParams.get('login_hint'), null);
  const hinted = new URL(G.buildAuthUrl({ clientId: cfg.clientId, redirectUri: 'http://127.0.0.1:1/callback', state: 's', challenge, loginHint: 'me@gmail.com' }));
  assert.strictEqual(hinted.searchParams.get('login_hint'), 'me@gmail.com');

  const tok = ['h', Buffer.from(JSON.stringify({ email: 'a@b.c' })).toString('base64url'), 's'].join('.');
  assert.strictEqual(G.emailFromIdToken(tok), 'a@b.c');
  assert.strictEqual(G.emailFromIdToken('garbage'), '');
  assert.ok(G.isGoogleId('abc_123'));
  assert.ok(!G.isGoogleId('../x'));
  assert.ok(G.isCalendarId('primary'));
  assert.ok(G.isCalendarId('family123@group.calendar.google.com'));
  assert.ok(G.isCalendarId('en.indian#holiday@group.v.calendar.google.com'));
  assert.ok(!G.isCalendarId('../../bad/path'));
});
