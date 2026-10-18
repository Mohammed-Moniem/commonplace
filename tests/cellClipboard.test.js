import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimitedCells } from '../src/lib/cellClipboard.js';

test('[C3-60] clipboard ordinary embedded quotes and formula quotes remain byte-for-byte text', () => {
  assert.deepEqual(parseDelimitedCells('Say "hello"\ta"b"c', '\t'), [['Say "hello"', 'a"b"c']]);
  const formula = '=IF(A1="yes",SUM(B1:B3),0)';
  assert.deepEqual(parseDelimitedCells(formula, '\t'), [[formula]]);
  assert.deepEqual(parseDelimitedCells('1,She said "go",3'), [['1', 'She said "go"', '3']]);
});

test('[C3-61] quoted separators and doubled quotes decode only within enclosed fields', () => {
  assert.deepEqual(parseDelimitedCells('"Osman, Mohammed","He said ""hello""",42'), [['Osman, Mohammed', 'He said "hello"', '42']]);
  assert.deepEqual(parseDelimitedCells('"a\tb"\t"say ""yes"""\t3', '\t'), [['a\tb', 'say "yes"', '3']]);
  assert.deepEqual(parseDelimitedCells('a""b\tc', '\t'), [['a""b', 'c']]);
});

test('[C3-62] quoted multiline cells preserve internal LF and CRLF while external CRLF delimits rows', () => {
  assert.deepEqual(parseDelimitedCells('Name\tNote\r\n张三\t"first\nsecond"\r\nعمر\t"one\r\ntwo"\r\n', '\t'), [['Name', 'Note'], ['张三', 'first\nsecond'], ['عمر', 'one\r\ntwo']]);
  assert.deepEqual(parseDelimitedCells('a,b\rc,d\r'), [['a', 'b'], ['c', 'd']]);
});

test('[C3-63] trailing blank cells and intentional empty rows survive without a phantom final record', () => {
  assert.deepEqual(parseDelimitedCells('a\tb\t\r\nc\t\t\r\n', '\t'), [['a', 'b', ''], ['c', '', '']]);
  assert.deepEqual(parseDelimitedCells('a\n\n'), [['a'], ['']]);
  assert.deepEqual(parseDelimitedCells('\t', '\t'), [['', '']]);
  assert.deepEqual(parseDelimitedCells('""'), [['']]);
  assert.deepEqual(parseDelimitedCells(''), []);
});

test('[C3-64] quoted CSV formulas and Unicode import exactly with a leading BOM removed', () => {
  const formula = '=IF(A1="yes",1,0)';
  assert.deepEqual(parseDelimitedCells('\uFEFFFormula,Label\n"=IF(A1=""yes"",1,0)",中文'), [['Formula', 'Label'], [formula, '中文']]);
  assert.deepEqual(parseDelimitedCells('  "literal"\t=SUM(A1:A3)', '\t'), [['  "literal"', '=SUM(A1:A3)']]);
});

test('[C3-65] malformed enclosed cells reject instead of discarding quotes or merging unknown rows', () => {
  assert.throws(() => parseDelimitedCells('"not closed\tvalue', '\t'), /unclosed quoted cell/);
  assert.throws(() => parseDelimitedCells('"quoted"tail,next'), /Unexpected text after a quoted cell/);
  assert.throws(() => parseDelimitedCells('data', '\r\n'), /single delimiter/);
  assert.deepEqual(parseDelimitedCells('"a"""\tb', '\t'), [['a"', 'b']]);
});
