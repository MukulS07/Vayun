// Assistant side panel (Ctrl+J). Sends the request to the NVIDIA API through the main process,
// applies the validated actions, and offers Undo for each run. Model text is only ever set as textContent.
(function () {
  const A = FolioAssistant;
  let panel = null;
  let history = []; // earlier turns sent back for context: [{ role, content }]
  let busy = false;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function newPage(title, blocks) {
    const page = { id: uid(), title, parentId: null, blocks: blocks.length ? blocks : [{ id: uid(), type: 'text', text: '' }] };
    data.pages.push(page);
    return page;
  }

  // Applies actions to the workspace and returns one line per result for the panel.
  function apply(actions) {
    const lines = [];
    let target = null;
    const withIds = blocks => blocks.map(b => ({ id: uid(), ...b }));
    for (const a of actions) {
      if (a.type === 'add_blocks') {
        let page = target || current;
        if (!page || page.kind === 'template' || isDb(page)) page = newPage('Assistant notes', []);
        const fresh = withIds(a.blocks);
        const empty = page.blocks.length === 1 && page.blocks[0].type === 'text' && !page.blocks[0].text;
        page.blocks = empty ? fresh : [...page.blocks, ...fresh];
        target = page;
        lines.push(`Added ${plural(fresh.length, 'block')} to "${page.title || 'Untitled'}"`);
      } else if (a.type === 'create_page') {
        target = newPage(a.title, withIds(a.blocks));
        lines.push(`Created page "${a.title}"`);
      } else if (a.type === 'rename_page') {
        const page = target || current;
        if (page) { page.title = a.title; target = page; lines.push(`Renamed the page to "${a.title}"`); }
      } else if (a.type === 'open_page') {
        const found = data.pages.find(p => (p.title || '').toLowerCase() === a.title.toLowerCase())
          || data.pages.find(p => (p.title || '').toLowerCase().includes(a.title.toLowerCase()));
        if (found) { target = found; lines.push(`Opened "${found.title}"`); } else lines.push(`No page named "${a.title}"`);
      } else if (a.type === 'create_template') {
        const id = uid();
        data.pages.push(FolioTemplates.makeTemplatePage(id, a.template, { theme: a.theme, sample: true }));
        target = byId(id);
        lines.push(`Created a ${a.template === 'life' ? 'Life OS' : 'Study OS'} page`);
      }
    }
    if (target) openPage(target.id); else render();
    save();
    return lines;
  }

  function build() {
    panel = el('aside', 'ai-panel');
    panel.setAttribute('aria-label', 'Assistant');
    panel.hidden = true;
    const head = el('div', 'ai-head');
    const title = el('div', 'ai-title');
    title.append(el('span', 'ai-spark', '✦'), el('span', null, 'Assistant'), el('span', 'ai-badge', 'NVIDIA'));
    const gear = el('button', 'icon-btn', '⚙');
    gear.type = 'button';
    gear.setAttribute('aria-label', 'Assistant settings');
    gear.onclick = () => showSettings();
    const close = el('button', 'icon-btn', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close assistant');
    close.onclick = () => toggle(false);
    const tools = el('div', 'ai-tools');
    tools.append(gear, close);
    head.append(title, tools);
    const body = el('div', 'ai-body');
    panel.append(head, body);
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
    document.body.append(panel);
  }

  const body = () => panel.querySelector('.ai-body');

  async function showSettings(note) {
    const st = await api.aiStatus();
    const b = body();
    b.innerHTML = '';
    const form = el('form', 'ai-settings');
    form.append(el('p', 'ai-help', note || 'Connect the assistant to NVIDIA. Get a free API key at build.nvidia.com (profile menu → API Keys). The key is stored encrypted on this PC and is only sent to NVIDIA.'));
    const keyLabel = el('label', null, 'API key');
    const key = el('input');
    key.type = 'password';
    key.autocomplete = 'off';
    key.placeholder = st.hasKey ? 'Saved. Paste a new key to replace it' : 'nvapi-…';
    keyLabel.append(key);
    const modelLabel = el('label', null, 'Model');
    const model = el('input');
    model.value = st.model;
    model.spellcheck = false;
    const options = el('datalist');
    options.id = 'ai-models';
    for (const id of st.models || []) { const o = el('option'); o.value = id; options.append(o); }
    model.setAttribute('list', 'ai-models');
    modelLabel.append(model, options);
    const err = el('p', 'ai-error');
    err.hidden = true;
    const row = el('div', 'ai-row');
    const saveBtn = el('button', 'primary', 'Save');
    saveBtn.type = 'submit';
    row.append(saveBtn);
    if (st.hasKey) {
      const remove = el('button', null, 'Remove key');
      remove.type = 'button';
      remove.onclick = async () => { await api.aiClearKey(); showSettings('Key removed.'); };
      const back = el('button', null, 'Back to chat');
      back.type = 'button';
      back.onclick = () => showChat();
      row.append(back, remove);
    }
    form.append(keyLabel, modelLabel, err, row);
    form.onsubmit = async e => {
      e.preventDefault();
      if (!key.value.trim() && !st.hasKey) { err.textContent = 'Paste your NVIDIA API key.'; err.hidden = false; return; }
      const r = await api.aiSetKey(key.value, model.value);
      key.value = '';
      if (r.error) { err.textContent = r.error; err.hidden = false; return; }
      showChat();
    };
    b.append(form);
    (st.hasKey ? model : key).focus();
  }

  function bubble(cls, text) {
    const log = panel.querySelector('.ai-log');
    const m = el('div', `ai-msg ${cls}`, text);
    log.append(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }

  const EXAMPLES = ['Make a checklist for this week', 'Create a page with a 7-day exam study plan', 'Add 5 ideas for a birthday party', 'Create a Study OS planner'];

  function showChat() {
    const b = body();
    b.innerHTML = '';
    const log = el('div', 'ai-log');
    log.setAttribute('aria-live', 'polite');
    if (!history.length) {
      log.append(el('p', 'ai-help', 'Tell me what to do. I can write checklists and notes into this page, create pages, rename or open pages, and set up planners.'));
      const ex = el('div', 'ai-examples');
      for (const t of EXAMPLES) {
        const chip = el('button', 'ai-example', t);
        chip.type = 'button';
        chip.onclick = () => { input.value = t; send(); };
        ex.append(chip);
      }
      log.append(ex);
    }
    const form = el('form', 'ai-compose');
    const input = el('textarea');
    input.rows = 2;
    input.placeholder = 'Ask or tell the assistant…';
    input.setAttribute('aria-label', 'Message to the assistant');
    input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    const go = el('button', 'primary', 'Send');
    go.type = 'submit';
    form.append(input, go);
    form.onsubmit = e => { e.preventDefault(); send(); };
    b.append(log, form);
    input.focus();

    async function send() {
      const text = input.value.trim();
      if (!text || busy) return;
      busy = true;
      go.disabled = true;
      log.querySelector('.ai-examples')?.remove();
      input.value = '';
      bubble('user', text);
      const wait = bubble('bot thinking', 'Thinking…');
      const ctx = { page: current && { title: current.title, kind: current.kind, blocks: current.blocks }, pageTitles: data.pages.filter(p => !p.props).map(p => p.title) };
      const r = await api.aiChat(A.buildMessages(text, ctx, history));
      wait.remove();
      busy = false;
      go.disabled = false;
      if (r.error) {
        bubble('bot error', r.error);
        if (/key/i.test(r.error)) showSettings(r.error);
        return;
      }
      const { reply, actions } = A.parseReply(r.content);
      const valid = A.sanitizeActions(actions);
      const snapshot = JSON.parse(JSON.stringify(data.pages));
      const before = current?.id;
      const lines = valid.length ? apply(valid) : [];
      const m = bubble('bot', reply || (lines.length ? 'Done.' : 'I could not work out what to change.'));
      if (lines.length) {
        const done = el('ul', 'ai-done');
        for (const l of lines) done.append(el('li', null, l));
        const undo = el('button', 'ai-undo', 'Undo');
        undo.type = 'button';
        undo.onclick = () => {
          data.pages = snapshot;
          openPage(byId(before) ? before : data.pages[0].id);
          save();
          undo.disabled = true;
          undo.textContent = 'Undone';
        };
        m.append(done, undo);
      }
      history.push({ role: 'user', content: text }, { role: 'assistant', content: JSON.stringify({ reply, actions: valid }) });
      history = history.slice(-12);
      input.focus();
    }
  }

  async function toggle(open = panel?.hidden ?? true) {
    if (!panel) build();
    panel.hidden = !open;
    document.body.classList.toggle('ai-open', open);
    if (!open) return;
    const st = await api.aiStatus();
    if (st.hasKey) showChat(); else showSettings();
  }

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); toggle(); }
  });
  document.getElementById('ai-btn')?.addEventListener('click', () => toggle());

  window.FolioAssistantUI = { open: () => toggle(true), toggle, apply };
})();
