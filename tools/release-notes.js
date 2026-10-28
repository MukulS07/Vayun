// Builds a GitHub Release's title and description from CHANGELOG.md, so every release is labelled and explained the
// same way. Used by the release job in .github/workflows/build.yml and by the test.
//   node tools/release-notes.js v1.0.7 --title    -> "Vayun v1.0.7 — Home, roles and reminders"
//   node tools/release-notes.js v1.0.7            -> the description (Markdown)
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'https://github.com/MukulS07/Vayun';

// The section of CHANGELOG.md for one version: { date, tagline, bullets }, or null when there is none.
function section(changelog, tag) {
  const version = String(tag).replace(/^v/, '');
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(l => l.startsWith(`## v${version} `) || l === `## v${version}`);
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end);
  const tagline = (body.find(l => l.startsWith('> ')) || '').replace(/^>\s*/, '').trim();
  const bullets = body.filter(l => !l.startsWith('> ')).join('\n').trim();
  return { date: (lines[start].match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '', tagline, bullets };
}

function title(changelog, tag) {
  const s = section(changelog, tag);
  return `Vayun ${tag}${s && s.tagline ? ' — ' + s.tagline : ''}`;
}

function notes(changelog, tag) {
  const s = section(changelog, tag);
  if (!s) throw new Error(`CHANGELOG.md has no section for ${tag}. Add one before tagging.`);
  const v = tag.replace(/^v/, '');
  const table = [
    '| Your computer | Download |',
    '| :--- | :--- |',
    `| Windows | \`Vayun-Setup-${v}.exe\` |`,
    `| Mac with Apple Silicon (M1 to M4) | \`Vayun-${v}-arm64.dmg\` |`,
    `| Mac with an Intel chip, or if unsure | \`Vayun-${v}-universal.dmg\` |`,
  ].join('\n');
  return [
    s.tagline ? `### ${s.tagline}` : '',
    s.date ? `Released ${s.date}.` : '',
    '## What is new', s.bullets,
    '## Which file do I download?', table,
    `Every release and what it changed: [CHANGELOG.md](${REPO}/blob/master/CHANGELOG.md).`,
  ].filter(Boolean).join('\n\n') + '\n';
}

module.exports = { section, title, notes };

if (require.main === module) {
  const tag = process.argv[2];
  if (!tag) { console.error('usage: node tools/release-notes.js vX.Y.Z [--title]'); process.exit(2); }
  const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  process.stdout.write(process.argv.includes('--title') ? title(changelog, tag) + '\n' : notes(changelog, tag));
}
