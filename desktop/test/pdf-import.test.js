const test = require('node:test');
const assert = require('node:assert');
const { linesToBlocks } = require('../pdf-import');

// Page text area runs from x=72 to x=540. `end` < 540 means the line stopped short.
const line = (y, size, text, { x = 72, end = 540, page = 1 } = {}) => ({ page, y, size, text, x, end });
const shape = blocks => blocks.map(b => `${b.type}:${b.text}${b.type === 'todo' ? `:${b.checked}` : ''}`);

test('guesses headings, wraps paragraphs and lists from layout', () => {
  const blocks = linesToBlocks([
    line(800, 24, 'Project Plan', { end: 250 }),
    line(760, 16, 'Goals', { end: 120 }),
    line(740, 11, 'We want to ship the first ver-'),
    line(727, 11, 'sion this quarter.', { end: 180 }),
    line(714, 11, 'A new paragraph right after a short line.', { end: 330 }),
    line(690, 11, '• Write the spec for the importer and review it'),
    line(677, 11, 'with the design team', { x: 90, end: 220 }),
    line(664, 11, '☑ Book the room', { end: 160 }),
    line(651, 11, '☐ Send invites', { end: 160 }),
    line(800, 11, 'Next page text.', { page: 2, end: 200 }),
  ]);
  assert.deepStrictEqual(shape(blocks), [
    'h1:Project Plan',
    'h2:Goals',
    'text:We want to ship the first version this quarter.',
    'text:A new paragraph right after a short line.',
    'bullet:Write the spec for the importer and review it with the design team',
    'todo:Book the room:true',
    'todo:Send invites:false',
    'text:Next page text.',
  ]);
});

test('indented lines without a bullet glyph become list items', () => {
  const blocks = linesToBlocks([
    line(700, 11, 'Body text that sets the left margin.', { end: 400 }),
    line(687, 11, 'First item', { x: 100, end: 160 }),
    line(674, 11, 'Second item', { x: 100, end: 170 }),
  ]);
  assert.deepStrictEqual(shape(blocks), ['text:Body text that sets the left margin.', 'bullet:First item', 'bullet:Second item']);
});

test('empty input gives no blocks', () => {
  assert.deepStrictEqual(linesToBlocks([]), []);
});
