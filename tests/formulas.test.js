import test from 'node:test';
import assert from 'node:assert/strict';
import { cellKey, parseCell, computeCell, evaluateFormula, shiftFormulaReferences, adjustWorkbookStructure, renameSheetReferences } from '../src/lib/formulas.js';

const book = () => ({ sheets: [
  { id: 'one', name: 'Sheet 1', cells: { A1: { value: '10' }, A2: { value: '20' }, A3: { value: 'hello' }, B1: { value: '=SUM(A1:A2)*2' }, C1: { value: '=B1+A1' } } },
  { id: 'two', name: 'Sales', cells: { A1: { value: "='Sheet 1'!C1+5" } } },
] });
test('coordinates support beyond Z and absolute anchors', () => { assert.equal(cellKey(14, 27), 'AB15'); assert.deepEqual(parseCell('$AB$15'), { row: 14, col: 27, absoluteCol: true, absoluteRow: true }); });
test('formula dependency graph, cross-sheet names, and ranges', () => { assert.equal(computeCell(book(), 'one', 'C1'), 70); assert.equal(computeCell(book(), 'two', 'A1'), 75); assert.equal(evaluateFormula('=AVERAGE(A1:A3)', book(), 'one'), 15); });
test('arithmetic precedence, comparisons, percentages, and concatenation', () => { assert.equal(evaluateFormula('=2+3*4^2', book(), 'one'), 50); assert.equal(evaluateFormula('=50%*A2', book(), 'one'), 10); assert.equal(evaluateFormula('=IF(A1<20,"ok "&UPPER(A3),"no")', book(), 'one'), 'ok HELLO'); });
test('conditional branches are lazy and errors can be caught', () => { assert.equal(evaluateFormula('=IF(TRUE,42,1/0)', book(), 'one'), 42); assert.equal(evaluateFormula('=IFERROR(1/0,"missing")', book(), 'one'), 'missing'); assert.equal(evaluateFormula('=1/0', book(), 'one'), '#DIV/0!'); assert.equal(evaluateFormula('=UNKNOWN(1)', book(), 'one'), '#NAME?'); });
test('cycles are explicit errors including cross-sheet cycles', () => { const value = book(); value.sheets[0].cells.A1.value = '=B1'; assert.equal(computeCell(value, 'one', 'B1'), '#CYCLE!'); value.sheets[0].cells.A1.value = '=Sales!A1'; assert.equal(computeCell(value, 'two', 'A1'), '#CYCLE!'); });
test('criteria functions and exact lookup', () => { assert.equal(evaluateFormula('=SUMIF(A1:A3,">15",A1:A3)', book(), 'one'), 20); assert.equal(evaluateFormula('=COUNTIF(A1:A3,"h*")', book(), 'one'), 1); assert.equal(evaluateFormula('=COUNT(A1:A3)', book(), 'one'), 2); assert.equal(evaluateFormula('=VLOOKUP(10,A1:B2,2,FALSE)', book(), 'one'), 60); });
test('copying respects anchors, sheets, and text literals', () => { assert.equal(shiftFormulaReferences('=SUM(A1,$B$2,C$3,$D4)+"A1"', 2, 1), '=SUM(B3,$B$2,D$3,$D6)+"A1"'); assert.equal(shiftFormulaReferences('=A1', -1, 0), '=#REF!'); });
test('row insertion moves cells and dependent references in every sheet', () => { const next = adjustWorkbookStructure(book(), 'one', 'row', 0, 1); assert.equal(next.sheets[0].cells.B2.value, '=SUM(A2:A3)*2'); assert.equal(next.sheets[1].cells.A1.value, "='Sheet 1'!C2+5"); assert.equal(computeCell(next, 'two', 'A1'), 75); });
test('deletion does not silently reference the next row', () => { const next = adjustWorkbookStructure(book(), 'one', 'row', 0, -1); assert.equal(next.sheets[0].cells.A1.value, '20'); assert.equal(next.sheets[1].cells.A1.value, "='Sheet 1'!#REF!+5"); assert.equal(computeCell(next, 'two', 'A1'), '#REF!'); });
test('deleting a range edge shrinks the range and moves validation/format/chart ranges', () => { const original = book(); original.sheets[0].cells.B3 = { value: '=SUM(A1:A2)*2' }; original.sheets[0].validations = [{ range: { row: 0, col: 0, endRow: 2, endCol: 1 }, options: ['Done'] }]; const next = adjustWorkbookStructure(original, 'one', 'row', 0, -1); assert.equal(next.sheets[0].cells.B2.value, '=SUM(A1:A1)*2'); assert.equal(computeCell(next, 'one', 'B2'), 40); assert.deepEqual(next.sheets[0].validations[0].range, { row: 0, col: 0, endRow: 1, endCol: 1 }); });
test('untrusted expression cannot execute JavaScript', () => { assert.equal(evaluateFormula('=globalThis.process.exit()', book(), 'one'), '#NAME?'); assert.equal(evaluateFormula('=1;alert(1)', book(), 'one'), '#ERROR!'); });
test('ROUND rounds halfway away from zero and MOD follows the divisor sign', () => {
  assert.equal(evaluateFormula('=ROUND(-1.5,0)', book(), 'one'), -2);
  assert.equal(evaluateFormula('=ROUND(-1.005,2)', book(), 'one'), -1.01);
  assert.equal(evaluateFormula('=ROUND(1.005,2)', book(), 'one'), 1.01);
  assert.equal(evaluateFormula('=MOD(-3,2)', book(), 'one'), 1);
  assert.equal(evaluateFormula('=MOD(3,-2)', book(), 'one'), -1);
  assert.equal(evaluateFormula('=MOD(-3,-2)', book(), 'one'), -1);
  assert.equal(evaluateFormula('=MOD(3,0)', book(), 'one'), '#DIV/0!');
});
test('nonfinite intermediate results are errors that IFERROR can handle', () => {
  assert.equal(evaluateFormula('=POWER(-1,0.5)', book(), 'one'), '#NUM!');
  assert.equal(evaluateFormula('=10^1000', book(), 'one'), '#NUM!');
  assert.equal(evaluateFormula('=IFERROR(POWER(-1,0.5),"caught")', book(), 'one'), 'caught');
  const value = book(); value.sheets[0].cells.D1 = { value: '=IFERROR(10^1000,7)' };
  assert.equal(computeCell(value, 'one', 'D1'), 7);
});
test('renaming sheets preserves text literals and escapes quoted names', () => {
  assert.equal(renameSheetReferences('=Sales!A1+"Sales!A1"+sales!B1', 'Sales', 'New sales'), '=\'New sales\'!A1+"Sales!A1"+\'New sales\'!B1');
  assert.equal(renameSheetReferences("='Sheet 1'!A1+Other!B2", 'Sheet 1', "O'Brien"), "='O''Brien'!A1+Other!B2");
  assert.equal(renameSheetReferences('=SalesOther!A1', 'Sales', 'New'), '=SalesOther!A1');
  assert.equal(renameSheetReferences('Sales!A1', 'Sales', 'New'), 'Sales!A1');
});
test('VLOOKUP defaults to sorted approximate lookup and supports explicit exact mode', () => {
  const workbook = { sheets: [{ id: 'lookup', name: 'Lookup', cells: Object.fromEntries([['10', 'Low'], ['20', 'Medium'], ['40', 'High']].flatMap((row, r) => row.map((value, c) => [cellKey(r, c), { value }]))) }] };
  const run = (formula) => evaluateFormula(formula, workbook, 'lookup');
  assert.equal(run('=VLOOKUP(25,A1:B3,2)'), 'Medium');
  assert.equal(run('=VLOOKUP(25,A1:B3,2,TRUE)'), 'Medium');
  assert.equal(run('=VLOOKUP(25,A1:B3,2,FALSE)'), '#N/A');
  assert.equal(run('=VLOOKUP(20,A1:B3,2,0)'), 'Medium');
  assert.equal(run('=VLOOKUP(5,A1:B3,2,1)'), '#N/A');
  assert.equal(run('=VLOOKUP(90,A1:B3,2,1)'), 'High');
  assert.equal(run('=VLOOKUP(20,A1:B3,2,2)'), '#VALUE!');
  assert.equal(run('=VLOOKUP(20,A1:B3,3,FALSE)'), '#REF!');
});
test('MATCH handles ascending default, exact, descending negative mode and invalid modes', () => {
  const workbook = { sheets: [{ id: 'lookup', name: 'Lookup', cells: { A1: { value: '10' }, A2: { value: '20' }, A3: { value: '40' }, B1: { value: '40' }, B2: { value: '20' }, B3: { value: '10' } } }] };
  const run = (formula) => evaluateFormula(formula, workbook, 'lookup');
  assert.equal(run('=MATCH(25,A1:A3)'), 2);
  assert.equal(run('=MATCH(25,A1:A3,0)'), '#N/A');
  assert.equal(run('=MATCH(20,A1:A3,0)'), 2);
  assert.equal(run('=MATCH(25,B1:B3,-1)'), 1);
  assert.equal(run('=MATCH(15,B1:B3,-1)'), 2);
  assert.equal(run('=MATCH(50,B1:B3,-1)'), '#N/A');
  assert.equal(run('=MATCH(25,A1:A3,2)'), '#VALUE!');
  assert.equal(run('=MATCH(25,A1:A3,"bad")'), '#VALUE!');
  assert.equal(run('=MATCH(20,A1:B3,0)'), '#N/A');
});
