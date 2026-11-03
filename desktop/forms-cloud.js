// The app's side of public form links (main process): publish a form, pull the answers people sent, close or remove
// the link. It talks to the "forms" function (functions/forms-core.js), signed in as the person who owns the form.
// Nothing here polls: the app calls pull when the person opens the responses or taps Sync.
const REGION = 'us-central1';

// deps: getToken() -> Firebase ID token, getProjectId() -> Firebase project id, fetch (tests), timeoutMs
function createFormsCloud({ getToken, getProjectId, fetch: fetchImpl = (...a) => fetch(...a), timeoutMs = 20000 }) {
  const base = () => {
    const project = getProjectId();
    if (!project) throw new Error('Sign in to Vayun first, then try again. (Firebase is not set up on this computer.)');
    return `https://${REGION}-${project}.cloudfunctions.net/forms`;
  };

  // The link people open, built on the same project as the server.
  function link(id) {
    try { return `${base()}/f/${encodeURIComponent(id)}`; } catch { return ''; }
  }

  async function call(action, body) {
    let token;
    try { token = await getToken(); } catch (e) { return { error: e && e.message ? e.message : 'Sign in to Vayun to share forms.' }; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base()}/${action}`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body), signal: ctrl.signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) return { error: (json && json.error && json.error.message) || `The server said no (${res.status}).` };
      return json || { error: 'The server sent something unexpected.' };
    } catch (e) {
      return { error: e && e.name === 'AbortError' ? 'The server took too long. Try again.' : e && /Firebase is not set up/.test(e.message) ? e.message : 'Could not reach the server. Check your connection.' };
    } finally { clearTimeout(timer); }
  }

  return {
    link,
    // { id?, title, form } -> { id, link } ; with no id a new link is made, with one the same link is updated
    async publish({ id, title, form }) {
      const r = await call('publish', { id, title, form });
      return r.error ? r : { id: r.id, count: r.count, link: link(r.id) };
    },
    // { id, after } -> { count, open, responses: [{ n, at, answers }] }; only answers newer than `after` come back
    pull: ({ id, after }) => call('pull', { id, after }),
    setOpen: ({ id, open }) => call('open', { id, open }),
    remove: ({ id }) => call('remove', { id }),
  };
}

module.exports = { createFormsCloud };
