// Assistant side panel (Ctrl+J). Sends the request to the active AI service through the main process (or the Vayun AI
// server on phones and the web), applies the validated actions, and offers Undo. Model text is only ever set as textContent.
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

  const findByTitle = t => data.pages.find(p => (p.title || '').toLowerCase() === t.toLowerCase())
    || data.pages.find(p => (p.title || '').toLowerCase().includes(t.toLowerCase()));

  function newPage(title, blocks, parentId = null) {
    const page = { id: uid(), title, parentId, blocks: blocks.length ? blocks : [{ id: uid(), type: 'text', text: '' }] };
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
        // A parent makes it a subpage (a mind map node); the view stays where it is.
        const parent = !a.parent ? null : a.parent.toLowerCase() === 'current' ? current : findByTitle(a.parent) || current;
        const page = newPage(a.title, withIds(a.blocks), parent ? parent.id : null);
        if (parent) lines.push(`Added "${a.title}" under "${parent.title || 'Untitled'}"`);
        else { target = page; lines.push(`Created page "${a.title}"`); }
      } else if (a.type === 'rename_page') {
        const page = target || current;
        if (page) { page.title = a.title; target = page; lines.push(`Renamed the page to "${a.title}"`); }
      } else if (a.type === 'open_page') {
        const found = findByTitle(a.title);
        if (found) { target = found; lines.push(`Opened "${found.title}"`); } else lines.push(`No page named "${a.title}"`);
      } else if (a.type === 'create_template') {
        const id = uid();
        data.pages.push(FolioTemplates.makeTemplatePage(id, a.template, { theme: a.theme, sample: true }));
        target = byId(id);
        lines.push(`Created a ${a.template === 'life' ? 'Life OS' : 'Study OS'} page`);
      }
    }
    const view = mode === 'mindmap' ? 'mindmap' : 'doc';
    openPage((target || current).id, view);
    save();
    return lines;
  }

  const detect = raw => (window.FolioAiProviders ? window.FolioAiProviders.detectProvider(raw) : null);
  const TIER_LABEL = { auto: 'Auto', fast: 'Fast', smart: 'Smart' };
  const TIER_HINT = { auto: 'Quick for short asks, stronger for long ones', fast: 'Quickest answers', smart: 'Best for big plans and long notes' };
  const QUICK = [
    ['Make a checklist', 'for this week', 'Make a checklist for this week'],
    ['Plan my week', 'days and priorities', 'Plan my week: create a page with a simple day-by-day plan and my top priorities'],
    ['Study plan', 'a 7-day exam plan', 'Create a page with a 7-day exam study plan'],
    ['Brainstorm ideas', '5 for a birthday party', 'Add 5 ideas for a birthday party'],
    ['Summarize this page', 'key points as a list', 'Summarize this page as a short list of key points and add it to the page'],
    ['Set up a planner', 'Life OS or Study OS', 'Create a Study OS planner'],
  ];

  let status = null;      // the latest answer from api.aiStatus()
  let transcript = [];    // what the panel shows, so it can be redrawn when the panel is reopened
  let popover = null;

  function build() {
    panel = el('aside', 'ai-panel');
    panel.setAttribute('aria-label', 'Assistant');
    panel.hidden = true;
    const head = el('div', 'ai-head');
    const title = el('div', 'ai-title');
    title.append(el('span', 'ai-spark', '✦'), el('span', null, 'Assistant'));
    const chip = el('button', 'ai-model');
    chip.type = 'button';
    chip.setAttribute('aria-haspopup', 'true');
    chip.setAttribute('aria-label', 'Choose the model and answer style');
    chip.hidden = true;
    chip.onclick = e => { e.stopPropagation(); togglePopover(); };
    const gear = el('button', 'icon-btn', '⚙');
    gear.type = 'button';
    gear.setAttribute('aria-label', 'Assistant settings');
    gear.onclick = () => { closePopover(); showSettings(); };
    const close = el('button', 'icon-btn', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close assistant');
    close.onclick = () => toggle(false);
    const tools = el('div', 'ai-tools');
    tools.append(chip, gear, close);
    head.append(title, tools);
    const body = el('div', 'ai-body');
    panel.append(head, body);
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { if (popover) closePopover(); else toggle(false); } });
    panel.addEventListener('click', e => { if (popover && !popover.contains(e.target)) closePopover(); });
    document.body.append(panel);
  }

  const body = () => panel.querySelector('.ai-body');

  // ---- the model chip and its menu ----
  function chipLabel(st) {
    if (!st || !st.hasKey && !st.cloud) return '';
    if (st.cloud) return `Vayun AI · ${TIER_LABEL[st.tier] || 'Auto'}`;
    const a = st.active || {};
    return `${a.name || 'AI'} · ${a.model ? 'custom' : TIER_LABEL[a.tier] || 'Auto'}`;
  }

  function paintChip(st) {
    status = st;
    const chip = panel && panel.querySelector('.ai-model');
    if (!chip) return;
    const label = chipLabel(st);
    chip.hidden = !label || (st.cloud && !st.signedIn);
    chip.textContent = '';
    chip.append(el('span', null, label), el('span', 'ai-caret', '▾'));
  }

  async function refresh() { const st = await api.aiStatus(); paintChip(st); return st; }

  async function setTier(tier) {
    const st = status || (await api.aiStatus());
    if (st.cloud) await api.aiSetPrefs({ tier }); else await api.aiSelect({ tier });
    const next = await refresh();
    return next;
  }

  function closePopover() { if (popover) { popover.remove(); popover = null; } panel.querySelector('.ai-model')?.setAttribute('aria-expanded', 'false'); }

  async function togglePopover() {
    if (popover) return closePopover();
    const st = await refresh();
    const pop = el('div', 'ai-pop');
    pop.setAttribute('role', 'menu');
    pop.append(el('div', 'ai-pop-title', 'Answer style'));
    const seg = el('div', 'ai-seg');
    seg.setAttribute('role', 'group');
    const tier = st.cloud ? st.tier : st.active.tier;
    for (const t of ['auto', 'fast', 'smart']) {
      const b = el('button', tier === t ? 'on' : '', TIER_LABEL[t]);
      b.type = 'button';
      b.title = TIER_HINT[t];
      b.setAttribute('aria-pressed', String(tier === t));
      b.onclick = async () => { await setTier(t); closePopover(); togglePopover(); };
      seg.append(b);
    }
    pop.append(seg, el('p', 'ai-pop-hint', TIER_HINT[tier]));
    if (!st.cloud && st.keys.length) {
      pop.append(el('div', 'ai-pop-title', st.keys.length > 1 ? 'Service' : 'Connected service'));
      for (const k of st.keys) {
        const choice = st.choices.find(c => c.provider === k.provider);
        const row = el('button', `ai-svc${st.active.provider === k.provider ? ' on' : ''}`);
        row.type = 'button';
        row.append(el('i', 'ai-radio'), el('span', 'ai-svc-name', k.name), el('span', 'ai-svc-key', k.last4 ? `····${k.last4}` : ''));
        row.onclick = async () => { await api.aiSelect({ provider: k.provider }); await refresh(); closePopover(); togglePopover(); };
        pop.append(row);
        if (st.active.provider === k.provider && choice) {
          const model = el('label', 'ai-pop-model');
          model.append(el('span', null, 'Model'));
          const input = el('input');
          input.value = st.active.model || st.model;
          input.spellcheck = false;
          input.setAttribute('list', 'ai-models');
          const list = el('datalist');
          list.id = 'ai-models';
          for (const m of choice.models) { const o = el('option'); o.value = m; list.append(o); }
          input.onkeydown = async e => { if (e.key === 'Enter') { e.preventDefault(); await api.aiSelect({ model: input.value }); await refresh(); closePopover(); } };
          input.onchange = async () => { await api.aiSelect({ model: input.value }); await refresh(); };
          model.append(input, list);
          pop.append(model, el('p', 'ai-pop-hint', 'Pick one from the list or type any model the service offers. Choose an answer style above to go back to automatic.'));
        }
      }
    }
    const manage = el('button', 'ai-pop-link', st.cloud ? 'Free messages and your own key…' : 'Add or remove keys…');
    manage.type = 'button';
    manage.onclick = () => { closePopover(); showSettings(); };
    pop.append(manage);
    panel.querySelector('.ai-head').append(pop);
    popover = pop;
    panel.querySelector('.ai-model')?.setAttribute('aria-expanded', 'true');
  }

  // ---- settings ----
  async function showSettings(note) {
    const st = await refresh();
    if (st.cloud) return showCloudSettings(st, note);
    const b = body();
    b.innerHTML = '';
    const wrap = el('div', 'ai-settings');
    wrap.append(el('h3', 'ai-h', st.hasKey ? 'Connected services' : 'Connect an AI service'));
    wrap.append(el('p', 'ai-help', note || (st.hasKey
      ? 'The Assistant uses the active service. If it runs out or is down, it quietly tries the next one.'
      : 'Paste an API key from OpenAI, Claude, Gemini, Groq, NVIDIA, OpenRouter, xAI or AI/ML API. Vayun works out which service it is for. The key is stored encrypted on this PC and only sent to that service.')));
    for (const k of st.keys) {
      const card = el('div', 'ai-card');
      const row = el('div', 'ai-keyrow');
      const left = el('span', 'ai-keyname', `${k.name}${k.last4 ? ' ····' + k.last4 : ''}`);
      row.append(left);
      if (st.active.provider === k.provider) row.append(el('span', 'ai-tag', 'Active'));
      else {
        const use = el('button', null, 'Use');
        use.type = 'button';
        use.onclick = async () => { await api.aiSelect({ provider: k.provider }); showSettings(); };
        row.append(use);
      }
      const rm = el('button', 'ai-danger', 'Remove');
      rm.type = 'button';
      rm.onclick = async () => { rm.disabled = true; await api.aiClearKey(k.provider); showSettings('Key removed.'); };
      row.append(rm);
      card.append(row);
      wrap.append(card);
    }
    const form = el('form', 'ai-card ai-add');
    form.append(el('div', 'ai-card-title', st.hasKey ? 'Add another key' : 'Add a key'));
    const key = el('input');
    key.type = 'password';
    key.autocomplete = 'off';
    key.spellcheck = false;
    key.placeholder = 'Paste your API key';
    key.setAttribute('aria-label', 'API key');
    const seen = el('p', 'ai-detect');
    key.oninput = () => {
      const p = key.value.trim() ? detect(key.value) : null;
      seen.textContent = key.value.trim() ? (p ? `Looks like a ${p.name} key` : 'Not recognised yet. Check that you copied all of it.') : '';
      seen.className = `ai-detect${p ? ' ok' : ''}`;
    };
    const err = el('p', 'ai-error');
    err.hidden = true;
    const save = el('button', 'primary', 'Test and save');
    save.type = 'submit';
    const help = el('details', 'ai-where');
    help.append(el('summary', null, 'Where do I get a key?'));
    const ul = el('ul');
    for (const p of st.providers) { const li = el('li'); const a = el('a', null, p.name); a.href = p.keyHelp; a.target = '_blank'; a.rel = 'noreferrer'; li.append(a); ul.append(li); }
    help.append(ul);
    form.append(key, seen, err, save, help);
    form.onsubmit = async e => {
      e.preventDefault();
      if (!key.value.trim()) return;
      save.disabled = true;
      save.textContent = 'Checking the key…';
      const r = await api.aiSetKey(key.value);
      save.disabled = false;
      save.textContent = 'Test and save';
      if (r.error) { err.textContent = r.error; err.hidden = false; return; }
      key.value = '';
      showSettings(r.warning || `${r.added.name} key ending ${r.added.last4} is saved.`);
    };
    wrap.append(form);
    if (st.hasKey) {
      const back = el('button', 'primary', 'Back to chat');
      back.type = 'button';
      back.onclick = () => showChat();
      wrap.append(back);
    }
    b.append(wrap);
    if (!st.hasKey) key.focus();
  }

  // Cloud mode (phones and the web): answers come from the Vayun AI server, with the person's own key (saved on the
  // website, same Google account) or a shared daily allowance. Nothing to paste here.
  function showCloudSettings(st, note) {
    const b = body();
    b.innerHTML = '';
    const wrap = el('div', 'ai-settings ai-cloud');
    wrap.append(el('h3', 'ai-h', 'Assistant'));
    wrap.append(el('p', 'ai-help', note || 'The Assistant works with your Vayun sign-in. There is nothing to set up.'));
    if (!st.signedIn) {
      wrap.append(el('p', 'ai-help', st.error || 'Sign in with Google to use the Assistant.'));
      const signIn = el('button', 'primary', 'Sign in with Google');
      signIn.type = 'button';
      signIn.onclick = async () => { signIn.disabled = true; const r = await api.authSignIn(); if (r && r.error) alert(r.error); showSettings(); };
      wrap.append(signIn);
      b.append(wrap);
      return;
    }
    const card = el('div', 'ai-card');
    if (st.own.length) {
      card.append(el('div', 'ai-card-title', 'Your own key'));
      for (const k of st.own) {
        const row = el('div', 'ai-keyrow');
        row.append(el('span', 'ai-keyname', `${k.name} ····${k.last4}`));
        const rm = el('button', 'ai-danger', 'Remove');
        rm.type = 'button';
        rm.onclick = async () => { rm.disabled = true; const r = await api.aiClearKey(k.provider); showSettings(r && r.error ? r.error : 'Key removed.'); };
        row.append(rm);
        card.append(row);
      }
      card.append(el('p', 'ai-help', 'Answers use your key, so there is no daily limit.'));
    } else if (st.pool.available) {
      card.append(el('div', 'ai-card-title', 'Free messages today'));
      const meter = el('div', 'ai-meter');
      const fill = el('i');
      fill.style.width = `${Math.min(100, Math.round((st.pool.used / Math.max(1, st.pool.limit)) * 100))}%`;
      meter.append(fill);
      card.append(meter, el('p', 'ai-help', `${st.pool.left} of ${st.pool.limit} left. They reset tomorrow.`));
    } else {
      card.append(el('p', 'ai-help', 'No shared allowance is set up yet. Add your own key on the Vayun website.'));
    }
    wrap.append(card);

    const seg = el('div', 'ai-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Answer style');
    for (const t of ['auto', 'fast', 'smart']) {
      const btn = el('button', st.tier === t ? 'on' : '', TIER_LABEL[t]);
      btn.type = 'button';
      btn.title = TIER_HINT[t];
      btn.setAttribute('aria-pressed', String(st.tier === t));
      btn.onclick = async () => { await api.aiSetPrefs({ tier: t }); showSettings(note); };
      seg.append(btn);
    }
    wrap.append(el('div', 'ai-card-title', 'Answer style'), seg);

    const more = el('div', 'ai-card');
    more.append(el('div', 'ai-card-title', 'Use your own key'),
      el('p', 'ai-help', 'Add a key from OpenAI, Claude, Gemini, Groq, NVIDIA and others on the Vayun website, signed in with this same Google account. It shows up here by itself, with no daily limit.'));
    if (st.siteUrl) {
      const open = el('button', null, 'Open the website');
      open.type = 'button';
      open.onclick = () => window.open(st.siteUrl.replace(/\/$/, '') + '/ai-keys', '_blank');
      more.append(open);
    }
    wrap.append(more);
    if (st.hasKey) {
      const back = el('button', 'primary', 'Back to chat');
      back.type = 'button';
      back.onclick = () => showChat();
      wrap.append(back);
    }
    b.append(wrap);
  }

  // ---- chat ----
  // One row of the transcript: { cls, text, lines, note, quota, undo: { run, done } }
  function drawEntry(entry) {
    const m = el('div', `ai-msg ${entry.cls}`);
    if (entry.cls.startsWith('bot') && !entry.cls.includes('error')) m.append(el('span', 'ai-avatar', '✦'));
    const text = el('div', 'ai-text', entry.text);
    m.append(text);
    if (entry.lines && entry.lines.length) {
      const done = el('ul', 'ai-done');
      for (const l of entry.lines) done.append(el('li', null, l));
      m.append(done);
      if (entry.undo) {
        const undo = el('button', 'ai-undo', entry.undo.done ? 'Undone' : '↶ Undo');
        undo.type = 'button';
        undo.disabled = Boolean(entry.undo.done);
        undo.onclick = () => { entry.undo.run(); entry.undo.done = true; undo.disabled = true; undo.textContent = 'Undone'; };
        m.append(undo);
      }
    }
    if (entry.note) m.append(el('div', 'ai-note', entry.note));
    if (entry.quota) m.append(el('div', 'ai-quota', entry.quota));
    return m;
  }

  function showChat() {
    const b = body();
    b.innerHTML = '';
    const log = el('div', 'ai-log');
    log.setAttribute('aria-live', 'polite');
    const form = el('form', 'ai-compose');
    const box = el('div', 'ai-box');
    const input = el('textarea');
    input.rows = 1;
    input.placeholder = 'Ask or tell the assistant…';
    input.setAttribute('aria-label', 'Message to the assistant');
    const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; };
    input.oninput = grow;
    input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    const mic = el('button', 'ai-mic', '🎙');
    mic.type = 'button';
    mic.title = 'Speak instead of typing (Windows voice typing). Press Send when done.';
    mic.setAttribute('aria-label', 'Dictate');
    mic.onclick = async () => { input.focus(); const r = await api.startDictation(); if (r?.error) mic.title = r.error; };
    const go = el('button', 'ai-send', '↑');
    go.type = 'submit';
    go.setAttribute('aria-label', 'Send');
    box.append(input, mic, go);
    const hint = el('div', 'ai-hint');
    hint.append(el('span', null, 'Enter to send · Shift+Enter for a new line'), el('span', 'ai-hint-model', status && status.model ? status.model : ''));
    form.append(box, hint);
    form.onsubmit = e => { e.preventDefault(); send(); };
    b.append(log, form);

    if (!transcript.length) {
      const hero = el('div', 'ai-hero');
      hero.append(el('h3', null, 'What should we work on?'), el('p', 'ai-help', 'I can write into this page, create and rename pages, plan, and set up planners. Changes can be undone.'));
      const grid = el('div', 'ai-quick');
      for (const [title, sub, prompt] of QUICK) {
        const card = el('button', 'ai-quick-card');
        card.type = 'button';
        card.append(el('b', null, title), el('span', null, sub));
        card.onclick = () => { input.value = prompt; send(); };
        grid.append(card);
      }
      hero.append(grid);
      log.append(hero);
    } else {
      for (const entry of transcript) log.append(drawEntry(entry));
      log.scrollTop = log.scrollHeight;
    }
    input.focus();

    const add = entry => { transcript.push(entry); const node = drawEntry(entry); log.append(node); log.scrollTop = log.scrollHeight; return node; };

    async function send() {
      const text = input.value.trim();
      if (!text || busy) return;
      busy = true;
      go.disabled = true;
      log.querySelector('.ai-hero')?.remove();
      input.value = '';
      grow();
      add({ cls: 'user', text });
      const wait = el('div', 'ai-msg bot thinking');
      wait.append(el('span', 'ai-avatar', '✦'), el('span', 'ai-dots'));
      wait.querySelector('.ai-dots').append(el('i'), el('i'), el('i'));
      log.append(wait);
      log.scrollTop = log.scrollHeight;
      const ctx = { view: mode, subpages: data.pages.filter(p => p.parentId === current?.id).map(p => p.title), page: current && { title: current.title, kind: current.kind, blocks: current.blocks }, pageTitles: data.pages.map(p => p.title) };
      const r = await api.aiChat(A.buildMessages(text, ctx, history));
      wait.remove();
      busy = false;
      go.disabled = false;
      if (r.error) {
        add({ cls: 'bot error', text: r.error });
        if (r.code === 'signin' || r.code === 'no-key' || (!r.code && /key/i.test(r.error))) showSettings(r.error);
        return;
      }
      const { reply, actions } = A.parseReply(r.content);
      const valid = A.sanitizeActions(actions);
      const snapshot = JSON.parse(JSON.stringify(data.pages));
      const before = current?.id;
      const lines = valid.length ? apply(valid) : [];
      const entry = { cls: 'bot', text: reply || (lines.length ? 'Done.' : 'I could not work out what to change.'), lines };
      if (lines.length) {
        entry.undo = { done: false, run: () => { data.pages = snapshot; openPage(byId(before) ? before : data.pages[0].id, mode === 'mindmap' ? 'mindmap' : 'doc'); save(); } };
      }
      if (r.switchedFrom && status && status.choices) {
        const from = (status.keys.find(k => k.provider === r.switchedFrom) || {}).name || 'The active service';
        const by = (status.keys.find(k => k.provider === r.provider) || {}).name || r.provider;
        entry.note = `${from} could not answer, so ${by} did.`;
      }
      if (r.source === 'pool' && typeof r.left === 'number' && r.left <= 3) entry.quota = `${r.left} free message${r.left === 1 ? '' : 's'} left today`;
      add(entry);
      history.push({ role: 'user', content: text }, { role: 'assistant', content: JSON.stringify({ reply, actions: valid }) });
      history = history.slice(-12);
      input.focus();
    }
  }

  async function toggle(open = panel?.hidden ?? true) {
    if (!panel) build();
    panel.hidden = !open;
    document.body.classList.toggle('ai-open', open);
    if (!open) { closePopover(); return; }
    const st = await refresh();
    if (st.hasKey) showChat(); else showSettings();
  }

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); toggle(); }
  });
  document.getElementById('ai-btn')?.addEventListener('click', () => toggle());

  window.FolioAssistantUI = { open: () => toggle(true), toggle, apply };
})();
