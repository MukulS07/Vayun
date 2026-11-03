// Copies the shared modules into functions/ so a deploy carries them (functions/ is deployed on its own).
// desktop/app/<name> is the one real copy of each. Run automatically before `firebase deploy` (see firebase.json) and
// by the tests. Usage: node tools/sync-ai.js
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const SHARED = ['ai-providers.js', 'forms-logic.js'];
const banner = name => `// COPY of desktop/app/${name}. Do not edit here: change the original and run \`node tools/sync-ai.js\`.\n`;

function sync() {
  fs.mkdirSync(path.join(root, 'functions'), { recursive: true });
  return SHARED.map(name => {
    const to = path.join(root, 'functions', name);
    // Always LF, so the copy never shows up as changed just because of Windows line endings.
    fs.writeFileSync(to, banner(name) + fs.readFileSync(path.join(root, 'desktop', 'app', name), 'utf8').split('\r\n').join('\n'));
    return to;
  });
}

if (require.main === module) for (const f of sync()) console.log('wrote', path.relative(root, f));
module.exports = { sync };
