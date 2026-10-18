import test from 'node:test';
import assert from 'node:assert/strict';
import { dateToSerial, serialToDate, parseDateInput, parseTimeInput, parseCellInput, formatCellValue } from '../src/lib/cellValues.js';
import { computeCell, evaluateFormula } from '../src/lib/formulas.js';

const workbook = (cells = {}) => ({ sheets: [{ id: 'main', name: 'Main', cells }] });
const evaluate = (formula, cells) => evaluateFormula(formula, workbook(cells), 'main');
const valueOf = (raw, format) => parseCellInput(raw, format).value;

test('[C3-01] ISO US and month-name date entry resolve to the same real serial', () => {
  for (const entry of ['2024-02-29', '2/29/2024', '02-29-2024', 'February 29, 2024', 'Feb. 29 2024', '29 February 2024']) {
    assert.equal(parseDateInput(entry).serial, 45351, entry);
    assert.equal(valueOf(entry), '45351', entry);
  }
  assert.equal(parseDateInput('Sept 18th, 2026').month, 9);
  assert.equal(dateToSerial(1970, 1, 1), 25569);
});

test('[C3-02] impossible dates and ambiguous short years never roll over or become formulas', () => {
  for (const entry of ['2023-02-29', '2024-02-30', '2/30/2024', '13/1/2024', 'April 31, 2024', '2/3/24', '1900-02-29', '2024-13-01']) {
    assert.equal(parseDateInput(entry), null, entry);
    assert.equal(valueOf(entry), entry, entry);
  }
  assert.equal(dateToSerial(2024, 2, 30), null);
  assert.equal(dateToSerial(2024, 0, 1), null);
  assert.equal(dateToSerial(2024.5, 1, 1), null);
});

test('[C3-03] date inference preserves existing cell styling and explicit date display preferences', () => {
  const format = { bold: true, bg: '#ffeecc', numberFormat: 'auto' };
  assert.deepEqual(parseCellInput('2026-10-18', format), { value: '46313', format: { ...format, numberFormat: 'date', dateFormat: 'iso' } });
  assert.equal(format.numberFormat, 'auto');
  assert.deepEqual(parseCellInput('10/18/2026', { numberFormat: 'date', dateFormat: 'long', italic: true }), { value: '46313', format: { numberFormat: 'date', dateFormat: 'long', italic: true } });
  assert.equal(valueOf('10/18/2026', { numberFormat: 'number' }), '10/18/2026');
});

test('[C3-04] text format and apostrophes preserve literals including formula-looking input', () => {
  assert.equal(valueOf('00123', { numberFormat: 'text' }), "'00123");
  assert.equal(valueOf('=1+2', { numberFormat: 'text' }), "'=1+2");
  assert.equal(valueOf("'=1+2", { numberFormat: 'text' }), "'=1+2");
  assert.equal(valueOf("'2026-10-18"), "'2026-10-18");
  const cells = { A1: { value: '=1+2', format: { numberFormat: 'text' } }, A2: { value: '00123', format: { numberFormat: 'text' } }, A3: { value: 'TRUE', format: { numberFormat: 'text' } } };
  assert.equal(computeCell(workbook(cells), 'main', 'A1'), '=1+2');
  assert.equal(computeCell(workbook(cells), 'main', 'A2'), '00123');
  assert.equal(computeCell(workbook(cells), 'main', 'A3'), 'TRUE');
});

test('[C3-05] numeric currency percent and accounting entry become calculable values without corrupting unsafe integers', () => {
  assert.deepEqual(parseCellInput('$1,234.50'), { value: '1234.5', format: { numberFormat: 'currency' } });
  assert.equal(valueOf('($1,234.50)'), '-1234.5');
  assert.equal(valueOf('USD 50'), '50');
  assert.equal(valueOf('50 USD'), '50');
  assert.deepEqual(parseCellInput('12.5%'), { value: '0.125', format: { numberFormat: 'percent' } });
  assert.equal(valueOf('(12%)'), '-0.12');
  assert.equal(valueOf('1.2e3'), '1200');
  for (const entry of ['1,2', '9007199254740993', '$foo', '€12', '(-12)', '1e309']) assert.equal(valueOf(entry), entry);
});

test('[C3-06] formulas and explicit numeric literals retain intent through parsing and calculation', () => {
  assert.deepEqual(parseCellInput('=SUM(A1:A2)'), { value: '=SUM(A1:A2)' });
  const cells = { A1: parseCellInput('12.5%'), A2: parseCellInput('$100'), A3: parseCellInput("'123"), B1: { value: '=SUM(A1:A3)' } };
  assert.equal(computeCell(workbook(cells), 'main', 'B1'), 100.125);
  assert.equal(computeCell(workbook(cells), 'main', 'A3'), '123');
  assert.equal(computeCell(workbook({ A1: parseCellInput('9007199254740993') }), 'main', 'A1'), '9007199254740993');
  assert.equal(computeCell(workbook({ A1: parseCellInput('0x10') }), 'main', 'A1'), '0x10');
});

test('[C3-07] decimal precision actually changes number currency percent and automatic display', () => {
  assert.equal(formatCellValue(1234.567, { numberFormat: 'number', decimalPlaces: 0 }), '1,235');
  assert.equal(formatCellValue(1.2, { numberFormat: 'number', decimalPlaces: 4 }), '1.2000');
  assert.equal(formatCellValue(12.345, { numberFormat: 'currency', decimalPlaces: 1 }), '$12.3');
  assert.equal(formatCellValue(0.125, { numberFormat: 'percent', decimalPlaces: 2 }), '12.50%');
  assert.equal(formatCellValue(1 / 3, { decimalPlaces: 10 }), '0.3333333333');
  assert.equal(formatCellValue(1.2, { numberFormat: 'number', decimalPlaces: 99 }), '1.20');
});

test('[C3-08] date formats show civil dates deterministically and preserve error/text display', () => {
  assert.equal(formatCellValue(45351, { numberFormat: 'date', dateFormat: 'iso' }), '2024-02-29');
  assert.equal(formatCellValue(45351, { numberFormat: 'date', dateFormat: 'short' }), '2/29/2024');
  assert.equal(formatCellValue(45351, { numberFormat: 'date', dateFormat: 'long' }), 'February 29, 2024');
  assert.equal(formatCellValue('2/30/2024', { numberFormat: 'date' }), '2/30/2024');
  assert.equal(formatCellValue('#VALUE!', { numberFormat: 'currency' }), '#VALUE!');
  assert.equal(formatCellValue(false), 'FALSE');
  assert.equal(formatCellValue(null), '');
});

test('[C3-09] time datetime and scientific entry/display use actual numeric values', () => {
  assert.equal(valueOf('1:30 PM'), '0.5625');
  assert.equal(valueOf('00:00'), '0');
  assert.equal(parseTimeInput('12 AM').hour, 0);
  assert.equal(parseTimeInput('12 PM').hour, 12);
  for (const entry of ['24:00', '1:60', '13 PM', '12:20:60']) assert.equal(valueOf(entry), entry);
  const cell = parseCellInput('2024-02-29 13:30:15');
  assert.equal(cell.format.numberFormat, 'datetime');
  assert.equal(formatCellValue(Number(cell.value), cell.format), '2024-02-29 13:30:15');
  assert.equal(formatCellValue(0.5625, { numberFormat: 'time' }), '13:30:00');
  assert.equal(formatCellValue(12345, { numberFormat: 'scientific', decimalPlaces: 2 }), '1.23E+04');
  assert.equal(formatCellValue(0.001, { numberFormat: 'scientific', decimalPlaces: 0 }), '1E-03');
});

test('[C3-10] entered and legacy date cells participate in arithmetic and date functions', () => {
  const cells = { A1: parseCellInput('2/29/2024'), A2: { value: '3/2/2024', format: { numberFormat: 'date' } }, B1: { value: '=A2-A1' }, B2: { value: '=DAY(A1+1)' } };
  assert.equal(computeCell(workbook(cells), 'main', 'B1'), 2);
  assert.equal(computeCell(workbook(cells), 'main', 'B2'), 1);
  assert.equal(evaluate('=YEAR(A1)', cells), 2024);
});

test('[C3-11] DATEVALUE and TIMEVALUE parse supported text and reject impossible calendar/time values', () => {
  assert.equal(evaluate('=DATEVALUE("February 29, 2024")'), 45351);
  assert.equal(evaluate('=DATEVALUE("2024-02-29 13:30")'), 45351);
  assert.equal(evaluate('=DATEVALUE("2023-02-29")'), '#VALUE!');
  assert.equal(evaluate('=TIMEVALUE("1:30 PM")'), 0.5625);
  assert.equal(evaluate('=TIMEVALUE("2024-02-29 13:30")'), 0.5625);
  assert.equal(evaluate('=TIMEVALUE("25:00")'), '#VALUE!');
});

test('[C3-12] TIME normalizes overflow and HOUR MINUTE SECOND recover components from serials', () => {
  assert.equal(evaluate('=TIME(25,30,0)'), 0.0625);
  assert.equal(evaluate('=TIME(0,90,0)'), 0.0625);
  assert.equal(evaluate('=TIME(-1,0,0)'), '#NUM!');
  assert.equal(evaluate('=HOUR(DATE(2024,2,29)+TIME(13,30,15))'), 13);
  assert.equal(evaluate('=MINUTE(TIME(13,30,15))'), 30);
  assert.equal(evaluate('=SECOND(DATE(2024,2,29)+TIME(13,30,15))'), 15);
});

test('[C3-13] TODAY and NOW use the host local calendar and current civil time', () => {
  const before = new Date();
  const today = evaluate('=TODAY()'), now = evaluate('=NOW()');
  const after = new Date();
  const local = (date) => dateToSerial(date.getFullYear(), date.getMonth() + 1, date.getDate()) + (date.getHours() * 3600000 + date.getMinutes() * 60000 + date.getSeconds() * 1000 + date.getMilliseconds()) / 86400000;
  assert.ok([Math.floor(local(before)), Math.floor(local(after))].includes(today));
  assert.ok(now >= local(before) && now <= local(after));
  assert.equal(evaluate('=NOW(1)'), '#VALUE!');
  assert.equal(evaluate('=TODAY(1)'), '#VALUE!');
});

test('[C3-14] serial conversion roundtrips leap/century dates and VALUE handles everyday entered values', () => {
  for (const [year, month, day] of [[2000, 2, 29], [1900, 3, 1], [2026, 10, 18], [9999, 12, 31]]) {
    const date = serialToDate(dateToSerial(year, month, day));
    assert.deepEqual([date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()], [year, month, day]);
  }
  assert.equal(serialToDate(Infinity), null);
  assert.equal(evaluate('=VALUE("12.5%")'), 0.125);
  assert.equal(evaluate('=VALUE("$1,234.50")'), 1234.5);
  assert.equal(evaluate('=VALUE("2024-02-29")'), 45351);
  assert.equal(evaluate('=VALUE("2024-02-30")'), '#VALUE!');
  assert.equal(evaluate('=VALUE("0x10")'), '#VALUE!');
});
