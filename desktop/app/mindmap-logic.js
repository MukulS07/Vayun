// Mind map of a page: the page is the centre, its own text (headings, bullets, to-dos) and its subpages are the
// branches. Pure functions, no DOM, so the app and the tests share them.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else root.FolioMindmap = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const HEADING = { h1: 1, h2: 2, h3: 3 };
  const LEAF = new Set(['text', 'bullet', 'numbered', 'todo', 'quote', 'callout']);
  const MAX_CONTENT = 150;
  const GAP_X = 64, GAP_Y = 12;
  const PALETTE = ['#8ea2ff', '#f2b35c', '#6fd3a0', '#e97b8f', '#b59cff', '#5fc4d6'];

  const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  // The page's own text as branches: a heading starts a branch, and the lines under it hang off that heading.
  // Lines before the first heading hang off the centre. Ids start with "b:" so they never clash with page ids.
  function outline(blocks) {
    const top = [];
    const stack = [];
    let count = 0, hidden = 0;
    for (const b of blocks || []) {
      const level = HEADING[b.type];
      if (!level && !LEAF.has(b.type)) continue;
      const title = clip(b.text, 90);
      if (!title) continue;
      if (count >= MAX_CONTENT) { hidden++; continue; }
      count++;
      const node = { id: 'b:' + b.id, kind: 'block', blockId: b.id, title, children: [], heading: !!level, done: b.type === 'todo' && b.checked === true };
      if (level) {
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        (stack.length ? stack[stack.length - 1].node.children : top).push(node);
        stack.push({ level, node });
      } else {
        (stack.length ? stack[stack.length - 1].node.children : top).push(node);
      }
    }
    if (hidden) top.push({ id: 'b:more', kind: 'more', title: `+ ${hidden} more lines`, children: [] });
    return top;
  }

  // pages: the workspace; rootId: the page in the centre. opts.content: include the page's text (default true).
  // Positions, folds and colours live on the page (mm, collapsed, mmColor) or, for text lines, in root.mmBlocks.
  function buildTree(pages, rootId, opts = {}) {
    const byId = new Map(pages.map(p => [p.id, p]));
    const rootPage = byId.get(rootId);
    if (!rootPage) return null;
    const seen = new Set();
    const blockState = rootPage.mmBlocks || {};
    const markFolds = nodes => nodes.forEach(n => { n.collapsed = !!(blockState[n.blockId] && blockState[n.blockId].collapsed); markFolds(n.children); });
    const page = (p, isRoot) => {
      if (seen.has(p.id)) return null;
      seen.add(p.id);
      const node = { id: p.id, kind: 'page', pageId: p.id, title: p.title || 'Untitled', root: isRoot, collapsed: !!p.collapsed, color: p.mmColor || '', children: [], subpages: 0 };
      const subs = pages.filter(c => c.parentId === p.id);
      node.subpages = subs.length;
      if (isRoot && opts.content !== false && p.kind !== 'database') {
        node.children.push(...outline(p.blocks));
        markFolds(node.children);
      }
      node.children.push(...subs.map(c => page(c, false)).filter(Boolean));
      return node;
    };
    return page(rootPage, true);
  }

  // Colour per branch: its own, else its top-level branch's, else a palette colour by position around the centre.
  function paintBranches(tree) {
    if (!tree) return tree;
    tree.children.forEach((child, i) => {
      const base = child.color || PALETTE[i % PALETTE.length];
      const walk = (n, inherited) => { n.color = n.color || inherited; n.children.forEach(c => walk(c, n.color)); };
      walk(child, base);
    });
    return tree;
  }

  // Size of a node from its text: wraps to up to three lines.
  function sizeOf(node) {
    if (node.root) return { w: 240, h: Math.max(48, 24 + Math.min(3, Math.ceil(node.title.length / 24)) * 20) };
    const w = node.kind === 'page' ? 200 : 220;
    const perLine = Math.floor((w - 36) / 7.4);
    const lines = Math.min(3, Math.max(1, Math.ceil(node.title.length / perLine)));
    return { w, h: Math.max(40, 18 + lines * 19) };
  }

  const open = n => (n.collapsed ? [] : n.children);

  // Balanced layout: the centre in the middle, its branches split between the right and the left side so both sides
  // are about as tall, each side a tidy tree. Returns Map(id -> { x, y, w, h }) (top-left corners) and the edges.
  function layout(tree, size = sizeOf) {
    const pos = new Map();
    const edges = [];
    if (!tree) return { pos, edges };
    const sizes = new Map();
    const dims = n => { if (!sizes.has(n.id)) sizes.set(n.id, size(n)); return sizes.get(n.id); };
    const heights = new Map();
    const span = n => {
      if (heights.has(n.id)) return heights.get(n.id);
      const kids = open(n);
      const inner = kids.reduce((s, k) => s + span(k), 0) + Math.max(0, kids.length - 1) * GAP_Y;
      const h = Math.max(dims(n).h, inner);
      heights.set(n.id, h);
      return h;
    };
    const place = (n, edge, cy, dir, parent) => {
      const { w, h } = dims(n);
      const x = dir > 0 ? edge : edge - w;
      pos.set(n.id, { x, y: cy - h / 2, w, h });
      if (parent) edges.push([parent.id, n.id]);
      const kids = open(n);
      if (!kids.length) return;
      const total = kids.reduce((s, k) => s + span(k), 0) + (kids.length - 1) * GAP_Y;
      let y = cy - total / 2;
      const next = dir > 0 ? x + w + GAP_X : x - GAP_X;
      for (const k of kids) { place(k, next, y + span(k) / 2, dir, n); y += span(k) + GAP_Y; }
    };
    const rd = dims(tree);
    pos.set(tree.id, { x: -rd.w / 2, y: -rd.h / 2, w: rd.w, h: rd.h });
    const kids = open(tree);
    const total = kids.reduce((s, k) => s + span(k), 0);
    let right = 0;
    const rightKids = [], leftKids = [];
    for (const k of kids) {
      if (right < total / 2 || !rightKids.length) { rightKids.push(k); right += span(k); } else leftKids.push(k);
    }
    for (const [group, dir] of [[rightKids, 1], [leftKids, -1]]) {
      if (!group.length) continue;
      const sum = group.reduce((s, k) => s + span(k), 0) + (group.length - 1) * GAP_Y;
      let y = -sum / 2;
      const edge = dir > 0 ? rd.w / 2 + GAP_X : -rd.w / 2 - GAP_X;
      for (const k of group) { place(k, edge, y + span(k) / 2, dir, tree); y += span(k) + GAP_Y; }
    }
    return { pos, edges };
  }

  // Which sides of two boxes a connector joins: the facing ones, judged from where their centres are.
  function anchors(a, b) {
    const ac = a.x + a.w / 2, bc = b.x + b.w / 2;
    const toRight = bc >= ac;
    return {
      x1: toRight ? a.x + a.w : a.x, y1: a.y + a.h / 2,
      x2: toRight ? b.x : b.x + b.w, y2: b.y + b.h / 2,
    };
  }

  function curve(a, b) {
    const { x1, y1, x2, y2 } = anchors(a, b);
    const mid = (x2 - x1) / 2;
    return `M${x1} ${y1} C${x1 + mid} ${y1} ${x2 - mid} ${y2} ${x2} ${y2}`;
  }

  // Counts for the empty-state hint and the toolbar.
  function countNodes(tree) {
    let n = 0;
    const walk = x => { n++; x.children.forEach(walk); };
    if (tree) walk(tree);
    return n;
  }

  return { outline, buildTree, paintBranches, sizeOf, layout, anchors, curve, countNodes, PALETTE, MAX_CONTENT };
});
