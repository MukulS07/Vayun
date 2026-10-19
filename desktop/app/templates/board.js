// Widget board shared by Life OS and Study OS. A widget is a frame (title, edit, move, width, remove) around
// a render function. The layout is data; the template stores it per page and redraws on every change.
(function () {
  const { h } = FolioUI;
  const L = FolioTemplates;

  // registry: { [id]: { title, render: () => Element } }. layout: [{ id, wide }].
  // onAdd(): opens the add dialog. onEdit(id): opens the edit dialog. onLayout(layout): stores a new layout.
  function board({ layout, registry, onLayout, onAdd, onEdit }) {
    const frames = layout.map((entry, i) => {
      const w = registry[entry.id];
      if (!w) return null;
      const label = w.title;
      return h('section', { class: `bw${entry.wide ? ' wide' : ''}`, id: `w-${entry.id}`, 'aria-label': label },
        h('header', { class: 'bw-head' },
          h('h3', { class: 'bw-title' }, label),
          h('div', { class: 'bw-tools' },
            h('button', { type: 'button', class: 'bw-btn', 'aria-label': `Edit ${label}`, onclick: () => onEdit && onEdit(entry.id) }, '✎'),
            h('button', { type: 'button', class: 'bw-btn', 'aria-label': `Move ${label} up`, disabled: i === 0, onclick: () => onLayout(L.layoutMove(layout, entry.id, -1)) }, '↑'),
            h('button', { type: 'button', class: 'bw-btn', 'aria-label': `Move ${label} down`, disabled: i === layout.length - 1, onclick: () => onLayout(L.layoutMove(layout, entry.id, 1)) }, '↓'),
            h('button', { type: 'button', class: 'bw-btn', 'aria-label': `${entry.wide ? 'Make narrower' : 'Make wider'}: ${label}`, 'aria-pressed': entry.wide ? 'true' : 'false', onclick: () => onLayout(L.layoutToggleWide(layout, entry.id)) }, entry.wide ? '▭' : '▬'),
            h('button', { type: 'button', class: 'bw-btn bw-remove', 'aria-label': `Remove ${label}`, onclick: () => onLayout(L.layoutRemove(layout, entry.id)) }, '×'))),
        h('div', { class: 'bw-body' }, w.render()));
    }).filter(Boolean);

    const add = h('div', { class: 'bw-add' },
      h('button', { type: 'button', class: 'bw-add-main', onclick: () => onAdd && onAdd() }, '+ Add widget'),
      h('span', { class: 'tiny muted' }, 'Ready widgets or your own note, checklist, counter or list.'));

    return h('div', { class: 'bw-board' }, h('div', { class: 'bw-grid-wrap' }, frames), add);
  }

  window.FolioBoard = { board };
})();
