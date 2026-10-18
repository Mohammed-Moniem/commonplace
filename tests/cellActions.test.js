import test from 'node:test';
import assert from 'node:assert/strict';
import { captureRange, pasteRange, duplicateRange, duplicateWorksheet, increaseRange } from '../src/lib/cellActions.js';
import { createCalculator } from '../src/lib/formulas.js';
import { fillSeries } from '../src/lib/sheetOperations.js';
import { dateToSerial, formatCellValue } from '../src/lib/cellValues.js';

const book = () => ({ sheets: [{ id: 'main', name: 'Main', cells: { A1: { value: '10', format: { bold: true, borders: { bottom: { color: '#123456', width: 1, style: 'solid' } } } }, B1: { value: '=A1+$A$1+Other!A1&"A1"' }, A2: { value: '20' } } }, { id: 'other', name: 'Other', cells: { A1: { value: '5' } } }], activeSheetId: 'main' });
const cells = (workbook, id = 'main') => workbook.sheets.find(sheet => sheet.id === id).cells;

test('[A3-01] capture snapshots raw cells and calculated values without sharing mutable formats', () => {
  const source = book(), before = structuredClone(source), clip = captureRange(source, 'main', 'A1:B2');
  assert.equal(clip.values[0][1], '25A1');
  assert.equal(clip.cells[1][1], null);
  clip.cells[0][0].format.borders.bottom.color = '#ffffff';
  assert.deepEqual(source, before);
});

test('[A3-02] copy paste shifts relative references, preserves anchors qualifiers and quoted strings', () => {
  const source = book(), before = structuredClone(source), clip = captureRange(source, 'main', 'A1:B1');
  const next = pasteRange(source, 'main', 'C3', clip);
  assert.equal(cells(next).C3.value, '10');
  assert.equal(cells(next).D3.value, '=C3+$A$1+Other!C3&"A1"');
  assert.deepEqual(cells(next).C3.format, cells(source).A1.format);
  cells(next).C3.format.borders.bottom.color = '#ffffff';
  assert.deepEqual(source, before);
});

test('[A3-03] values paste snapshots formulas while format paste retains destination values', () => {
  const source = book(); cells(source).D4 = { value: 'Keep', format: { italic: true } };
  const values = pasteRange(source, 'main', 'D4', captureRange(source, 'main', 'B1'), { mode: 'values' });
  assert.equal(createCalculator(values)('main', 'D4'), '25A1'); assert.deepEqual(cells(values).D4.format, { italic: true });
  const formatted = pasteRange(source, 'main', 'D4', captureRange(source, 'main', 'A1'), { mode: 'format' });
  assert.equal(cells(formatted).D4.value, 'Keep'); assert.equal(cells(formatted).D4.format.bold, true); assert.equal(cells(formatted).D4.format.italic, undefined);
  const cleared = pasteRange(source, 'main', 'D4', captureRange(source, 'main', 'Z50'), { mode: 'format' });
  assert.equal(cells(cleared).D4.value, 'Keep'); assert.equal(cells(cleared).D4.format, undefined);
});

test('[A3-04] cut overlap moves snapshots without deleting the destination and retargets moved references', () => {
  const source = book(), before = structuredClone(source), clip = captureRange(source, 'main', 'A1:B1');
  const next = pasteRange(source, 'main', 'B1', clip, { cut: true });
  assert.equal(cells(next).A1, undefined); assert.equal(cells(next).B1.value, '10');
  assert.equal(cells(next).C1.value, '=B1+$B$1+Other!A1&"A1"');
  assert.deepEqual(source, before);
  const other = pasteRange(source, 'other', 'A2', clip, { cut: true });
  assert.equal(cells(other).A1, undefined); assert.equal(cells(other, 'other').A2.value, '10');
});

test('[A3-05] stale cuts reject atomically and copying a blank clears the destination', () => {
  const source = book(), clip = captureRange(source, 'main', 'A1'); cells(source).A1.value = 'Changed';
  const before = structuredClone(source);
  assert.throws(() => pasteRange(source, 'main', 'C1', clip, { cut: true }), /cut source changed/);
  assert.deepEqual(source, before);
  const next = pasteRange(source, 'main', 'A1', captureRange(source, 'main', 'Z50'));
  assert.equal(cells(next).A1, undefined); assert.equal(cells(source).A1.value, 'Changed');
});

test('[A3-06] protected strict-validation and merged destinations reject the whole paste', () => {
  const source = book(), clip = captureRange(source, 'main', 'A1:B1');
  cells(source).C1 = { value: 'Keep' }; source.sheets[0].protectedRanges = [{ range: { row: 0, col: 3, endRow: 0, endCol: 3 } }];
  let before = structuredClone(source);
  assert.throws(() => pasteRange(source, 'main', 'C1', clip), /protected/); assert.deepEqual(source, before);
  delete source.sheets[0].protectedRanges; source.sheets[0].validations = [{ range: { row: 0, col: 3, endRow: 0, endCol: 3 }, options: ['Allowed'], strict: true }];
  before = structuredClone(source);
  assert.throws(() => pasteRange(source, 'main', 'C1', clip), /must be one of/); assert.deepEqual(source, before);
  source.sheets[0].merges = [{ row: 0, col: 2, endRow: 0, endCol: 3 }];
  assert.throws(() => pasteRange(source, 'main', 'C1', clip), /Unmerge/);
  assert.throws(() => captureRange(source, 'main', 'D1'), /Unmerge/);
});

test('[A3-07] array children cannot be overwritten and a complete array can be moved by its source', () => {
  const source = { sheets: [{ id: 's', name: 'Main', cells: { A1: { value: '=SEQUENCE(2,2)' }, D1: { value: '9' } } }] };
  const clip = captureRange(source, 's', 'D1'), before = structuredClone(source);
  assert.throws(() => pasteRange(source, 's', 'B2', clip), /array in A1/);
  assert.deepEqual(source, before);
  const moved = pasteRange(source, 's', 'A4', captureRange(source, 's', 'A1:B2'), { cut: true });
  const calculate = createCalculator(moved);
  assert.equal(cells(moved, 's').A1, undefined); assert.equal(calculate('s', 'B5'), 4);
});

test('[A3-08] paste repeats copied patterns only over exact shape multiples', () => {
  const source = book(), clip = captureRange(source, 'main', 'A1:B1');
  const next = pasteRange(source, 'main', { row: 3, col: 0, endRow: 4, endCol: 3 }, clip);
  assert.equal(cells(next).A4.value, '10'); assert.equal(cells(next).C5.value, '10');
  assert.equal(cells(next).D5.value, '=C5+$A$1+Other!C5&"A1"');
  assert.throws(() => pasteRange(source, 'main', { row: 3, col: 0, endRow: 4, endCol: 2 }, clip), /exact multiples/);
});

test('[A3-09] duplicate adjacent ranges preserves formula patterns and enforces grid bounds', () => {
  const source = book(), down = duplicateRange(source, 'main', 'A1:B1'), right = duplicateRange(source, 'main', 'A1:B1', 'right');
  assert.equal(cells(down).B2.value, '=A2+$A$1+Other!A2&"A1"');
  assert.equal(cells(right).D1.value, '=C1+$A$1+Other!C1&"A1"');
  assert.throws(() => captureRange(source, 'main', 'GS1'), /200 columns/);
  assert.throws(() => pasteRange(source, 'main', 'GR10000', captureRange(source, 'main', 'A1:B1')), /200 columns/);
  assert.throws(() => duplicateRange(source, 'main', 'A10000'), /10,000 rows/);
});

test('[A3-10] worksheet duplication creates unique identities and retargets only explicit self-sheet references', () => {
  const source = book(); cells(source).C1 = { value: '=Main!A1+Other!A1+"Main!A1"' };
  source.sheets[0].charts = [{ id: 'chart', type: 'pie' }];
  const once = duplicateWorksheet(source, 'main'), duplicate = once.sheets[1];
  assert.equal(duplicate.name, 'Copy of Main'); assert.notEqual(duplicate.id, 'main'); assert.equal(once.activeSheetId, duplicate.id);
  assert.equal(duplicate.cells.C1.value, "='Copy of Main'!A1+Other!A1+\"Main!A1\"");
  assert.notEqual(duplicate.charts[0].id, 'chart');
  assert.equal(duplicateWorksheet(once, 'main').sheets[1].name, 'Copy of Main (2)');
  duplicate.cells.A1.format.bold = false; assert.equal(cells(source).A1.format.bold, true);
});

test('[A3-11] numeric increments keep formats skip blanks and reject mixed text formulas or invalid dropdown values atomically', () => {
  const source = book(); delete cells(source).B1;
  const next = increaseRange(source, 'main', 'A1:B2', 2.5);
  assert.equal(cells(next).A1.value, '12.5'); assert.equal(cells(next).A2.value, '22.5'); assert.equal(cells(next).B2, undefined);
  assert.equal(cells(next).A1.format.bold, true);
  cells(source).B2 = { value: 'Text' }; let before = structuredClone(source);
  assert.throws(() => increaseRange(source, 'main', 'A1:B2', 1), /contains text or a formula/); assert.deepEqual(source, before);
  cells(source).B2.value = '=1+2';
  assert.throws(() => increaseRange(source, 'main', 'A1:B2', 1), /contains text or a formula/);
  source.sheets[0].validations = [{ range: { row: 0, col: 0, endRow: 0, endCol: 0 }, options: ['10'], strict: true }];
  assert.throws(() => increaseRange(source, 'main', 'A1', 1), /must be one of/);
});

test('[A3-12] entered dates and serial dates increment across leap day with date formatting preserved', () => {
  const source = { sheets: [{ id: 's', name: 'Dates', cells: { A1: { value: '2024-02-28' }, A2: { value: String(dateToSerial(2024, 2, 29)), format: { numberFormat: 'date', dateFormat: 'iso', bold: true } } } }] };
  const next = increaseRange(source, 's', 'A1:A2', 1);
  assert.equal(cells(next, 's').A1.value, String(dateToSerial(2024, 2, 29))); assert.equal(cells(next, 's').A1.format.numberFormat, 'date');
  assert.equal(formatCellValue(Number(cells(next, 's').A2.value), cells(next, 's').A2.format), '2024-03-01');
  assert.equal(cells(next, 's').A2.format.bold, true);
  assert.equal(cells(source, 's').A1.value, '2024-02-28');
});

test('[A3-13] increment never coerces explicit text invalid dates hex text or formulas', () => {
  for (const cell of [{ value: '2024-02-30' }, { value: "'10" }, { value: '10', format: { numberFormat: 'text' } }, { value: '0x10' }, { value: '=1+2' }]) {
    const source = { sheets: [{ id: 's', name: 'Main', cells: { A1: cell } }] }, before = structuredClone(source);
    assert.throws(() => increaseRange(source, 's', 'A1', 1), /contains text or a formula/); assert.deepEqual(source, before);
  }
});

test('[A3-14] date fill advances a strict calendar seed through leap day as serials with formats', () => {
  const sheet = { id: 's', name: 'Dates', cells: { A1: { value: '2024-02-28', format: { bold: true } } } }, before = structuredClone(sheet);
  const next = fillSeries(sheet, { row: 0, col: 0, endRow: 3, endCol: 0 }, 'down', { seedRange: { row: 0, col: 0, endRow: 0, endCol: 0 } });
  assert.deepEqual(sheet, before);
  assert.equal(next.cells.A1.value, '2024-02-28');
  assert.equal(formatCellValue(Number(next.cells.A2.value), next.cells.A2.format), '2024-02-29');
  assert.equal(formatCellValue(Number(next.cells.A3.value), next.cells.A3.format), '2024-03-01');
  assert.equal(formatCellValue(Number(next.cells.A4.value), next.cells.A4.format), '2024-03-02'); assert.equal(next.cells.A4.format.bold, true);
});

test('[A3-15] drag fill preserves every original seed and infers a two-day step after the final seed', () => {
  const sheet = { id: 's', name: 'Dates', cells: { A1: { value: '2024-02-27', format: { bold: true } }, A2: { value: '2024-02-29', format: { italic: true } } } };
  const next = fillSeries(sheet, { row: 0, col: 0, endRow: 3, endCol: 0 }, 'down', { seedRange: { row: 0, col: 0, endRow: 1, endCol: 0 } });
  assert.deepEqual(next.cells.A1, sheet.cells.A1); assert.deepEqual(next.cells.A2, sheet.cells.A2);
  assert.equal(formatCellValue(Number(next.cells.A3.value), next.cells.A3.format), '2024-03-02');
  assert.equal(formatCellValue(Number(next.cells.A4.value), next.cells.A4.format), '2024-03-04');
});

test('[A3-16] drag fill repeats text and formula seed patterns horizontally without losing styles', () => {
  const sheet = { id: 's', name: 'Main', cells: { A1: { value: 'Red', format: { color: '#ff0000' } }, B1: { value: 'Blue', format: { color: '#0000ff' } }, A2: { value: '=A1', format: { bold: true } }, B2: { value: '=B1*2', format: { italic: true } } } };
  const next = fillSeries(sheet, { row: 0, col: 0, endRow: 1, endCol: 3 }, 'right', { seedRange: { row: 0, col: 0, endRow: 1, endCol: 1 } });
  assert.equal(next.cells.C1.value, 'Red'); assert.equal(next.cells.D1.value, 'Blue'); assert.equal(next.cells.D1.format.color, '#0000ff');
  assert.equal(next.cells.C2.value, '=C1'); assert.equal(next.cells.D2.value, '=D1*2'); assert.equal(next.cells.D2.format.italic, true);
  assert.deepEqual(next.cells.B2, sheet.cells.B2);
});

test('[A3-17] fill bounds strict validation protected ranges and array children fail atomically', () => {
  const sheet = { id: 's', name: 'Main', cells: { A1: { value: '1' }, C1: { value: '=SEQUENCE(3)' } } };
  assert.throws(() => fillSeries(sheet, { row: 0, col: 0, endRow: 10000, endCol: 0 }), /10,000 rows/);
  assert.throws(() => fillSeries(sheet, { row: 0, col: 2, endRow: 2, endCol: 2 }), /array in C1/);
  sheet.validations = [{ range: { row: 1, col: 0, endRow: 2, endCol: 0 }, strict: true, options: ['2'] }];
  let before = structuredClone(sheet);
  assert.throws(() => fillSeries(sheet, { row: 0, col: 0, endRow: 2, endCol: 0 }), /must be one of/); assert.deepEqual(sheet, before);
  delete sheet.validations; sheet.protectedRanges = [{ range: { row: 2, col: 0, endRow: 2, endCol: 0 } }]; before = structuredClone(sheet);
  assert.throws(() => fillSeries(sheet, { row: 0, col: 0, endRow: 2, endCol: 0 }), /Unprotect/); assert.deepEqual(sheet, before);
});

test('[A3-18] cut source protection and unsupported cut special paste leave both ranges untouched', () => {
  const source = book(), clip = captureRange(source, 'main', 'A1');
  source.sheets[0].protectedRanges = [{ range: { row: 0, col: 0, endRow: 0, endCol: 0 } }]; const before = structuredClone(source);
  assert.throws(() => pasteRange(source, 'main', 'D1', clip, { cut: true }), /protected/);
  assert.throws(() => pasteRange(source, 'main', 'D1', clip, { cut: true, mode: 'values' }), /normal paste/);
  assert.deepEqual(source, before);
});

test('[A3-19] legacy text-formatted formula-looking values remain literal during copy fill and sheet duplication', () => {
  const source = { sheets: [{ id: 's', name: 'Main', cells: { A1: { value: '=Main!A1', format: { numberFormat: 'text' } } } }] };
  const copied = pasteRange(source, 's', 'B2', captureRange(source, 's', 'A1'));
  assert.equal(cells(copied, 's').B2.value, '=Main!A1');
  assert.equal(createCalculator(copied)('s', 'B2'), '=Main!A1');
  assert.equal(duplicateWorksheet(source, 's').sheets[1].cells.A1.value, '=Main!A1');
  const filled = fillSeries(source.sheets[0], { row: 0, col: 0, endRow: 1, endCol: 0 }, 'down', { seedRange: { row: 0, col: 0, endRow: 0, endCol: 0 } });
  assert.equal(createCalculator({ sheets: [filled] })('s', 'A2'), '=Main!A1');
});

test('[A3-20] paste values retains captured string types including formula-looking text numbers booleans and dates', () => {
  const source = { sheets: [{ id: 's', name: 'Main', cells: { A1: { value: '="=1+2"' }, A2: { value: "'00123" }, A3: { value: "'TRUE" }, A4: { value: "'2026-10-18" }, A5: { value: '42' }, A6: { value: 'TRUE' } } }] };
  const clip = captureRange(source, 's', 'A1:A6');
  cells(source, 's').A1.value = '=100';
  const next = pasteRange(source, 's', 'C1', clip, { mode: 'values' }), calculate = createCalculator(next);
  assert.equal(calculate('s', 'C1'), '=1+2'); assert.equal(calculate('s', 'C2'), '00123');
  assert.equal(calculate('s', 'C3'), 'TRUE'); assert.equal(calculate('s', 'C4'), '2026-10-18');
  assert.equal(calculate('s', 'C5'), 42); assert.equal(calculate('s', 'C6'), true);
});

test('[A3-21] reverse destination selections normalize to top-left before repeating the pattern', () => {
  const source = book(), clip = captureRange(source, 'main', 'A1');
  const next = pasteRange(source, 'main', { row: 4, col: 2, endRow: 2, endCol: 2 }, clip);
  assert.equal(cells(next).C3.value, '10'); assert.equal(cells(next).C4.value, '10'); assert.equal(cells(next).C5.value, '10');
  assert.equal(cells(next).C6, undefined);
});

test('[A3-22] values-only paste validates the captured text rather than its literal storage escape', () => {
  const source = { sheets: [{ id: 's', name: 'Main', cells: { A1: { value: '="Done"' }, B1: { value: 'Todo' } }, validations: [{ range: { row: 0, col: 1, endRow: 0, endCol: 1 }, strict: true, options: ['Todo', 'Done'] }] }] };
  const next = pasteRange(source, 's', 'B1', captureRange(source, 's', 'A1'), { mode: 'values' });
  assert.equal(createCalculator(next)('s', 'B1'), 'Done');
  cells(source, 's').A1.value = '="Other"'; const before = structuredClone(source);
  assert.throws(() => pasteRange(source, 's', 'B1', captureRange(source, 's', 'A1'), { mode: 'values' }), /must be one of/);
  assert.deepEqual(source, before);
});
