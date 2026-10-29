// Widget board shared by Life OS and Study OS. A widget is a frame around a render function. The layout is data;
// the template stores it per page and redraws on every change. Edit mode and the template gallery are per session.
(function () {
  const { h } = FolioUI;
  const L = FolioTemplates;
  let editing = false;
  let adding = false;

  // Moves the item at `from` to index `to`.
  function reorder(layout, from, to) {
    const next = layout.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  }

  // registry: { [id]: { title, render: () => Element } }. layout: [{ id, wide }].
  // options: [{ label, choice }] shown as one-click templates. onPick(choice): adds it.
  // onEdit(id): opens the edit dialog. onLayout(layout): stores a new layout. onRedraw(): redraws after a mode toggle.
  function board({ layout, registry, options, onPick, onLayout, onEdit, onRedraw }) {
    let dragId = null;
    const frames = layout.map((entry, i) => {
      const w = registry[entry.id];
      if (!w) return null;
      const label = w.title;
      const head = [h('h3', { class: 'bw-title' }, label)];
      if (editing) {
        head.push(h('div', { class: 'bw-tools' },
          h('span', { class: 'bw-handle', 'aria-hidden': 'true', title: `Drag to move ${label}` }, '⠿'),
          h('button', { type: 'button', class: 'bw-btn', 'aria-label': `Edit ${label}`, onclick: () => onEdit && onEdit(entry.id) }, '✎'),
          h('button', { type: 'button', class: 'bw-btn', 'aria-label': `Move ${label} up`, disabled: i === 0, onclick: () => onLayout(reorder(layout, i, i - 1)) }, '↑'),
          h('button', { type: 'button', class: 'bw-btn', 'aria-label': `Move ${label} down`, disabled: i === layout.length - 1, onclick: () => onLayout(reorder(layout, i, i + 1)) }, '↓'),
          h('button', { type: 'button', class: 'bw-btn', 'aria-label': `${entry.wide ? 'Make narrower' : 'Make wider'}: ${label}`, 'aria-pressed': entry.wide ? 'true' : 'false', onclick: () => onLayout(L.layoutToggleWide(layout, entry.id)) }, entry.wide ? '▭' : '▬'),
          h('button', { type: 'button', class: 'bw-btn bw-remove', 'aria-label': `Remove ${label}`, onclick: () => onLayout(L.layoutRemove(layout, entry.id)) }, '×')));
      }
      const drag = editing ? {
        draggable: 'true',
        ondragstart: e => { dragId = entry.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', entry.id); },
        ondragover: e => { if (dragId) e.preventDefault(); },
        ondrop: e => {
          e.preventDefault();
          const from = layout.findIndex(x => x.id === dragId);
          dragId = null;
          if (from >= 0 && from !== i) onLayout(reorder(layout, from, i));
        },
        ondragend: () => { dragId = null; },
      } : {};
      return h('section', { class: `bw${entry.wide ? ' wide' : ''}${editing ? ' editing' : ''}`, id: `w-${entry.id}`, 'aria-label': label, ...drag },
        h('header', { class: 'bw-head' }, ...head),
        h('div', { class: 'bw-body' }, w.render()));
    }).filter(Boolean);

    const toggle = h('button', { type: 'button', class: 'bw-mode', 'aria-pressed': editing ? 'true' : 'false',
      onclick: () => { editing = !editing; onRedraw && onRedraw(); } }, editing ? 'Done' : 'Edit widgets');
    const addBtn = h('button', { type: 'button', class: 'bw-add-main', 'aria-expanded': adding ? 'true' : 'false',
      onclick: () => { adding = !adding; onRedraw && onRedraw(); } }, adding ? 'Close' : '+ Add widget');
    const gallery = adding ? h('div', { class: 'bw-gallery', role: 'group', 'aria-label': 'Widget templates' },
      options.length
        ? options.map(o => h('button', { type: 'button', class: 'bw-tpl', onclick: () => { adding = false; onPick(o.choice); } }, o.label))
        : h('p', { class: 'tiny muted' }, 'Every ready widget is already on this page.')) : null;
    const add = h('div', { class: 'bw-add' }, addBtn, toggle,
      h('span', { class: 'tiny muted' }, adding ? 'Click a widget to add it. More are added the same way.'
        : editing ? 'Drag a widget by ⠿ to move it. ✎ renames, × removes.' : 'Add, rename or rearrange your widgets.'));

    return h('div', { class: 'bw-board' }, h('div', { class: 'bw-grid-wrap' }, frames), add, gallery);
  }

  window.FolioBoard = { board };
})();
