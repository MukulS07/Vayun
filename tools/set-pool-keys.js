// Checks your list of shared API keys and publishes it to the Assistant server as the secret POOL_KEYS.
//   1. Copy functions/pool-keys.example.json to functions/pool-keys.local.json (git ignores it) and put your keys in.
//   2. node tools/set-pool-keys.js            checks the list, then publishes it
//      node tools/set-pool-keys.js --dry-run  only checks it
// Keys are tried in the order listed. Each entry is just the key, or { "key": "...", "provider": "..." }; the
// service is worked out from the key itself. Keys are never printed (only the service and the last 4 characters).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const P = require('../desktop/app/ai-providers');

const MAX_KEYS = 20;

// raw: parsed JSON. Returns { entries: [{ provider, key }], problems: [text], notes: [text] }.
function validatePool(raw) {
  const problems = [], notes = [], entries = [], seen = new Set();
  if (!Array.isArray(raw)) return { entries, problems: ['The file must contain a list, like [ { "key": "..." } ].'], notes };
  if (raw.length > MAX_KEYS) problems.push(`That is ${raw.length} keys; the most is ${MAX_KEYS}.`);
  raw.forEach((item, i) => {
    const n = i + 1;
    const key = P.cleanKey(typeof item === 'string' ? item : item && item.key);
    if (!key || /^(PASTE|YOUR|<)/i.test(key)) { notes.push(`#${n}: empty or still a placeholder, skipped.`); return; }
    const found = P.detectProvider(key);
    if (!found) { problems.push(`#${n}: I could not tell which service that key (ending ${P.last4(key)}) is for. Check that it is complete.`); return; }
    const said = item && typeof item === 'object' && item.provider ? String(item.provider).toLowerCase() : '';
    if (said && said !== found.id) { problems.push(`#${n}: you wrote "${said}" but the key looks like ${found.name} (${found.id}).`); return; }
    if (seen.has(key)) { notes.push(`#${n}: ${found.name} ····${P.last4(key)} is listed twice; the second is skipped.`); return; }
    seen.add(key);
    entries.push({ provider: found.id, key });
  });
  if (!entries.length && !problems.length) problems.push('No keys found in the list.');
  return { entries, problems, notes };
}

const mask = e => `${P.PROVIDERS[e.provider].name} ····${P.last4(e.key)}`;

function main(argv) {
  const dry = argv.includes('--dry-run');
  const file = path.resolve(argv.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'functions', 'pool-keys.local.json'));
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`Could not read ${file}: ${e.code === 'ENOENT' ? 'the file does not exist (copy functions/pool-keys.example.json to functions/pool-keys.local.json first).' : e.message}`); return 1; }

  const { entries, problems, notes } = validatePool(raw);
  notes.forEach(n => console.log('note: ' + n));
  if (problems.length) { problems.forEach(p => console.error('problem: ' + p)); return 1; }
  console.log(`${entries.length} key${entries.length === 1 ? '' : 's'}, tried in this order:`);
  entries.forEach((e, i) => console.log(`  ${i + 1}. ${mask(e)}`));
  if (dry) { console.log('Looks good. (dry run: nothing was published)'); return 0; }

  const tmp = path.join(os.tmpdir(), `vayun-pool-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(entries), { mode: 0o600 });
  try {
    const run = spawnSync('npx', ['--yes', 'firebase-tools', 'functions:secrets:set', 'POOL_KEYS', '--data-file', tmp, '--force'], { stdio: 'inherit', shell: process.platform === 'win32', cwd: path.join(__dirname, '..') });
    if (run.status !== 0) { console.error('Publishing failed. Are you signed in (firebase login) and on the right project?'); return 1; }
  } finally { try { fs.rmSync(tmp, { force: true }); } catch { /* temp file already gone */ } }
  console.log('Published. Deploy to apply it: firebase deploy --only functions');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { validatePool, MAX_KEYS };
