const test = require('node:test');
const assert = require('node:assert');
const AdmZip = require('adm-zip');
const { readFormFile, serialToText } = require('../form-import');
const F = require('../app/form-logic');

let n = 0;
const uid = () => 'u' + ++n;

const csv = [
  'Timestamp,Email Address,Task,Priority,Due date,Assigned to,Details',
  '11/02/2026 10:21:33,a@x.com,Fix the login page,High,11/05/2026,Asha,"The button does nothing on phones, see the screenshot I sent last week to the team channel."',
  '11/02/2026 11:00:00,b@x.com,Order stickers,Low,11/20/2026,Ravi,',
  '11/03/2026 09:10:00,c@x.com,Update the pricing page,High,11/07/2026,Asha,',
].join('\n');
const rowsOf = text => readFormFile(Buffer.from(text), 'Tasks (Responses).csv');

test('form import: a form with task questions becomes a board of tasks, named after the file', () => {
  const file = rowsOf(csv);
  assert.strictEqual(file.name, 'Tasks');
  const r = F.importForm(file.rows, [], { name: file.name, uid });
  assert.deepStrictEqual([r.created, r.added, r.db.kind], [true, 3, 'database']);
  const byName = Object.fromEntries(r.db.schema.map(p => [p.name, p]));
  assert.strictEqual(byName.Timestamp.type, 'date');
  assert.strictEqual(byName['Due date'].type, 'date');
  assert.strictEqual(byName.Priority.type, 'select');
  assert.deepStrictEqual(byName.Priority.options, ['High', 'Low']);
  assert.strictEqual(byName.Task, undefined); // the task question is the row title
  const first = r.pages.find(p => p.title === 'Fix the login page');
  assert.strictEqual(first.props[byName['Due date'].id], '2026-11-05');
  assert.strictEqual(first.props[byName.Timestamp.id], '2026-11-02');
  assert.strictEqual(first.props[byName['Assigned to'].id], 'Asha');
  // no status question: one is added and everything starts as To do, shown as a board by it
  assert.deepStrictEqual(byName.Status.options, ['To do', 'Doing', 'Done']);
  assert.deepStrictEqual([r.db.view.type, r.db.view.group], ['board', byName.Status.id]);
  assert.strictEqual(first.props[byName.Status.id], 'To do');
  // a long answer is also written into the response's page
  assert.ok(first.blocks.some(b => b.text.startsWith('Details: The button does nothing')));
});

test('form import: a status question in the form is used instead of adding one', () => {
  const rows = rowsOf('Timestamp,What is the task?,Status\n2026-11-02 10:00:00,Wash the car,Doing\n2026-11-02 11:00:00,Pay the bill,Done\n2026-11-02 12:00:00,Call mum,Doing').rows;
  const r = F.importForm(rows, [], { name: 'Chores', uid });
  assert.deepStrictEqual(r.db.schema.map(p => p.name), ['Timestamp', 'Status']);
  assert.deepStrictEqual(r.db.schema[1].options, ['Doing', 'Done']);
  assert.strictEqual(r.pages.find(p => p.title === 'Pay the bill').props[r.db.view.group], 'Done');
});

test('form import: importing again adds only new responses and keeps edits', () => {
  const first = F.importForm(rowsOf(csv).rows, [], { name: 'Tasks', uid });
  const pages = [...first.pages];
  const edited = pages.find(p => p.title === 'Order stickers');
  edited.props[first.db.view.group] = 'Done';
  const more = csv + '\n11/04/2026 08:00:00,d@x.com,Book the venue,Urgent,11/09/2026,Meera,';
  const again = F.importForm(rowsOf(more).rows, pages, { name: 'Tasks', uid });
  assert.deepStrictEqual([again.created, again.added, again.skipped, again.db.id], [false, 1, 3, first.db.id]);
  assert.ok(first.db.schema.find(p => p.name === 'Priority').options.includes('Urgent'));
  assert.strictEqual(edited.props[first.db.view.group], 'Done');
  pages.push(...again.pages);
  const third = F.importForm(rowsOf(more).rows, pages, { name: 'Tasks', uid });
  assert.deepStrictEqual([third.added, third.skipped], [0, 4]);
});

test('form import: day-first dates are read correctly, blanks and odd files are handled', () => {
  assert.strictEqual(F.dateOrder(['25/12/2026', '01/02/2026']), 'dmy');
  assert.strictEqual(F.dateOrder(['12/25/2026']), 'mdy');
  assert.strictEqual(F.dateOrder(['soon']), null);
  assert.strictEqual(F.toIso('25/12/2026', 'dmy'), '2026-12-25');
  const r = F.importForm([['Question', 'Answer'], ['', ''], ['', 'x']], [], { name: 'Blank', uid });
  assert.strictEqual(r.added, 1); // the all-empty row is dropped
  assert.strictEqual(r.pages[1].title, 'x'); // the first question with answers is the title
  assert.throws(() => F.importForm([['Only headers']], [], { name: 'x', uid }), /no responses/);
  assert.throws(() => readFormFile(Buffer.from('x'), 'old.xls'), /\.xlsx or \.csv/);
});

// Builds a small .xlsx the way Excel and Google Sheets write one: shared strings, a date column with a date style.
function xlsx() {
  const z = new AdmZip();
  z.addFile('xl/workbook.xml', Buffer.from('<workbook xmlns:r="r"><sheets><sheet name="Form Responses 1" sheetId="1" r:id="rId9"/></sheets></workbook>'));
  z.addFile('xl/_rels/workbook.xml.rels', Buffer.from('<Relationships><Relationship Id="rId9" Type="x" Target="worksheets/sheet1.xml"/></Relationships>'));
  z.addFile('xl/styles.xml', Buffer.from('<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>'));
  const strings = ['Timestamp', 'Task', 'Priority', 'Fix &amp; ship', 'High', 'Plan <b>', 'Low'];
  z.addFile('xl/sharedStrings.xml', Buffer.from(`<sst>${strings.map(s => `<si><t>${s}</t></si>`).join('')}</sst>`));
  z.addFile('xl/worksheets/sheet1.xml', Buffer.from('<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
    '<row r="2"><c r="A2" s="1"><v>46328.5</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c></row>' +
    '<row r="3"><c r="A3" s="1"><v>46329</v></c><c r="B3" t="inlineStr"><is><t>Inline one</t></is></c><c r="C3"/></row>' +
    '<row r="4"><c r="A4" s="1"><v>46330.25</v></c><c r="B4" t="s"><v>5</v></c><c r="C4" t="s"><v>6</v></c></row>' +
    '</sheetData></worksheet>'));
  return z.toBuffer();
}

test('form import: an .xlsx export is read, with dates, shared strings and escaped text', () => {
  assert.strictEqual(serialToText(46328.5), '2026-11-02 12:00:00');
  const file = readFormFile(xlsx(), 'Chores (Responses).xlsx');
  assert.strictEqual(file.name, 'Chores');
  assert.deepStrictEqual(file.rows[0], ['Timestamp', 'Task', 'Priority']);
  assert.deepStrictEqual(file.rows[1], ['2026-11-02 12:00:00', 'Fix & ship', 'High']);
  assert.deepStrictEqual(file.rows[2], ['2026-11-03', 'Inline one', '']);
  assert.strictEqual(file.rows[3][1], 'Plan <b>');
  const r = F.importForm(file.rows, [], { name: file.name, uid });
  assert.deepStrictEqual([r.added, r.pages[1].title], [3, 'Fix & ship']);
  assert.throws(() => readFormFile(Buffer.from('not a zip'), 'bad.xlsx'));
});
