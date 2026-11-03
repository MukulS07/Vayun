const test = require('node:test');
const assert = require('node:assert');
const M = require('../app/mindmap-logic');

const blocks = [
  { id: '1', type: 'text', text: 'Intro line' },
  { id: '2', type: 'h1', text: 'Plan' },
  { id: '3', type: 'bullet', text: 'One' },
  { id: '4', type: 'h2', text: 'Detail' },
  { id: '5', type: 'todo', text: 'Two', checked: true },
  { id: '6', type: 'h1', text: 'Risks' },
  { id: '7', type: 'bullet', text: 'Late' },
  { id: '8', type: 'text', text: '   ' },
  { id: '9', type: 'divider', text: '' },
];
const titles = n => n.children.map(c => c.title);

test('mind map: headings become branches, lines hang off the heading above them, blanks are skipped', () => {
  const o = M.outline(blocks);
  assert.deepStrictEqual(o.map(n => n.title), ['Intro line', 'Plan', 'Risks']);
  const plan = o[1];
  assert.deepStrictEqual(titles(plan), ['One', 'Detail']);
  assert.deepStrictEqual(titles(plan.children[1]), ['Two']);
  assert.strictEqual(plan.children[1].children[0].done, true);
  assert.strictEqual(plan.id, 'b:2');
});

test('mind map: the tree joins the page text and its subpages; text can be switched off; cycles are cut', () => {
  const pages = [
    { id: 'r', title: 'Launch', parentId: null, blocks },
    { id: 's', title: 'Sub', parentId: 'r', blocks: [{ id: 'x', type: 'h1', text: 'Not shown' }] },
  ];
  const t = M.buildTree(pages, 'r');
  assert.deepStrictEqual(titles(t), ['Intro line', 'Plan', 'Risks', 'Sub']);
  assert.strictEqual(t.root, true);
  assert.deepStrictEqual(titles(M.buildTree(pages, 'r', { content: false })), ['Sub']);
  const loop = [{ id: 'a', title: 'A', parentId: 'b', blocks: [] }, { id: 'b', title: 'B', parentId: 'a', blocks: [] }];
  assert.doesNotThrow(() => M.buildTree(loop, 'a'));
  assert.strictEqual(M.buildTree(pages, 'missing'), null);
});

test('mind map: folded nodes hide their branches, and a very long page is capped', () => {
  const pages = [{ id: 'r', title: 'R', parentId: null, blocks, mmBlocks: { 2: { collapsed: true } } }];
  const t = M.buildTree(pages, 'r');
  assert.strictEqual(t.children[1].collapsed, true);
  const { pos } = M.layout(t);
  assert.ok(!pos.has('b:3')); // hidden under the folded "Plan"
  const many = Array.from({ length: 400 }, (_, i) => ({ id: 'l' + i, type: 'bullet', text: 'line ' + i }));
  const o = M.outline(many);
  assert.strictEqual(o.length, M.MAX_CONTENT + 1);
  assert.strictEqual(o.at(-1).kind, 'more');
});

test('mind map: the layout is balanced around the centre and nothing overlaps', () => {
  const pages = [{ id: 'r', title: 'Centre', parentId: null, blocks }];
  const t = M.paintBranches(M.buildTree(pages, 'r'));
  const { pos, edges } = M.layout(t);
  assert.strictEqual(edges.length, M.countNodes(t) - 1);
  const root = pos.get('r');
  assert.ok(Math.abs(root.x + root.w / 2) < 1 && Math.abs(root.y + root.h / 2) < 1); // centred on 0,0
  const sides = t.children.map(c => (pos.get(c.id).x > 0 ? 'right' : 'left'));
  assert.ok(sides.includes('right') && sides.includes('left'));
  const boxes = [...pos.values()];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    assert.ok(apart, `boxes ${i} and ${j} overlap`);
  }
});

test('mind map: branches get their own colours and pass them down; text wraps into a taller node', () => {
  const pages = [{ id: 'r', title: 'R', parentId: null, blocks }, { id: 's', title: 'S', parentId: 'r', blocks: [], mmColor: '#123456' }];
  const t = M.paintBranches(M.buildTree(pages, 'r'));
  const plan = t.children.find(c => c.title === 'Plan');
  assert.strictEqual(plan.color, M.PALETTE[1]);
  assert.strictEqual(plan.children[1].children[0].color, plan.color);
  assert.strictEqual(t.children.find(c => c.id === 's').color, '#123456');
  const short = M.sizeOf({ title: 'Hi', kind: 'block' }), long = M.sizeOf({ title: 'word '.repeat(30), kind: 'block' });
  assert.ok(long.h > short.h && long.h <= 18 + 3 * 19);
});

test('mind map: connectors join the facing sides of two nodes', () => {
  const a = { x: 0, y: 0, w: 100, h: 40 }, right = { x: 200, y: 50, w: 100, h: 40 }, left = { x: -200, y: 50, w: 100, h: 40 };
  assert.deepStrictEqual(M.anchors(a, right), { x1: 100, y1: 20, x2: 200, y2: 70 });
  assert.deepStrictEqual(M.anchors(a, left), { x1: 0, y1: 20, x2: -100, y2: 70 });
  assert.match(M.curve(a, right), /^M100 20 C/);
});
