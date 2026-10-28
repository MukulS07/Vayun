// Minimal Cloud Firestore REST helpers: value encoding, write and query builders, and error mapping.
// https://firebase.google.com/docs/firestore/reference/rest
const { TeamError } = require('./team-error');

const BASE = 'https://firestore.googleapis.com/v1';
const docsRoot = project => `projects/${project}/databases/(default)/documents`;

// ---- values ----
// Strings stay strings, whole numbers become integers, { $timestamp: iso } becomes a Firestore timestamp.
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object' && '$timestamp' in v) return { timestampValue: v.$timestamp };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  throw new Error('Unsupported value type: ' + typeof v);
}
const toFields = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toValue(v)]));

// Timestamps stay ISO strings (exact, with their full fraction) so they can be sent back as a cursor.
function fromValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}
const fromFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, fromValue(v)]));
const fromDocument = doc => ({ id: doc.name.split('/').pop(), ...fromFields(doc.fields) });

// ---- writes ----
const fieldPath = parts => [].concat(parts).map(p => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) ? p : '`' + p.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`')).join('.');
const serverTimeTransforms = names => names.map(f => ({ fieldPath: fieldPath(f), setToServerValue: 'REQUEST_TIME' }));

function setIn(obj, parts, value) {
  let o = obj;
  parts.slice(0, -1).forEach(p => { o = o[p] = o[p] || {}; });
  o[parts[parts.length - 1]] = value;
}

// Creates a document; the write fails if it already exists. serverTime: fields set to the server's time.
function createWrite(project, path, data, { serverTime = [] } = {}) {
  return {
    update: { name: `${docsRoot(project)}/${path}`, fields: toFields(data) },
    currentDocument: { exists: false },
    ...(serverTime.length && { updateTransforms: serverTimeTransforms(serverTime) }),
  };
}

// Changes only the listed fields of an existing document. set: [[pathParts, value]], remove: [pathParts],
// arrayUnion / arrayRemove: [[field, values]].
function patchWrite(project, path, { set = [], remove = [], serverTime = [], arrayUnion = [], arrayRemove = [] } = {}) {
  const nested = {};
  for (const [parts, value] of set) setIn(nested, [].concat(parts), value);
  const transforms = [
    ...serverTimeTransforms(serverTime),
    ...arrayUnion.map(([f, vals]) => ({ fieldPath: fieldPath(f), appendMissingElements: { values: vals.map(toValue) } })),
    ...arrayRemove.map(([f, vals]) => ({ fieldPath: fieldPath(f), removeAllFromArray: { values: vals.map(toValue) } })),
  ];
  return {
    update: { name: `${docsRoot(project)}/${path}`, fields: toFields(nested) },
    updateMask: { fieldPaths: [...set.map(([p]) => fieldPath(p)), ...remove.map(fieldPath)] },
    currentDocument: { exists: true },
    ...(transforms.length && { updateTransforms: transforms }),
  };
}

const deleteWrite = (project, path) => ({ delete: `${docsRoot(project)}/${path}` });

// ---- queries ----
const OPS = { '==': 'EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', '<': 'LESS_THAN', 'array-contains': 'ARRAY_CONTAINS' };
function structuredQuery({ collection, where = [], orderBy, limit }) {
  const filters = where.map(({ field, op, value }) => ({ fieldFilter: { field: { fieldPath: field }, op: OPS[op], value: toValue(value) } }));
  const q = { from: [{ collectionId: collection }] };
  if (filters.length === 1) q.where = filters[0];
  else if (filters.length > 1) q.where = { compositeFilter: { op: 'AND', filters } };
  if (orderBy) q.orderBy = [{ field: { fieldPath: orderBy.field }, direction: orderBy.desc ? 'DESCENDING' : 'ASCENDING' }];
  if (limit) q.limit = limit;
  return q;
}
// An empty result still arrives as one entry without a document.
const parseQueryResponse = rows => (rows || []).filter(r => r.document).map(r => fromDocument(r.document));

// ---- requests ----
function firestoreError(status, json) {
  const code = json?.error?.status || '';
  const msg = json?.error?.message || '';
  if (status === 401 || code === 'UNAUTHENTICATED') return new TeamError('Your sign-in expired. Sign in again.', 'auth');
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') return new TeamError('The free daily limit for team sync was reached. It resets tomorrow.', 'quota');
  if (/has not been used|is disabled|does not exist|database .* not found/i.test(msg)) return new TeamError('The team space is not set up yet.', 'setup');
  if (status === 403 || code === 'PERMISSION_DENIED') return new TeamError('You are not allowed to do that.', 'forbidden');
  if (status === 404 || code === 'NOT_FOUND') return new TeamError('Not found.', 'not-found');
  if (status === 409 || code === 'ALREADY_EXISTS' || code === 'FAILED_PRECONDITION' || code === 'ABORTED') return new TeamError('That changed while you were working. Try again.', 'conflict');
  return new TeamError(`Team sync failed (${status}).`, 'network');
}

async function request(fetchImpl, token, method, url, body) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new TeamError('Could not reach the team server. Check your internet connection.', 'network');
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw firestoreError(res.status, json);
  return json;
}

module.exports = {
  BASE, docsRoot, toValue, toFields, fromValue, fromFields, fromDocument, fieldPath,
  createWrite, patchWrite, deleteWrite, structuredQuery, parseQueryResponse, firestoreError, request,
};
