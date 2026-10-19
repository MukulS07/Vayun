// Custom widgets and the Add / Edit dialogs. Used by the Life OS and Study OS boards.
// Built-in widgets can be renamed; custom widgets (note, checklist, counter, list) hold their own data.
(function () {
  const { h, deleteButton } = FolioUI;
  const L = FolioTemplates;
  const uid = () => Math.random().toString(36).slice(2, 9);

  // Renders the body of a custom widget. Edits save to the page; structural edits redraw the board.
  function renderCustom(S, id, ctx) {
    const inst = S().custom[id];
    if (!inst) return h('p', { class: 'tiny muted' }, 'This widget was removed.');
    const d = inst.data;
    if (inst.type === 'note') {
      return h('textarea', {
        class: 'tpl-notes', 'aria-label': `${inst.title} text`, placeholder: 'Write here…', rows: 6,
        ref: el => { el.value = d.text; },
        oninput: e => { d.text = e.target.value; ctx.change(); },
      });
    }
    if (inst.type === 'counter') {
      const step = h('input', { type: 'number', min: 1, max: 100, value: d.step, class: 'cw-step', 'aria-label': `${inst.title} step`,
        onchange: e => { d.step = Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1)); ctx.change(); } });
      return h('div', { class: 'cw-counter' },
        h('div', { class: 'cw-value', 'aria-live': 'polite' }, String(d.value)),
        h('div', { class: 'cw-counter-row' },
          h('button', { type: 'button', class: 'bw-btn', 'aria-label': `Decrease ${inst.title}`, onclick: () => { d.value -= d.step; ctx.change(); ctx.draw(); } }, '−'),
          h('button', { type: 'button', class: 'bw-btn', 'aria-label': `Increase ${inst.title}`, onclick: () => { d.value += d.step; ctx.change(); ctx.draw(); } }, '+'),
          h('label', { class: 'tiny muted' }, 'Step ', step),
          h('button', { type: 'button', class: 'btn-ghost small-btn', onclick: () => { d.value = 0; ctx.change(); ctx.draw(); } }, 'Reset')));
    }
    // checklist and list: a list of items with add and delete
    const input = h('input', { class: 'lf-input', placeholder: 'Add an item and press Enter…', 'aria-label': `New item in ${inst.title}`,
      onkeydown: e => { if (e.key === 'Enter') add(); } });
    const add = () => { const v = input.value.trim(); if (!v) return; d.items.push({ id: 'i' + uid(), text: v, done: false }); input.value = ''; ctx.change(); ctx.draw(); };
    return h('div', {},
      h('div', { class: 'lf-add-row' }, input, h('button', { type: 'button', class: 'btn-solid', onclick: add }, 'Add')),
      h('div', { class: 'st-list' }, d.items.map(it => h('div', { class: 'st-todo' },
        inst.type === 'checklist'
          ? h('button', { type: 'button', class: 'st-todo-toggle', 'aria-pressed': it.done ? 'true' : 'false', onclick: () => { it.done = !it.done; ctx.change(); ctx.draw(); } },
            h('span', { class: `st-box${it.done ? ' on' : ''}`, 'aria-hidden': 'true' }, it.done ? '✓' : ''),
            h('span', { class: it.done ? 'st-done-text' : '' }, it.text))
          : h('span', { class: 'flex-1 st-text2' }, `• ${it.text}`),
        deleteButton('Delete item', () => { d.items = d.items.filter(x => x !== it); ctx.change(); ctx.draw(); })))));
  }

  // Add dialog: built-in widgets not on the page, or a new custom widget with a title.
  function openAdd({ builtins, onPick }) {
    const backdrop = h('div', { class: 'settings-backdrop' });
    const panel = h('div', { class: 'settings dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add widget' });
    backdrop.append(panel);
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) backdrop.remove(); });
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') backdrop.remove(); });
    const close = () => backdrop.remove();

    let type = 'note';
    const titleInput = h('input', { class: 'dlg-input', placeholder: 'Widget title', 'aria-label': 'Widget title', maxlength: 60 });
    const typeRadios = L.CUSTOM_TYPES.map(t => h('button', {
      type: 'button', role: 'radio', class: 'dlg-type', 'aria-checked': t === type ? 'true' : 'false',
      onclick: e => { type = t; typeRadios.forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget))); },
    }, L.CUSTOM_TYPE_TITLES[t]));

    panel.append(
      h('div', { class: 'settings-head' },
        h('div', {}, h('h2', {}, 'Add widget'), h('p', { class: 'muted' }, 'Pick one that is ready to use, or make your own.')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '×')),
      h('h3', { class: 'dlg-h' }, 'Ready widgets'),
      h('div', { class: 'dlg-grid' }, builtins.length
        ? builtins.map(b => h('button', { type: 'button', class: 'dlg-card', onclick: () => { onPick({ kind: 'builtin', id: b.id }); close(); } }, b.title))
        : h('p', { class: 'tiny muted' }, 'All ready widgets are already on this page.')),
      h('h3', { class: 'dlg-h' }, 'Make your own'),
      h('div', { class: 'dlg-row', role: 'radiogroup', 'aria-label': 'Widget type' }, typeRadios),
      h('label', { class: 'dlg-label' }, 'Title', titleInput),
      h('div', { class: 'settings-foot' },
        h('button', { type: 'button', onclick: close }, 'Cancel'),
        h('button', { type: 'button', class: 'primary', onclick: () => {
          onPick({ kind: 'custom', type, title: titleInput.value.trim() || L.CUSTOM_TYPE_TITLES[type] });
          close();
        } }, 'Add widget')));
    document.body.append(backdrop);
    titleInput.focus();
  }

  // Edit dialog: rename any widget. Custom widgets can also be deleted.
  function openEdit({ id, title, custom, onRename, onDelete, onResetName }) {
    const backdrop = h('div', { class: 'settings-backdrop' });
    const panel = h('div', { class: 'settings dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Edit widget' });
    backdrop.append(panel);
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) backdrop.remove(); });
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') backdrop.remove(); });
    const close = () => backdrop.remove();
    const titleInput = h('input', { class: 'dlg-input', value: title, 'aria-label': 'Widget title', maxlength: 60 });
    panel.append(
      h('div', { class: 'settings-head' },
        h('div', {}, h('h2', {}, 'Edit widget'), h('p', { class: 'muted' }, custom ? 'Custom widget' : 'Ready widget')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '×')),
      h('label', { class: 'dlg-label' }, 'Title', titleInput),
      h('div', { class: 'settings-foot dlg-foot' },
        custom
          ? h('button', { type: 'button', class: 'dlg-danger', onclick: () => {
            if (confirm(`Delete "${title}" and its contents? This cannot be undone.`)) { onDelete(); close(); }
          } }, 'Delete widget')
          : (onResetName ? h('button', { type: 'button', onclick: () => { onResetName(); close(); } }, 'Reset name') : h('span')),
        h('span', { class: 'dlg-buttons' },
          h('button', { type: 'button', onclick: close }, 'Cancel'),
          h('button', { type: 'button', class: 'primary', onclick: () => {
            const t = titleInput.value.trim();
            if (t) onRename(t);
            close();
          } }, 'Save'))));
    document.body.append(backdrop);
    titleInput.focus();
    titleInput.select();
    void id;
  }

  // Ties the board to the page state: registry (built-in plus custom), Add and Edit actions.
  // builtins: { [id]: { title, render } }. ctx: { change, draw, setLayout }.
  function controller(S, builtins, ctx) {
    const registry = {};
    for (const [id, b] of Object.entries(builtins)) {
      registry[id] = { title: S().titles[id] || b.title, render: b.render, custom: false };
    }
    for (const id of Object.keys(S().custom)) {
      registry[id] = { title: S().custom[id].title, render: () => renderCustom(S, id, ctx), custom: true };
    }
    return {
      registry,
      onAdd() {
        const layout = S().layout;
        const available = Object.keys(builtins).filter(id => !layout.some(w => w.id === id)).map(id => ({ id, title: registry[id].title }));
        openAdd({
          builtins: available,
          onPick(choice) {
            if (choice.kind === 'builtin') {
              ctx.setLayout(L.layoutAdd(S().layout, choice.id, false));
              return;
            }
            const id = 'x' + uid();
            S().custom[id] = L.newCustomWidget(choice.type, choice.title);
            ctx.setLayout(L.layoutAdd(S().layout, id, false));
          },
        });
      },
      onEdit(id) {
        const w = registry[id];
        if (!w) return;
        const custom = Boolean(S().custom[id]);
        openEdit({
          id, title: w.title, custom,
          onRename(title) {
            if (custom) S().custom[id].title = title;
            else S().titles[id] = title;
            ctx.change();
            ctx.draw();
          },
          onDelete() {
            delete S().custom[id];
            ctx.setLayout(L.layoutRemove(S().layout, id));
          },
          onResetName() {
            delete S().titles[id];
            ctx.change();
            ctx.draw();
          },
        });
      },
    };
  }

  window.FolioCustom = { controller, renderCustom, openAdd, openEdit };
})();
