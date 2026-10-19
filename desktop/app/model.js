// Data model shared by the app and tests. A database is a page with kind "database";
// its rows are pages whose parentId is the database id and whose props hold cell values.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const VIEW_TYPES = ['table', 'board', 'gallery', 'list', 'calendar'];
  const PROP_TYPES = ['text', 'select', 'date', 'number', 'checkbox'];
  const TASK_SCHEMA = [
    { id: 'status', name: 'Status', type: 'select', options: ['To do', 'Doing', 'Done'] },
    { id: 'priority', name: 'Priority', type: 'select', options: ['Low', 'Medium', 'High'] },
    { id: 'due', name: 'Due', type: 'date' },
    { id: 'assignee', name: 'Assignee', type: 'text' },
  ];

  const textOf = v => (v == null ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
  const rowsOf = (db, pages) => pages.filter(p => p.parentId === db.id);
  const viewOf = db => ({ type: 'table', filter: null, sort: null, group: null, dateProp: null, ...db.view });

  function makeDatabase(id, title, schema = TASK_SCHEMA) {
    return { id, title, parentId: null, kind: 'database', schema: schema.map(p => ({ ...p })), view: { type: 'table' }, blocks: [] };
  }

  function makeRow(id, db, title, props = {}) {
    return { id, title, parentId: db.id, blocks: [{ id: id + 'b', type: 'text', text: '' }], props };
  }

  // Filter: `filter.propId` ('title' or a schema id) must contain `filter.value`, case-insensitive.
  function filterRows(rows, filter) {
    if (!filter || !filter.propId || !filter.value) return rows;
    const q = filter.value.toLowerCase();
    return rows.filter(r => textOf(filter.propId === 'title' ? r.title : r.props?.[filter.propId]).toLowerCase().includes(q));
  }

  // Sort: empty values always last, whichever direction.
  function sortRows(rows, sort) {
    if (!sort || !sort.propId) return rows;
    const k = sort.dir === 'desc' ? -1 : 1;
    const val = r => (sort.propId === 'title' ? r.title : r.props?.[sort.propId]);
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      const ex = textOf(x) === '', ey = textOf(y) === '';
      if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;
      if (typeof x === 'number' && typeof y === 'number') return k * (x - y);
      return k * textOf(x).localeCompare(textOf(y), undefined, { numeric: true });
    });
  }

  function visibleRows(db, pages) {
    const v = viewOf(db);
    return sortRows(filterRows(rowsOf(db, pages), v.filter), v.sort);
  }

  // Group by a select property. Options keep their order; empty group appears only if it has rows.
  function groupRows(db, rows) {
    const propId = viewOf(db).group;
    if (!propId) return [{ key: '', label: '', rows }];
    const prop = db.schema.find(p => p.id === propId);
    const options = prop?.options ? [...prop.options] : [];
    const groups = new Map(options.map(o => [o, []]));
    groups.set('', []);
    for (const r of rows) {
      const k = textOf(r.props?.[propId]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    return [...groups]
      .filter(([k, rs]) => rs.length || options.includes(k))
      .map(([k, rs]) => ({ key: k, label: k || 'No value', rows: rs }));
  }

  function dateProp(db) {
    const id = viewOf(db).dateProp;
    return db.schema.find(p => p.id === id) || db.schema.find(p => p.type === 'date') || null;
  }

  // Calendar: rows bucketed by the date property, sorted by date.
  function calendarGroups(db, rows) {
    const dp = dateProp(db);
    if (!dp) return [];
    const map = new Map();
    for (const r of rows) {
      const k = textOf(r.props?.[dp.id]) || 'No date';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return [...map].sort(([a], [b]) => (a === 'No date') - (b === 'No date') || a.localeCompare(b, undefined, { numeric: true }));
  }

  // Mindmap: nested tree of a page and its descendants. Cycles are cut so bad data cannot loop.
  function mindmapTree(pages, rootId) {
    const seen = new Set();
    const build = id => {
      const page = pages.find(p => p.id === id);
      if (!page || seen.has(id)) return null;
      seen.add(id);
      return { id: page.id, title: page.title || 'Untitled', children: pages.filter(p => p.parentId === id).map(c => build(c.id)).filter(Boolean) };
    };
    return build(rootId);
  }

  return { VIEW_TYPES, PROP_TYPES, TASK_SCHEMA, textOf, rowsOf, viewOf, makeDatabase, makeRow, filterRows, sortRows, visibleRows, groupRows, dateProp, calendarGroups, mindmapTree };
});
