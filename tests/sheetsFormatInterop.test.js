import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { validateContent, openStore } from '../server/store.js';
import { exportXlsx, importXlsx } from '../src/lib/sheetsFiles.js';
import { computeCell, evaluateFormula, shiftFormulaReferences } from '../src/lib/formulas.js';
import { formatCellValue } from '../src/lib/cellValues.js';

const workbook = (cells) => ({ sheets: [{ id: 'main', name: 'Main', cells }], activeSheetId: 'main' });
const xml = (source) => new DOMParser().parseFromString(source, 'application/xml');
const tags = (node, name) => [...node.getElementsByTagName('*')].filter((element) => element.localName === name);
const fixture = () => workbook({
  A1: { value: '1234.5678', format: { numberFormat: 'number', decimalPlaces: 4, fontFamily: 'Georgia', fontSize: 18 } },
  A2: { value: '0.125', format: { numberFormat: 'percent', decimalPlaces: 0 } },
  A3: { value: '45.678', format: { numberFormat: 'currency', decimalPlaces: 3 } },
  A4: { value: '45351', format: { numberFormat: 'date', dateFormat: 'iso' } },
  A5: { value: '45351', format: { numberFormat: 'date', dateFormat: 'short' } },
  A6: { value: '45351', format: { numberFormat: 'date', dateFormat: 'long' } },
  A7: { value: '0.5625', format: { numberFormat: 'time', decimalPlaces: 3 } },
  A8: { value: '45351.5625', format: { numberFormat: 'datetime', dateFormat: 'long', decimalPlaces: 2 } },
  A9: { value: '12345', format: { numberFormat: 'scientific', decimalPlaces: 5 } },
  A10: { value: '00123', format: { numberFormat: 'text', fontFamily: 'Courier New' } },
  A11: { value: '=SUM(A1,A3)', format: { numberFormat: 'number', decimalPlaces: 0 } },
});

test('[C3-50] sheet format schema accepts all supported number modes fonts precision and date choices', () => {
  const content = fixture();
  for (const numberFormat of ['auto', 'text', 'number', 'currency', 'percent', 'date', 'time', 'datetime', 'scientific']) {
    content.sheets[0].cells.B1 = { value: '1', format: { numberFormat, fontFamily: 'Times New Roman', decimalPlaces: 10, dateFormat: 'iso' } };
    assert.doesNotThrow(() => validateContent('sheets', content), numberFormat);
  }
  content.sheets[0].cells.B1.format.decimalPlaces = 0;
  assert.doesNotThrow(() => validateContent('sheets', content));
});

test('[C3-51] invalid precision font and date display metadata reject before persistence', () => {
  for (const format of [{ decimalPlaces: -1 }, { decimalPlaces: 11 }, { decimalPlaces: 1.5 }, { decimalPlaces: '2' }, { decimalPlaces: Infinity }, { dateFormat: 'random' }, { dateFormat: null }, { fontFamily: {} }, { fontFamily: 'x'.repeat(201) }, { fontFamily: 'Bad\nFont' }, { numberFormat: 'unsupported' }]) {
    assert.throws(() => validateContent('sheets', workbook({ A1: { value: '1', format } })), JSON.stringify(format));
  }
});

test('[C3-52] saved advanced cell formats survive an isolated SQLite close and reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'commonplace-cell-format-')), filename = join(directory, 'qa.sqlite');
  let store;
  try {
    store = openStore(filename, { seed: false });
    const original = fixture(), file = store.create({ kind: 'sheets', title: 'Synthetic format persistence', content: original });
    store.db.close();
    store = openStore(filename, { seed: false });
    assert.deepEqual(store.file(file.id).content, original);
    const rejected = structuredClone(original); rejected.sheets[0].cells.A1.format.decimalPlaces = 20;
    assert.throws(() => store.update(file.id, { version: file.version, content: rejected }));
    assert.deepEqual(store.file(file.id).content, original);
  } finally { store?.db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('[C3-53] XLSX contains native precise number codes and named fonts rather than metadata-only styling', () => {
  const files = unzipSync(exportXlsx(fixture())), styles = xml(strFromU8(files['xl/styles.xml'])), sheet = xml(strFromU8(files['xl/worksheets/sheet1.xml']));
  const codes = new Map(tags(styles, 'numFmt').map((entry) => [entry.getAttribute('numFmtId'), entry.getAttribute('formatCode')]));
  const xfs = tags(tags(styles, 'cellXfs')[0], 'xf');
  const nativeCode = (reference) => { const cell = tags(sheet, 'c').find((entry) => entry.getAttribute('r') === reference), id = xfs[Number(cell.getAttribute('s'))].getAttribute('numFmtId'); return id === '49' ? '@' : codes.get(id); };
  assert.equal(nativeCode('A1'), '#,##0.0000');
  assert.equal(nativeCode('A2'), '0%');
  assert.equal(nativeCode('A3'), '"$"#,##0.000');
  assert.equal(nativeCode('A4'), 'yyyy-mm-dd');
  assert.equal(nativeCode('A5'), 'm/d/yyyy');
  assert.equal(nativeCode('A6'), 'mmmm d, yyyy');
  assert.equal(nativeCode('A7'), 'hh:mm:ss.000');
  assert.equal(nativeCode('A8'), 'mmmm d, yyyy hh:mm:ss.00');
  assert.equal(nativeCode('A9'), '0.00000E+00');
  assert.equal(nativeCode('A10'), '@');
  assert.ok(tags(styles, 'name').some((entry) => entry.getAttribute('val') === 'Georgia'));
  assert.ok(tags(styles, 'name').some((entry) => entry.getAttribute('val') === 'Courier New'));
  assert.equal(tags(sheet, 'f')[0].textContent, 'SUM(A1,A3)');
});

test('[C3-54] native XLSX font precision and date/time formats reimport without Commonplace metadata', () => {
  const source = fixture(), files = unzipSync(exportXlsx(source)); delete files['commonplace/workbook.json'];
  const imported = importXlsx(zipSync(files)), cells = imported.sheets[0].cells;
  assert.equal(cells.A1.format.fontFamily, 'Georgia');
  assert.equal(cells.A1.format.fontSize, 18);
  for (let row = 1; row <= 11; row++) {
    const reference = 'A' + row, expected = source.sheets[0].cells[reference].format, actual = cells[reference].format;
    assert.equal(actual.numberFormat, expected.numberFormat, reference);
    if (expected.decimalPlaces !== undefined) assert.equal(actual.decimalPlaces, expected.decimalPlaces, reference);
    if (expected.dateFormat) assert.equal(actual.dateFormat, expected.dateFormat, reference);
    const calculated = computeCell(imported, imported.sheets[0].id, reference);
    assert.equal(formatCellValue(calculated, actual), formatCellValue(computeCell(source, 'main', reference), expected), reference);
  }
  assert.equal(cells.A11.value, '=SUM(A1,A3)');
});

test('[C3-55] independently authored builtin and custom Excel style codes distinguish time date scientific and precision', () => {
  const files = unzipSync(exportXlsx(workbook({})));
  delete files['commonplace/workbook.json'];
  files['xl/styles.xml'] = strToU8('<styleSheet><numFmts><numFmt numFmtId="164" formatCode="[Red]0.0000&quot; days&quot;"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss.000"/></numFmts><fonts><font><name val="Verdana"/><sz val="16"/></font></fonts><cellXfs><xf numFmtId="21" fontId="0"/><xf numFmtId="22"/><xf numFmtId="11"/><xf numFmtId="49"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>');
  files['xl/worksheets/sheet1.xml'] = strToU8('<worksheet><sheetData><row r="1"><c r="A1" s="0"><v>0.5</v></c><c r="B1" s="1"><v>45351.5</v></c><c r="C1" s="2"><v>12345</v></c><c r="D1" s="3" t="inlineStr"><is><t>00123</t></is></c><c r="E1" s="4"><v>12.34567</v></c><c r="F1" s="5"><v>45351.5</v></c></row></sheetData></worksheet>');
  const imported = importXlsx(zipSync(files)), cells = imported.sheets[0].cells;
  assert.equal(cells.A1.format.numberFormat, 'time');
  assert.equal(cells.B1.format.numberFormat, 'datetime');
  assert.equal(cells.C1.format.numberFormat, 'scientific');
  assert.equal(cells.C1.format.decimalPlaces, 2);
  assert.equal(cells.D1.format.numberFormat, 'text');
  assert.equal(computeCell(imported, imported.sheets[0].id, 'D1'), '00123');
  assert.equal(cells.E1.format.numberFormat, 'number');
  assert.equal(cells.E1.format.decimalPlaces, 4);
  assert.equal(cells.F1.format.dateFormat, 'iso');
  assert.equal(cells.F1.format.decimalPlaces, 3);
  assert.equal(cells.A1.format.fontFamily, 'Verdana');
});

test('[C3-56] native text cells retain literal dates percentages booleans and formulas through export and import', () => {
  const values = ['=1+2', '00123', 'TRUE', 'February 29, 2024', '$25', '12.5%', "'Hello"];
  const source = workbook(Object.fromEntries(values.map((value, index) => ['A' + (index + 1), { value: "'" + value, format: { numberFormat: 'text' } }])));
  source.sheets[0].cells.B1 = { value: '=A2', format: { numberFormat: 'text' } };
  const files = unzipSync(exportXlsx(source));
  assert.equal(tags(xml(strFromU8(files['xl/worksheets/sheet1.xml'])), 'f').length, 0);
  delete files['commonplace/workbook.json'];
  const imported = importXlsx(zipSync(files));
  values.forEach((expected, index) => assert.equal(computeCell(imported, imported.sheets[0].id, 'A' + (index + 1)), expected));
  assert.equal(computeCell(imported, imported.sheets[0].id, 'B1'), '=A2');
});

test('[C3-57] copied scalar and range references beyond either supported grid boundary become REF errors', () => {
  assert.equal(shiftFormulaReferences('=B1', 0, 198), '=GR1');
  assert.equal(shiftFormulaReferences('=B1', 0, 199), '=#REF!');
  assert.equal(shiftFormulaReferences('=A10000', 1, 0), '=#REF!');
  assert.equal(shiftFormulaReferences('=A1+$GR$10000+"GR10000"', 9999, 199), '=GR10000+$GR$10000+"GR10000"');
  assert.equal(shiftFormulaReferences("='Other'!B1", 0, 199), "='Other'!#REF!");
  assert.equal(evaluateFormula(shiftFormulaReferences('=SUM(GR1:GR2)', 0, 1), workbook({}), 'main'), '#REF!');
  assert.equal(evaluateFormula(shiftFormulaReferences('=SUM(A1:B1)', 0, -1), workbook({}), 'main'), '#REF!');
  assert.equal(evaluateFormula(shiftFormulaReferences("=SUM('Other'!GR1:GR2)", 0, 1), workbook({}), 'main'), '#REF!');
});
