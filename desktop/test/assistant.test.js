const test = require('node:test');
const assert = require('node:assert');
const A = require('../app/assistant-logic');

test('assistant: parses JSON wrapped in fences and prose', () => {
  const r = A.parseReply('Sure!\n```json\n{"reply":"Done.","actions":[{"type":"rename_page","title":"Trip"}]}\n```');
  assert.strictEqual(r.reply, 'Done.');
  assert.deepStrictEqual(r.actions, [{ type: 'rename_page', title: 'Trip' }]);
  assert.deepStrictEqual(A.parseReply('Just words'), { reply: 'Just words', actions: [] });
  assert.strictEqual(A.parseReply('<think>maybe {x}</think>{"reply":"Hi","actions":[]}').reply, 'Hi');
});

test('assistant: actions are validated; unknown types and empty blocks dropped', () => {
  const acts = A.sanitizeActions([
    { type: 'delete_page', title: 'x' },
    { type: 'add_blocks', blocks: [{ type: 'todo', text: 'Buy milk', checked: 'yes' }, { type: 'weird', text: 'Plain' }, { type: 'text', text: '  ' }, { type: 'divider', text: 'ignored' }] },
    { type: 'create_template', template: 'study', theme: 'neon' },
    { type: 'rename_page', title: '' },
  ]);
  assert.deepStrictEqual(acts, [
    { type: 'add_blocks', blocks: [{ type: 'todo', text: 'Buy milk', checked: false }, { type: 'text', text: 'Plain' }, { type: 'divider', text: '' }] },
    { type: 'create_template', template: 'study', theme: null },
  ]);
});

test('assistant: prompt carries page context as data and the request last', () => {
  const msgs = A.buildMessages('Make a checklist', { page: { title: 'Home', blocks: [{ type: 'todo', text: 'Clean', checked: true }] }, pageTitles: ['Home', 'Work'] });
  assert.strictEqual(msgs[0].role, 'system');
  const last = msgs.at(-1).content;
  assert.ok(last.includes('Current page: "Home"') && last.includes('1. [todo x] Clean') && last.includes('"Work"'));
  assert.ok(last.trimEnd().endsWith('User request: Make a checklist'));
});
