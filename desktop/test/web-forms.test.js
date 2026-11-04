const test = require('node:test');
const assert = require('node:assert');
const AdmZip = require('adm-zip');
const desktop = require('../form-import');
const phone = require('../../web-app/web-forms');

// The phone and web importer must read a file exactly as the desktop one does.
function xlsx(method) {
  const z = new AdmZip();
  z.addFile('xl/workbook.xml', Buffer.from('<workbook xmlns:r="r"><sheets><sheet name="Form Responses 1" sheetId="1" r:id="rId9"/></sheets></workbook>'));
  z.addFile('xl/_rels/workbook.xml.rels', Buffer.from('<Relationships><Relationship Id="rId9" Type="x" Target="worksheets/sheet1.xml"/></Relationships>'));
  z.addFile('xl/styles.xml', Buffer.from('<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\-mm\-dd\ hh:mm:ss"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>'));
  const strings = ['Timestamp', 'Task', 'Priority', 'Fix &amp; ship', 'High', 'Plan <b>', 'Low'];
  z.addFile('xl/sharedStrings.xml', Buffer.from(`<sst>${strings.map(s => `<si><t>${s}</t></si>`).join('')}</sst>`));
  z.addFile('xl/worksheets/sheet1.xml', Buffer.from('<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
    '<row r="2"><c r="A2" s="1"><v>46328.5</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c></row>' +
    '<row r="3"><c r="A3" s="1"><v>46329</v></c><c r="B3" t="inlineStr"><is><t>Inline one</t></is></c><c r="C3"/></row>' +
    '<row r="4"><c r="A4" s="1"><v>46330.25</v></c><c r="B4" t="s"><v>5</v></c><c r="C4" t="s"><v>6</v></c></row>' +
    '</sheetData></worksheet>'));
  if (method === 'stored') z.getEntries().forEach(e => { e.header.method = 0; });
  return z.toBuffer();
}

test('phone import: an .xlsx gives the same rows as the desktop importer (compressed and stored)', async () => {
  for (const method of ['deflate', 'stored']) {
    const buf = xlsx(method);
    const want = desktop.readFormFile(buf, 'Chores (Responses).xlsx');
    const got = await phone.readFormFile(new Uint8Array(buf), 'Chores (Responses).xlsx');
    assert.deepStrictEqual(got, want, method);
  }
});

test('phone import: CSV with a byte-order mark and quotes matches the desktop importer', async () => {
  const text = '﻿Timestamp,Task,Details\n11/02/2026 10:21:33,"Fix, then ship","He said ""hi"""\n';
  const want = desktop.readFormFile(Buffer.from(text), 'T (Responses).csv');
  assert.deepStrictEqual(await phone.readFormFile(new TextEncoder().encode(text), 'T (Responses).csv'), want);
});

test('phone import: old .xls and non-Excel files are refused with a plain message', async () => {
  await assert.rejects(phone.readFormFile(new Uint8Array([1]), 'old.xls'), /\.xlsx or \.csv/);
  await assert.rejects(phone.readFormFile(new TextEncoder().encode('not a zip at all, just text'), 'bad.xlsx'), /Excel file/);
});
