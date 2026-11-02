// Copies the shared AI provider module into functions/ so a deploy carries it (functions/ is deployed on its own).
// desktop/app/ai-providers.js is the one real copy. Run automatically before `firebase deploy` (see firebase.json) and
// by the tests. Usage: node tools/sync-ai.js
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const from = path.join(root, 'desktop', 'app', 'ai-providers.js');
const to = path.join(root, 'functions', 'ai-providers.js');
const banner = '// COPY of desktop/app/ai-providers.js. Do not edit here: change the original and run `node tools/sync-ai.js`.\n';

function sync() {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  // Always LF, so the copy never shows up as changed just because of Windows line endings.
  fs.writeFileSync(to, banner + fs.readFileSync(from, 'utf8').split('\r\n').join('\n'));
  return to;
}

if (require.main === module) console.log('wrote', path.relative(root, sync()));
module.exports = { sync };
