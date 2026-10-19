// Widget board shared by Life OS and Study OS. A widget is a frame around a render function. The layout is data;
// the template stores it per page and redraws on every change. Edit mode (per session) shows the tools and drag handles.
(function () {
  const { h } = FolioUI;
  const L = FolioTemplates;
  let editing = false;

  // Moves the item at `from` to index `to`.
  function reorder(layout, from, to) {
    const next = layout.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  }

  // registry: { [id]: { title, render: () => Element } }. layout: [{ id, wide }].
  // onAdd(): opens the add dialog. onEdit(id): opens the edit dialog. onLayout(layout): stores a new layout.
  // onRedraw(): redraws the page after the edit mode toggle.
  function board({ layout, registry, onLayout, onAdd, onEdit, onRedraw }) {
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
    const add = h('div', { class: 'bw-add' },
      h('button', { type: 'button', class: 'bw-add-main', onclick: () => onAdd && onAdd() }, '+ Add widget'),
      toggle,
      h('span', { class: 'tiny muted' }, editing ? 'Drag a widget by ⠿ to move it. ✎ renames, × removes.' : 'Add, rename or rearrange your widgets.'));

    return h('div', { class: 'bw-board' }, h('div', { class: 'bw-grid-wrap' }, frames), add);
  }

  window.FolioBoard = { board };
})();
