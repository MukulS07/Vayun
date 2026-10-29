// "New page → Templates": choose Life OS or Study OS, a theme, and sample content or an empty page.
(function () {
  const TEMPLATES = [
    { id: 'life', name: 'Life OS', desc: 'Priorities, tasks, habits, pomodoro and a week view.' },
    { id: 'study', name: 'Study OS', desc: 'Courses, assignments, timetable, calendar and focus timer.' },
  ];

  // onCreate({ template, theme, sample }) is called when the user confirms.
  function open(onCreate, preset = {}) {
    const state = { template: preset.template || 'life', theme: preset.theme || 'dark', sample: preset.sample !== false };
    const backdrop = document.createElement('div');
    backdrop.className = 'settings-backdrop';
    const panel = document.createElement('div');
    panel.className = 'settings picker';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'New page from a template');
    backdrop.append(panel);
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    const render = () => {
      panel.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'settings-head';
      head.innerHTML = '<div><h2>New page from a template</h2><p class="muted">Start from a ready-made dashboard. Everything in it stays editable.</p></div>';
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'icon-btn';
      x.setAttribute('aria-label', 'Close');
      x.textContent = '×';
      x.onclick = close;
      head.append(x);
      panel.append(head);

      const grid = document.createElement('div');
      grid.className = 'picker-grid';
      for (const t of TEMPLATES) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'picker-card' + (state.template === t.id ? ' on' : '');
        card.setAttribute('aria-pressed', String(state.template === t.id));
        card.onclick = () => { state.template = t.id; render(); };
        const previews = document.createElement('div');
        previews.className = 'picker-previews';
        for (const mode of ['dark', 'light']) {
          const p = document.createElement('div');
          p.className = 'tpl-preview';
          p.dataset.template = t.id;
          p.dataset.theme = mode;
          p.innerHTML = '<div class="tpl-preview-cover"></div><div class="tpl-preview-lines"><i></i><i></i><i class="short"></i></div>';
          const label = document.createElement('span');
          label.className = 'tiny muted';
          label.textContent = mode === 'dark' ? 'Dark' : 'Light';
          const wrap = document.createElement('div');
          wrap.className = 'picker-preview-wrap';
          wrap.append(p, label);
          previews.append(wrap);
        }
        const name = document.createElement('div');
        name.className = 'strong';
        name.textContent = t.name;
        const desc = document.createElement('div');
        desc.className = 'tiny muted';
        desc.textContent = t.desc;
        card.append(previews, name, desc);
        grid.append(card);
      }
      panel.append(grid);

      const options = document.createElement('div');
      options.className = 'picker-options';
      options.append(choice('Theme', [['dark', 'Dark'], ['light', 'Light']], state.theme, v => { state.theme = v; render(); }));
      options.append(choice('Content', [[true, 'With sample content'], [false, 'Start empty']], state.sample, v => { state.sample = v; render(); }));
      panel.append(options);

      const foot = document.createElement('div');
      foot.className = 'settings-foot';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.onclick = close;
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'primary';
      create.textContent = 'Create page';
      create.onclick = () => { close(); onCreate({ ...state }); };
      foot.append(cancel, create);
      panel.append(foot);
      panel.querySelector('.picker-card.on')?.focus();
    };
    render();
  }

  function choice(label, opts, current, pick) {
    const row = document.createElement('div');
    row.className = 'picker-row';
    const l = document.createElement('div');
    l.className = 'strong small';
    l.textContent = label;
    const g = document.createElement('div');
    g.className = 'segmented';
    g.setAttribute('role', 'radiogroup');
    g.setAttribute('aria-label', label);
    for (const [value, text] of opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(current === value));
      b.className = current === value ? 'on' : '';
      b.textContent = text;
      b.onclick = () => pick(value);
      g.append(b);
    }
    row.append(l, g);
    return row;
  }

  window.FolioPicker = { open };
})();
