// Settings → Appearance modal. Changes apply live; Reset restores the defaults.
// Strings and option sets follow design/Main.dc.html.
(function () {
  const T = FolioTheme;
  const ACCENTS = [
    ['Theme default', null], ['Cobalt', '#3D5AFE'], ['Violet', '#7B4FE0'], ['Rose', '#C9405F'],
    ['Ember', '#D2561E'], ['Emerald', '#1F7A4D'], ['Teal', '#0E7C86'], ['Graphite', '#3A3A44'],
  ];
  const FONTS = [['sans', 'Default'], ['serif', 'Serif'], ['mono', 'Mono']];
  const SEGMENTS = [
    ['density', 'Density', [['comfy', 'Comfortable'], ['compact', 'Compact']]],
    ['radius', 'Corners', [['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Round']]],
    ['width', 'Page width', [['default', 'Default'], ['full', 'Full width']]],
  ];
  const OFFICIAL = ['paper', 'midnight', 'sepia', 'forest', 'ocean', 'ember', 'grove', 'rose'];

  let modal = null;

  // getState/setState: app.js owns the data; this module only reads and updates the appearance object.
  function open(getState, setState) {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'backdrop visible settings-backdrop';
    modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
    const panel = document.createElement('div');
    panel.className = 'settings';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Appearance');
    modal.append(panel);
    document.body.append(modal);

    const render = () => {
      const a = getState();
      const info = FOLIO_APP_THEMES;
      const set = patch => { setState(T.sanitizeAppearance({ ...getState(), ...patch })); render(); };
      panel.innerHTML = '';
      panel.append(header(close));

      panel.append(section('Folio themes', 'Official', gallery(OFFICIAL.map(id => [id, info[id]]), a.theme, id => set({ theme: id }))));
      panel.append(section('Your workspace themes', 'Shared with everyone at Acme Studio', gallery([['acme', info.acme]], a.theme, id => set({ theme: id }))));

      panel.append(row('Accent color', 'Buttons, links, selection and checkboxes', accentPicker(a.accent, c => set({ accent: c }), info[a.theme])));
      panel.append(row('Page font', 'Default for new pages; override per page', fontPicker(a.font, f => set({ font: f }))));
      for (const [key, label, opts] of SEGMENTS) {
        panel.append(row(label, hintFor(key), segmented(label, opts, a[key], v => set({ [key]: v }))));
      }
      panel.append(footer(() => { setState(T.sanitizeAppearance(T.DEFAULT_APPEARANCE)); render(); }, close));
    };
    render();
    panel.querySelector('button')?.focus();
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  function close() {
    if (!modal) return;
    modal.remove();
    modal = null;
  }

  function hintFor(key) {
    return { density: 'Spacing in sidebar, lists and boards', radius: 'Roundness of cards, buttons and menus', width: 'How wide docs read on large screens' }[key];
  }

  function header(onClose) {
    const h = document.createElement('div');
    h.className = 'settings-head';
    h.innerHTML = '<div><h2>Appearance</h2><p class="muted">Make Folio feel like yours. Changes preview live behind this window.</p></div>';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'icon-btn';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '×';
    x.onclick = onClose;
    h.append(x);
    return h;
  }

  function section(title, badge, body) {
    const s = document.createElement('section');
    s.className = 'settings-section';
    const t = document.createElement('div');
    t.className = 'settings-title';
    t.innerHTML = `<h3></h3>${badge ? '<span class="badge"></span>' : ''}`;
    t.querySelector('h3').textContent = title;
    if (badge) t.querySelector('.badge').textContent = badge;
    s.append(t, body);
    return s;
  }

  function row(title, hint, control) {
    const r = document.createElement('div');
    r.className = 'settings-row';
    const left = document.createElement('div');
    left.className = 'settings-hint';
    left.innerHTML = '<div class="strong"></div><div class="muted small"></div>';
    left.children[0].textContent = title;
    left.children[1].textContent = hint;
    r.append(left, control);
    return r;
  }

  function gallery(items, current, pick) {
    const g = document.createElement('div');
    g.className = 'theme-grid';
    for (const [id, t] of items) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'theme-card';
      card.setAttribute('aria-pressed', String(current === id));
      card.dataset.theme = id;
      card.innerHTML = '<div class="preview"><div class="pv-side"></div><div class="pv-body"><i></i><b></b><b class="w"></b><u></u></div></div><div class="theme-meta"><span class="tn"></span><span class="tm"></span></div>';
      const prev = card.querySelector('.preview');
      prev.style.background = t.bg;
      prev.style.borderColor = t.line;
      card.querySelector('.pv-side').style.background = t.side;
      const body = card.querySelector('.pv-body');
      body.querySelector('i').style.background = t.cover;
      body.querySelectorAll('b').forEach((b, i) => { b.style.background = i ? t.lineSoft : t.text; });
      body.querySelector('u').style.background = t.accent;
      card.querySelector('.tn').textContent = t.name;
      card.querySelector('.tm').textContent = t.mode;
      if (current === id) card.classList.add('on');
      card.onclick = () => pick(id);
      g.append(card);
    }
    return g;
  }

  function accentPicker(current, pick, theme) {
    const wrap = document.createElement('div');
    wrap.className = 'swatches';
    for (const [name, hex] of ACCENTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + ((hex === null && current === null) || hex === current ? ' on' : '');
      b.setAttribute('aria-label', name);
      b.setAttribute('aria-pressed', String(((hex === null && current === null) || hex === current)));
      b.style.background = hex || theme.accent;
      if (hex === null) b.classList.add('default');
      b.onclick = () => pick(hex);
      wrap.append(b);
    }
    return wrap;
  }

  function fontPicker(current, pick) {
    const wrap = document.createElement('div');
    wrap.className = 'font-picks';
    for (const [id, label] of FONTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'font-pick' + (current === id ? ' on' : '');
      b.setAttribute('aria-pressed', String(current === id));
      b.innerHTML = '<span class="sample"></span><span class="muted small"></span>';
      b.querySelector('.sample').style.fontFamily = T.FONTS[id];
      b.querySelector('.sample').textContent = 'Ag';
      b.querySelector('.small').textContent = label;
      b.onclick = () => pick(id);
      wrap.append(b);
    }
    return wrap;
  }

  function segmented(label, opts, current, pick) {
    const g = document.createElement('div');
    g.className = 'segmented';
    g.setAttribute('role', 'radiogroup');
    g.setAttribute('aria-label', label);
    for (const [id, text] of opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(current === id));
      b.className = current === id ? 'on' : '';
      b.textContent = text;
      b.onclick = () => pick(id);
      g.append(b);
    }
    return g;
  }

  function footer(onReset, onDone) {
    const f = document.createElement('div');
    f.className = 'settings-foot';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'ghost';
    reset.textContent = 'Reset';
    reset.onclick = onReset;
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'primary';
    done.textContent = 'Done';
    done.onclick = onDone;
    f.append(reset, done);
    return f;
  }

  window.FolioAppearance = { open, close };
})();
