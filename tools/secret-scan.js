// Blocks credentials from being committed. Used by the pre-commit hook (--staged), by `npm test`
// (desktop/test/no-secrets.test.js, so CI catches it too) and by hand: node tools/secret-scan.js
// Reports file:line and the kind of key, never the key itself.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RULES = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Google OAuth client secret', /GOCSPX-[A-Za-z0-9_-]{20,}/],
  ['NVIDIA API key', /nvapi-[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

// Local credential files that must never be tracked (the *.example templates are fine).
const FORBIDDEN_FILE = file => {
  const base = path.basename(file);
  return /^(gcal-client|firebase-config)\.json$/.test(base) || (/^\.env(\..+)?$/.test(base) && !base.endsWith('.example'));
};

const SKIP = /(^|\/)(package-lock\.json|node_modules\/)|\.(png|jpe?g|webp|gif|ico|woff2?|pdf|zip|exe|dmg|asar)$/i;

function scanText(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [rule, re] of RULES) if (re.test(line)) hits.push({ rule, line: i + 1 });
  });
  return hits;
}

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// files: repo-relative paths. read(file) returns the text to scan (working tree or staged content).
function scanFiles(files, read) {
  const findings = [];
  for (const file of files) {
    if (FORBIDDEN_FILE(file)) findings.push({ file, rule: 'Credential file must not be committed', line: 0 });
    if (SKIP.test(file)) continue;
    let text;
    try { text = read(file); } catch { continue; }
    if (text.includes('\0')) continue; // binary
    for (const h of scanText(text)) findings.push({ file, ...h });
  }
  return findings;
}

function scanRepo(root, { staged = false } = {}) {
  if (staged) {
    const files = git(root, 'diff', '--cached', '--name-only', '--diff-filter=ACM').split('\n').filter(Boolean);
    return scanFiles(files, f => git(root, 'show', `:${f}`));
  }
  const files = git(root, 'ls-files').split('\n').filter(Boolean);
  return scanFiles(files, f => fs.readFileSync(path.join(root, f), 'utf8'));
}

module.exports = { RULES, scanText, scanFiles, scanRepo };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const findings = scanRepo(root, { staged: process.argv.includes('--staged') });
  if (!findings.length) { console.log('No credentials found.'); process.exit(0); }
  console.error('Possible credentials found (values hidden):');
  for (const f of findings) console.error(`  ${f.file}${f.line ? ':' + f.line : ''}  ${f.rule}`);
  console.error('\nKeep keys in git-ignored files (desktop/gcal-client.json, desktop/firebase-config.json, desktop/.env.local) and GitHub secrets.');
  process.exit(1);
}
