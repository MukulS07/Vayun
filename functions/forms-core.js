// Public forms: the rules, with no Firebase in here so the tests can run them. index.js gives it a real store.
// What each call costs Firestore (the free plan allows 50,000 reads and 20,000 writes a day):
//   publish   1 write (+1 small count when it is a new form)         view      0 or 1 read (kept 60 s in memory)
//   submit    1 read + 2 writes (+1 read if the form is not in      pull      1 read + 1 read per NEW response
//             memory yet), whatever the size of the form
// Nothing listens live, and the owner's app asks only for responses newer than the last one it already has.
// Limits that keep a runaway link from using the allowance: a total per form, a per-day total per form, a per-visitor
// speed limit (index.js) and a size limit on every answer sheet.
const crypto = require('node:crypto');
const logic = require('./forms-logic');

const LIMITS = {
  total: 5000,        // responses one form keeps
  perDay: 1000,       // responses one form accepts per day
  forms: 25,          // published forms per person
  pull: 500,          // responses sent in one pull
  definition: 60_000, // characters in a published form
  answers: 20_000,    // characters in one submitted answer sheet
};

class FormsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const MESSAGE = {
  missing: 'This form does not exist, or it was removed.',
  closed: 'This form is closed and is not taking answers any more.',
  full: 'This form has reached the most responses it can take.',
  busy: 'This form has had a lot of answers today. Please try again tomorrow.',
  big: 'That is too much to send at once.',
  bad: 'Please check your answers and try again.',
  owner: 'Only the person who published this form can do that.',
  limit: 'You have reached the number of forms one account can publish. Remove one first.',
};
const fail = code => new FormsError(code, MESSAGE[code] || 'Something went wrong.');

const newId = () => crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, 'x').slice(0, 10).toLowerCase();
const dayOf = now => now.toISOString().slice(0, 10);

// What a visitor needs, and nothing the owner keeps private: no responses, no owner id, no source columns.
function publicView(doc, today) {
  const f = doc.form;
  return {
    title: doc.title, description: f.description, questions: f.questions, closesOn: f.closesOn,
    open: isTaking(doc, today),
  };
}

function isTaking(doc, today) {
  return doc.open === true && (!doc.form.closesOn || today <= doc.form.closesOn) && (doc.count || 0) < (doc.cap || LIMITS.total);
}

function createFormsCore({ store, now = () => new Date(), id = newId, cacheMs = 60_000 }) {
  const cache = new Map(); // id -> { at, doc }; keeps a popular link from reading Firestore for every visitor

  async function load(formId) {
    const hit = cache.get(formId);
    if (hit && Date.now() - hit.at < cacheMs) return hit.doc;
    const doc = await store.getForm(formId);
    if (doc) { if (cache.size > 500) cache.clear(); cache.set(formId, { at: Date.now(), doc }); }
    return doc;
  }
  const forget = formId => cache.delete(formId);

  function cleanDefinition(input) {
    const clean = logic.sanitize({ ...input, responses: [], published: true }, id);
    clean.questions = clean.questions.map(({ src, ...q }) => q); // eslint-disable-line no-unused-vars
    if (!clean.questions.length) throw fail('bad');
    if (JSON.stringify(clean).length > LIMITS.definition) throw fail('big');
    return { description: clean.description, questions: clean.questions, closesOn: clean.closesOn };
  }

  async function owned(uid, formId) {
    const doc = await store.getForm(formId);
    if (!doc) throw fail('missing');
    if (doc.ownerUid !== uid) throw fail('owner');
    return doc;
  }

  return {
    // Publishes a form, or updates the one with this id. The link stays the same, so people who have it keep it.
    async publish(uid, { id: formId, title, form }) {
      const definition = cleanDefinition(form);
      const name = String(title || 'Untitled form').slice(0, 120);
      const stamp = now().getTime();
      if (formId) {
        const doc = await owned(uid, String(formId));
        await store.updateForm(doc.id, { title: name, form: definition, open: true, updatedAt: stamp });
        forget(doc.id);
        return { id: doc.id, count: doc.count || 0 };
      }
      if ((await store.countForms(uid)) >= LIMITS.forms) throw fail('limit');
      const created = id();
      await store.createForm(created, {
        ownerUid: uid, title: name, form: definition, open: true,
        count: 0, cap: LIMITS.total, day: '', dayCount: 0, dayCap: LIMITS.perDay, createdAt: stamp, updatedAt: stamp,
      });
      return { id: created, count: 0 };
    },

    // The page a visitor sees: the questions and whether it is taking answers.
    async view(formId) {
      const doc = await load(String(formId || ''));
      if (!doc) throw fail('missing');
      return publicView(doc, dayOf(now()));
    },

    // One visitor's answers. They are checked against the published questions here; the page's own checks are only a convenience.
    async submit(formId, raw) {
      if (JSON.stringify(raw || {}).length > LIMITS.answers) throw fail('big');
      const doc = await load(String(formId || ''));
      if (!doc) throw fail('missing');
      const today = dayOf(now());
      if (!isTaking(doc, today)) throw fail(doc.open && (doc.count || 0) >= (doc.cap || LIMITS.total) ? 'full' : 'closed');
      const { errors, answers } = logic.validate({ questions: doc.form.questions }, raw && typeof raw === 'object' ? raw : {});
      if (Object.keys(errors).length) { const e = fail('bad'); e.errors = errors; throw e; }
      if (!Object.keys(answers).length) throw fail('bad');
      const result = await store.addResponse(String(formId), meta => {
        if (!meta.open || (meta.form.closesOn && today > meta.form.closesOn)) return { ok: false, code: 'closed' };
        if ((meta.count || 0) >= (meta.cap || LIMITS.total)) return { ok: false, code: 'full' };
        const used = meta.day === today ? meta.dayCount || 0 : 0;
        if (used >= (meta.dayCap || LIMITS.perDay)) return { ok: false, code: 'busy' };
        const n = (meta.count || 0) + 1;
        return { ok: true, n, patch: { count: n, day: today, dayCount: used + 1 }, response: { n, at: now().getTime(), answers } };
      });
      if (!result.ok) { forget(String(formId)); throw fail(result.code); }
      return { ok: true };
    },

    // The owner asks for what is new since the last response they have (by number), plus the form's state.
    async pull(uid, formId, after) {
      const doc = await owned(uid, String(formId || ''));
      const from = Math.max(0, Math.floor(Number(after) || 0));
      const responses = doc.count > from ? await store.listResponses(doc.id, from, LIMITS.pull) : [];
      return { count: doc.count || 0, open: doc.open === true, responses };
    },

    async setOpen(uid, formId, open) {
      const doc = await owned(uid, String(formId || ''));
      await store.updateForm(doc.id, { open: open === true, updatedAt: now().getTime() });
      forget(doc.id);
      return { open: open === true };
    },

    async remove(uid, formId) {
      const doc = await owned(uid, String(formId || ''));
      await store.deleteForm(doc.id);
      forget(doc.id);
      return { ok: true };
    },
  };
}

module.exports = { createFormsCore, FormsError, LIMITS, newId };
