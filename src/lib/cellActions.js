import { cellKey, parseCell, createCalculator, shiftFormulaReferences, renameSheetReferences, retargetMovedReferences } from './formulas.js';
import { isProtected, validationError } from './sheetOperations.js';
import { parseCellInput } from './cellValues.js';

const MAX_ROWS = 10000, MAX_COLS = 200, MAX_CELLS = 100000;
const clone = (value) => structuredClone(value);
const sheetFor = (workbook, sheetId) => {
  const sheet = workbook?.sheets?.find((entry) => entry.id === sheetId);
  if (!sheet) throw new Error('The worksheet no longer exists.');
  return sheet;
};
function normalizeRange(range) {
  if (typeof range === 'string') {
    const parts = range.split(':'), start = parseCell(parts[0]), end = parseCell(parts[1] || parts[0]);
    if (parts.length > 2 || !start || !end) throw new Error('Choose a valid cell range.');
    range = { row: start.row, col: start.col, endRow: end.row, endCol: end.col };
  }
  const { row, col, endRow = row, endCol = col } = range || {};
  if (![row, col, endRow, endCol].every(Number.isInteger)) throw new Error('Choose a valid cell range.');
  const result = { row: Math.min(row, endRow), col: Math.min(col, endCol), endRow: Math.max(row, endRow), endCol: Math.max(col, endCol) };
  if (result.row < 0 || result.col < 0 || result.endRow >= MAX_ROWS || result.endCol >= MAX_COLS) throw new Error('The range must stay within 10,000 rows and 200 columns.');
  if ((result.endRow - result.row + 1) * (result.endCol - result.col + 1) > MAX_CELLS) throw new Error('Edit at most 100,000 cells at once.');
  return result;
}
const contains = (range, point) => point.row >= range.row && point.row <= range.endRow && point.col >= range.col && point.col <= range.endCol;
const intersects = (a, b) => a.row <= b.endRow && a.endRow >= b.row && a.col <= b.endCol && a.endCol >= b.col;
const each = (range, callback) => { for (let row = range.row; row <= range.endRow; row++) for (let col = range.col; col <= range.endCol; col++) callback(cellKey(row, col), row, col); };
function noMerges(sheet, range) {
  if ((sheet.merges || []).some((merge) => intersects(range, normalizeRange(merge)))) throw new Error('Unmerge cells in this range before copying, moving, or changing them.');
}
function rawCell(cell) {
  return cell ? { ...clone(cell), value: String(cell.value ?? '') } : null;
}
const displayRaw = (value) => typeof value === 'boolean' ? value ? 'TRUE' : 'FALSE' : String(value ?? '');
function mutable(sheet, reference, calculate, allowedArraySource) {
  if (isProtected(sheet, reference)) throw new Error(reference + ' is protected. Unprotect this range before editing it.');
  const origin = calculate.spillOrigin(sheet.id, reference);
  if (origin && !(allowedArraySource?.sheetId === sheet.id && contains(allowedArraySource.range, parseCell(origin)))) throw new Error(reference + ' belongs to the array in ' + origin + '. Edit or clear its source formula first.');
}
function enforceCellCount(workbook) {
  if (workbook.sheets.reduce((sum, sheet) => sum + Object.keys(sheet.cells || {}).length, 0) > MAX_CELLS) throw new Error('A workbook can contain at most 100,000 populated cells.');
  return workbook;
}
function validateClipboard(clipboard) {
  if (!clipboard || clipboard.type !== 'commonplace-range' || clipboard.version !== 1 || !Number.isInteger(clipboard.rows) || !Number.isInteger(clipboard.cols) || clipboard.rows < 1 || clipboard.cols < 1 || clipboard.rows * clipboard.cols > MAX_CELLS) throw new Error('The internal clipboard is invalid. Copy a range again.');
  const origin = normalizeRange(clipboard.range);
  if (clipboard.rows !== origin.endRow - origin.row + 1 || clipboard.cols !== origin.endCol - origin.col + 1 || !Array.isArray(clipboard.cells) || clipboard.cells.length !== clipboard.rows || !Array.isArray(clipboard.values) || clipboard.values.length !== clipboard.rows) throw new Error('The internal clipboard is invalid. Copy a range again.');
  for (let row = 0; row < clipboard.rows; row++) {
    if (!Array.isArray(clipboard.cells[row]) || clipboard.cells[row].length !== clipboard.cols || !Array.isArray(clipboard.values[row]) || clipboard.values[row].length !== clipboard.cols) throw new Error('The internal clipboard is invalid. Copy a range again.');
    for (let col = 0; col < clipboard.cols; col++) {
      const cell = clipboard.cells[row][col], value = clipboard.values[row][col];
      if (cell !== null && (!cell || typeof cell !== 'object' || typeof cell.value !== 'string' || cell.value.length > 100000) || typeof value !== 'string' || value.length > 100000) throw new Error('The internal clipboard is invalid. Copy a range again.');
    }
  }
  return origin;
}

/** Capture an internal snapshot; copying never mutates or clears the source. */
export function captureRange(workbook, sheetId, inputRange) {
  const sheet = sheetFor(workbook, sheetId), range = normalizeRange(inputRange);
  noMerges(sheet, range);
  const calculate = createCalculator(workbook);
  const rows = range.endRow - range.row + 1, cols = range.endCol - range.col + 1;
  const cells = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => rawCell(sheet.cells?.[cellKey(range.row + row, range.col + col)])));
  const evaluated = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => calculate(sheetId, cellKey(range.row + row, range.col + col))));
  const values = evaluated.map(row => row.map(displayRaw)), valueTypes = evaluated.map(row => row.map(value => typeof value));
  return { type: 'commonplace-range', version: 1, sourceSheetId: sheetId, sourceSheetName: sheet.name, origin: { row: range.row, col: range.col }, range, rows, cols, cells, values, valueTypes };
}

/** Paste all cells, evaluated values, or formats. A cut is committed only after every guard passes. */
export function pasteRange(workbook, sheetId, inputTarget, clipboard, { mode = 'all', cut = false } = {}) {
  const sourceRange = validateClipboard(clipboard);
  if (!['all', 'values', 'format'].includes(mode)) throw new Error('Choose all cells, values only, or formatting only.');
  if (cut && mode !== 'all') throw new Error('Use a normal paste when moving cut cells.');
  const sheet = sheetFor(workbook, sheetId);
  let point = typeof inputTarget === 'string' ? parseCell(inputTarget) : inputTarget;
  let rows = clipboard.rows, cols = clipboard.cols;
  if (point?.endRow !== undefined || point?.endCol !== undefined) {
    const selected = normalizeRange(point), requestedRows = selected.endRow - selected.row + 1, requestedCols = selected.endCol - selected.col + 1;
    if (requestedRows >= rows && requestedCols >= cols) {
      if (requestedRows % rows || requestedCols % cols) throw new Error('Select a destination whose height and width are exact multiples of the copied range.');
      rows = requestedRows; cols = requestedCols;
    } else if (requestedRows > rows || requestedCols > cols) throw new Error('Select one destination cell or a range matching the copied shape.');
    if (cut && (rows !== clipboard.rows || cols !== clipboard.cols)) throw new Error('Cut cells can only be moved to one destination of the same size.');
    point = { row: selected.row, col: selected.col };
  }
  const target = normalizeRange({ row: point?.row, col: point?.col, endRow: point?.row + rows - 1, endCol: point?.col + cols - 1 });
  noMerges(sheet, target);
  const calculate = createCalculator(workbook), sourceSheet = cut ? sheetFor(workbook, clipboard.sourceSheetId) : null;
  const allowedArraySource = cut ? { sheetId: sourceSheet.id, range: sourceRange } : null;
  const edits = [];
  if (cut) {
    noMerges(sourceSheet, sourceRange);
    each(sourceRange, (reference, row, col) => {
      if (JSON.stringify(rawCell(sourceSheet.cells?.[reference])) !== JSON.stringify(clipboard.cells[row - sourceRange.row][col - sourceRange.col])) throw new Error('The cut source changed. Cut the range again before moving it.');
      mutable(sourceSheet, reference, calculate, allowedArraySource);
    });
  }
  each(target, (reference, row, col) => {
    mutable(sheet, reference, calculate, allowedArraySource);
    const r = (row - target.row) % clipboard.rows, c = (col - target.col) % clipboard.cols, source = clipboard.cells[r][c], existing = sheet.cells?.[reference];
    let next;
    if (mode === 'format') {
      next = existing ? clone(existing) : { value: '' };
      if (source?.format) next.format = clone(source.format); else delete next.format;
    } else if (mode === 'values') {
      const value = clipboard.values[r][c], type = clipboard.valueTypes?.[r]?.[c];
      // A calculated string such as "=1+2", "TRUE", "00123", or a date stays text.
      // The snapshot is captured at copy time; subsequent source edits do not change it.
      const literal = type === 'string' && value !== '' ? "'" + value : value;
      next = { ...(existing ? clone(existing) : {}), value: literal };
    }
    else next = source ? { ...clone(source), value: cut || source.format?.numberFormat === 'text' ? source.value : shiftFormulaReferences(source.value, row - (sourceRange.row + r), col - (sourceRange.col + c)) } : null;
    if (mode !== 'format' && validationForPaste(sheet,reference)) { const invalid = validationError(sheet, reference, mode === 'values' ? clipboard.values[r][c] : next?.value || ''); if (invalid) throw new Error(invalid); }
    edits.push({ reference, cell: next });
  });
  const sheets = workbook.sheets.map((entry) => {
    if (entry.id !== sheetId && (!cut || entry.id !== sourceSheet.id)) return entry;
    const cells = { ...entry.cells };
    if (cut && entry.id === sourceSheet.id) each(sourceRange, (reference, row, col) => { if (entry.id !== sheetId || !contains(target, { row, col })) delete cells[reference]; });
    if (entry.id === sheetId) for (const { reference, cell } of edits) { if (cell && (cell.value !== '' || Object.keys(cell).some((key) => key !== 'value'))) cells[reference] = cell; else delete cells[reference]; }
    return { ...entry, cells };
  });
  let next={...workbook,sheets};
  if(cut){const move={sourceSheet,sourceRange,targetSheet:sheet,targetRow:target.row,targetCol:target.col};next={...next,namedRanges:(next.namedRanges||[]).map(entry=>{if(entry.sheetId!==sourceSheet.id||!intersects(entry.range,sourceRange))return entry;if(!contains(sourceRange,{row:entry.range.row,col:entry.range.col})||!contains(sourceRange,{row:entry.range.endRow,col:entry.range.endCol}))throw new Error('Move the whole named range or copy instead.');const dr=target.row-sourceRange.row,dc=target.col-sourceRange.col;return{...entry,sheetId:sheet.id,range:{row:entry.range.row+dr,col:entry.range.col+dc,endRow:entry.range.endRow+dr,endCol:entry.range.endCol+dc}};}),sheets:next.sheets.map(entry=>({...entry,cells:Object.fromEntries(Object.entries(entry.cells).map(([key,cell])=>{if(!cell.value.startsWith('=')||cell.format?.numberFormat==='text')return[key,cell];const movedFormula=entry.id===sheet.id&&contains(target,parseCell(key));const value=retargetMovedReferences(cell.value,{...move,currentSheet:movedFormula?sourceSheet:entry,movedFormula});if(value!==cell.value&&isProtected(entry,key))throw new Error('A protected dependent formula would change. Unprotect it before moving cells.');return[key,value===cell.value?cell:{...cell,value}];}))}))};}
  if(mode!=='format'){const proposed=next.sheets.find(s=>s.id===sheetId);for(const{reference,cell}of edits){const invalid=validationError(proposed,reference,mode==='values'?clipboard.values[(parseCell(reference).row-target.row)%clipboard.rows][(parseCell(reference).col-target.col)%clipboard.cols]:cell?.value||'',next,{proposed:true});if(invalid)throw new Error(invalid);}}
  return enforceCellCount(next);
}

const validationForPaste=(sheet,reference)=>(sheet.validations||[]).some(rule=>rule.type!=='formula'&&contains(rule.range,parseCell(reference)));

export function duplicateRange(workbook, sheetId, inputRange, direction = 'down') {
  const range = normalizeRange(inputRange);
  if (!['down', 'right'].includes(direction)) throw new Error('Choose duplicate down or duplicate right.');
  return pasteRange(workbook, sheetId, { row: direction === 'down' ? range.endRow + 1 : range.row, col: direction === 'right' ? range.endCol + 1 : range.col }, captureRange(workbook, sheetId, range));
}

export function duplicateWorksheet(workbook, sheetId) {
  const sheet = sheetFor(workbook, sheetId);
  if (workbook.sheets.length >= 100) throw new Error('A workbook can contain at most 100 worksheets.');
  const base = ('Copy of ' + sheet.name).slice(0, 180), used = new Set(workbook.sheets.map((entry) => entry.name.toLowerCase()));
  let name = base, suffix = 2;
  while (used.has(name.toLowerCase())) name = base + ' (' + suffix++ + ')';
  const duplicate = { ...clone(sheet), id: crypto.randomUUID(), name };
  for (const collection of ['charts', 'validations', 'conditionalRules', 'protectedRanges']) for (const entry of duplicate[collection] || []) if (entry.id) entry.id = crypto.randomUUID();
  for (const cell of Object.values(duplicate.cells)) if (String(cell.value).startsWith('=') && cell.format?.numberFormat !== 'text') cell.value = renameSheetReferences(cell.value, sheet.name, name);
  const index = workbook.sheets.findIndex((entry) => entry.id === sheetId);
  return enforceCellCount({ ...workbook, sheets: [...workbook.sheets.slice(0, index + 1), duplicate, ...workbook.sheets.slice(index + 1)], activeSheetId: duplicate.id });
}

/** Increment numeric values/date serials. Text and formulas require an explicit edit instead. */
export function increaseRange(workbook, sheetId, inputRange, step = 1) {
  if (typeof step !== 'number' || !Number.isFinite(step)) throw new Error('Use a finite numeric increment.');
  const sheet = sheetFor(workbook, sheetId), range = normalizeRange(inputRange);
  noMerges(sheet, range);
  const calculate = createCalculator(workbook), edits = [];
  each(range, (reference) => {
    mutable(sheet, reference, calculate);
    const source = sheet.cells?.[reference], raw = source?.value;
    if (raw === undefined || raw === '') return;
    const parsed = parseCellInput(raw, source.format);
    if (typeof raw === 'boolean' || String(raw).trim() === '' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(parsed.value) || !Number.isFinite(Number(parsed.value))) throw new Error(reference + ' contains text or a formula. Select numeric values or date cells to increment.');
    const value = Number(parsed.value) + step;
    if (!Number.isFinite(value)) throw new Error('The increment is outside the supported numeric range.');
    edits.push({ reference, cell: { ...clone(source), ...parsed, value: String(value) } });
  });
  const cells = { ...sheet.cells }; for (const { reference, cell } of edits) cells[reference] = cell;
  const proposed={...sheet,cells},next={...workbook,sheets:workbook.sheets.map(entry=>entry.id===sheetId?proposed:entry)};
  for(const {reference,cell}of edits){const invalid=validationError(proposed,reference,cell.value,next,{proposed:true});if(invalid)throw new Error(invalid);}
  return next;
}
