// Shared primitives for the template pages: element builder, Chip, SegmentedControl, DeleteButton, InlineInput.
// Used by life.js and study.js. Styling lives in templates.css (no inline colours).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else root.FolioUI = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // h('button', { class: 'x', onclick: fn, 'aria-label': 'Delete' }, 'child', node)
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SVG_TAGS = new Set(['svg', 'defs', 'g', 'rect', 'path', 'circle', 'line', 'text', 'polygon', 'polyline', 'stop', 'linearGradient', 'radialGradient']);
  function h(tag, attrs, ...kids) {
    const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'ref' && typeof v === 'function') v(el);
      else if (k === 'style') el.style.cssText = v; // CSSOM, not a style attribute: the CSP allows it
      else if (k === 'class') { if (el.namespaceURI === SVG_NS) el.setAttribute('class', v); else el.className = v; }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  // Coloured pill. `tone` is a token name (green, amber, red, blue, purple, gray) from tokens.css.
  function chip(label, tone, { onclick, title } = {}) {
    const attrs = { class: `chip chip-${tone}${onclick ? ' chip-btn' : ''}`, title };
    if (onclick) {
      attrs.type = 'button';
      attrs.onclick = onclick;
      attrs['aria-label'] = title || label;
      return h('button', attrs, label);
    }
    return h('span', attrs, label);
  }

  // Radiogroup of options. `options` is [{ value, label }]; `onpick(value)` runs on click.
  function segmented(label, options, value, onpick) {
    return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label },
      options.map(o => h('button', {
        type: 'button', role: 'radio', 'aria-checked': o.value === value ? 'true' : 'false',
        class: o.value === value ? 'on' : '', onclick: () => onpick(o.value),
      }, o.label)));
  }

  function deleteButton(label, onclick) {
    return h('button', { type: 'button', class: 'del', 'aria-label': label, onclick }, '×');
  }

  // Borderless title/subtitle inputs that save on change.
  function inlineInput(id, label, value, onchange, cls) {
    return h('div', { class: 'inline-field' },
      h('label', { for: id, class: 'sr-only' }, label),
      h('input', { id, class: cls, value, onchange: e => onchange(e.target.value) }));
  }

  return { h, chip, segmented, deleteButton, inlineInput };
});
