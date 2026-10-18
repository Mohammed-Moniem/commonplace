import { extendedFormula } from './extendedFormulas.js';
import { dateToSerial, parseCellInput } from './cellValues.js';
// A small, deterministic spreadsheet interpreter. No JavaScript is evaluated.
export const columnName = (index) => {
  let value = index + 1;
  let name = '';
  while (value > 0) { name = String.fromCharCode(65 + (value - 1) % 26) + name; value = Math.floor((value - 1) / 26); }
  return name;
};
export const columnIndex = (name) => [...name.replaceAll('$', '').toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
export const cellKey = (row, col) => `${columnName(col)}${row + 1}`;
export const parseCell = (reference) => {
  const match = /^([$]?)([A-Z]+)([$]?)([1-9]\d*)$/i.exec(reference);
  return match ? { row: Number(match[4]) - 1, col: columnIndex(match[2]), absoluteCol: !!match[1], absoluteRow: !!match[3] } : null;
};
class FormulaError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = (code) => { throw new FormulaError(code); };
const numericText = (value) => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isFinite(Number(value));
const number = (value) => {
  if (value === null || value === '' || value === undefined) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && numericText(value)) return Number(value);
  return fail('#VALUE!');
};
const flat = (value) => Array.isArray(value) ? value.flat(Infinity) : [value];
const truthy = (value) => typeof value === 'string' ? value !== '' && value.toUpperCase() !== 'FALSE' : !!value;

function tokenize(input) {
  const tokens = [];
  let index = 0;
  while (index < input.length) {
    const start = index;
    if (/\s/.test(input[index])) { index++; continue; }
    const current = input[index];
    if (current === '"' || current === "'") {
      const quote = current; let value = ''; index++;
      let closed = false;
      while (index < input.length) {
        if (input[index] === quote) {
          if (input[index + 1] === quote) { value += quote; index += 2; }
          else { index++; closed = true; break; }
        } else value += input[index++];
      }
      if (!closed) fail('#ERROR!');
      tokens.push({ type: quote === '"' ? 'string' : 'sheet', value, start, end: index }); continue;
    }
    const rest = input.slice(index);
    const numeric = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
    if (numeric) { index += numeric[0].length; tokens.push({ type: 'number', value: Number(numeric[0]), start, end: index }); continue; }
    const error = /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|ERROR!|CYCLE!)/i.exec(rest);
    if (error) { index += error[0].length; tokens.push({ type: 'error', value: error[0].toUpperCase(), start, end: index }); continue; }
    const identifier = /^[$A-Z_][$A-Z0-9_.]*/i.exec(rest);
    if (identifier) { index += identifier[0].length; tokens.push({ type: 'identifier', value: identifier[0], start, end: index }); continue; }
    const operator = /^(?:<>|<=|>=|[+\-*/^&=<>(),:!%])/i.exec(rest);
    if (operator) { index += operator[0].length; tokens.push({ type: operator[0], value: operator[0], start, end: index }); continue; }
    fail('#ERROR!');
  }
  tokens.push({ type: 'eof', value: '', start: index, end: index }); return tokens;
}

function parse(input) {
  const tokens = tokenize(input); let index = 0;
  const peek = () => tokens[index];
  const take = (type) => { if (peek().type !== type) fail('#ERROR!'); return tokens[index++]; };
  const referenceError = (token) => {
    // A copied range may lose either endpoint at a grid boundary. Preserve its
    // reference error rather than reporting a generic formula syntax error.
    if (token.value === '#REF!' && peek().type === ':') {
      index++;
      if (!['identifier', 'sheet', 'error'].includes(peek().type)) fail('#ERROR!');
      index++;
      if (peek().type === '!') { index++; if (!['identifier', 'error'].includes(peek().type)) fail('#ERROR!'); index++; }
    }
    return { kind: 'error', value: token.value };
  };
  function primary() {
    const token = peek();
    if (token.type === 'number' || token.type === 'string') { index++; return { kind: 'literal', value: token.value }; }
    if (token.type === 'error') { index++; return referenceError(token); }
    if (token.type === '(') { index++; const result = expression(); take(')'); return result; }
    if (token.type === 'identifier' || token.type === 'sheet') {
      index++;
      if (peek().type === '(' && token.type === 'identifier') {
        index++; const args = [];
        if (peek().type !== ')') { do { args.push(expression()); if (peek().type !== ',') break; index++; } while (true); }
        take(')'); return { kind: 'call', name: token.value.toUpperCase(), args };
      }
      if (/^(TRUE|FALSE)$/i.test(token.value) && peek().type !== '!') return { kind: 'literal', value: token.value.toUpperCase() === 'TRUE' };
      let sheet = null; let reference = token.value;
      if (peek().type === '!') { index++; sheet = token.value; if (peek().type === 'error') return referenceError(tokens[index++]); reference = take('identifier').value; }
      if (!parseCell(reference)) return { kind: 'name', name: reference, sheet };
      const result = { kind: 'ref', sheet, reference: reference.replaceAll('$', '').toUpperCase() };
      if (peek().type === ':') {
        index++; if (peek().type === 'error') return { kind: 'error', value: tokens[index++].value }; let end = take('identifier').value;
        if (peek().type === '!') { index++; end = take('identifier').value; }
        if (!parseCell(end)) fail('#REF!');
        return { kind: 'range', sheet, start: result.reference, end: end.replaceAll('$', '').toUpperCase() };
      }
      return result;
    }
    fail('#ERROR!');
  }
  function unary() {
    if (peek().type === '+' || peek().type === '-') { const op = tokens[index++].type; return { kind: 'unary', op, value: unary() }; }
    let result = primary();
    while (peek().type === '%') { index++; result = { kind: 'binary', op: '/', left: result, right: { kind: 'literal', value: 100 } }; }
    return result;
  }
  function power() { let left = unary(); if (peek().type === '^') { index++; left = { kind: 'binary', op: '^', left, right: power() }; } return left; }
  function binary(next, operators) { let left = next(); while (operators.includes(peek().type)) { const op = tokens[index++].type; left = { kind: 'binary', op, left, right: next() }; } return left; }
  const multiply = () => binary(power, ['*', '/']);
  const add = () => binary(multiply, ['+', '-']);
  const concat = () => binary(add, ['&']);
  const expression = () => binary(concat, ['=', '<>', '<', '>', '<=', '>=']);
  const ast = expression(); if (peek().type !== 'eof') fail('#ERROR!'); return ast;
}

function criteriaMatches(value, criteria) {
  const text = String(criteria ?? '');
  const match = /^(>=|<=|<>|>|<|=)(.*)$/.exec(text);
  if (match) {
    const operand = Number.isFinite(Number(match[2])) && match[2].trim() !== '' ? Number(match[2]) : match[2];
    return compare(value, operand, match[1]);
  }
  if (text.includes('*') || text.includes('?')) {
    const escaped = text.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i').test(String(value ?? ''));
  }
  return compare(value, criteria, '=');
}
function compare(left, right, op) {
  if (left == null) left = '';
  if (right == null) right = '';
  const numeric = (v) => (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v));
  if (numeric(left) && numeric(right)) { left = Number(left); right = Number(right); }
  else { left = String(left).toLowerCase(); right = String(right).toLowerCase(); }
  return op === '=' ? left === right : op === '<>' ? left !== right : op === '>' ? left > right : op === '<' ? left < right : op === '>=' ? left >= right : left <= right;
}

function callFunction(name, args) {
  const extended = extendedFormula(name, args, { number, fail, compare, criteriaMatches });
  if (extended !== undefined) return extended;
  const values = args.flatMap(flat);
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const first = args[0] ?? '';
  switch (name) {
    case 'SUM': return nums.reduce((sum, v) => sum + v, 0);
    case 'AVERAGE': return nums.length ? nums.reduce((sum, v) => sum + v, 0) / nums.length : fail('#DIV/0!');
    case 'MIN': return nums.length ? Math.min(...nums) : 0;
    case 'MAX': return nums.length ? Math.max(...nums) : 0;
    case 'COUNT': return nums.length;
    case 'COUNTA': return values.filter((v) => v !== null && v !== '').length;
    case 'COUNTBLANK': return values.filter((v) => v === null || v === '').length;
    case 'ROUND': { const factor = 10 ** number(args[1] ?? 0); const value = number(first); const result = Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * factor) / factor; return result === 0 ? 0 : result; }
    case 'ROUNDUP': { const factor = 10 ** number(args[1] ?? 0); const v = number(first); return Math.sign(v) * Math.ceil(Math.abs(v) * factor) / factor; }
    case 'ROUNDDOWN': { const factor = 10 ** number(args[1] ?? 0); return Math.trunc(number(first) * factor) / factor; }
    case 'ABS': return Math.abs(number(first));
    case 'SQRT': return number(first) >= 0 ? Math.sqrt(number(first)) : fail('#NUM!');
    case 'POWER': return number(first) ** number(args[1]);
    case 'MOD': { const divisor = number(args[1]); if (!divisor) fail('#DIV/0!'); const value = number(first); return value - divisor * Math.floor(value / divisor); }
    case 'INT': return Math.floor(number(first));
    case 'LEN': return String(first).length;
    case 'UPPER': return String(first).toUpperCase();
    case 'LOWER': return String(first).toLowerCase();
    case 'TRIM': return String(first).trim().replace(/\s+/g, ' ');
    case 'CONCAT': case 'CONCATENATE': return values.map((v) => v ?? '').join('');
    case 'TEXTJOIN': return flat(args.slice(2)).filter((v) => !truthy(args[1]) || v !== null && v !== '').join(String(first));
    case 'LEFT': return String(first).slice(0, Math.max(0, number(args[1] ?? 1)));
    case 'RIGHT': { const length = Math.max(0, number(args[1] ?? 1)); return length ? String(first).slice(-length) : ''; }
    case 'MID': return String(first).slice(Math.max(0, number(args[1]) - 1), Math.max(0, number(args[1]) - 1) + Math.max(0, number(args[2])));
    case 'SUBSTITUTE': { if (args.length < 3 || args.length > 4) fail('#VALUE!'); const source = String(first); const old = String(args[1]); if (!old) return source; if (args.length === 3) return source.split(old).join(String(args[2])); const occurrence = number(args[3]); if (!Number.isInteger(occurrence) || occurrence < 1) fail('#VALUE!'); let seen = 0; let result = ''; let start = 0; let found; while ((found = source.indexOf(old,start)) !== -1) { result += source.slice(start,found) + (++seen === occurrence ? String(args[2]) : old); start = found + old.length; } return result + source.slice(start); }
    case 'VALUE': return number(typeof first === 'string' ? parseCellInput(first).value : first);
    case 'NOT': return !truthy(first);
    case 'AND': return values.every(truthy);
    case 'OR': return values.some(truthy);
    case 'ISNUMBER': return typeof first === 'number';
    case 'ISTEXT': return typeof first === 'string';
    case 'ISBLANK': return first == null || first === '';
    case 'COUNTIF': return flat(first).filter((v) => criteriaMatches(v, args[1])).length;
    case 'SUMIF': return flat(first).reduce((sum, v, i) => sum + (criteriaMatches(v, args[1]) && typeof flat(args[2] ?? first)[i] === 'number' ? flat(args[2] ?? first)[i] : 0), 0);
    case 'AVERAGEIF': { const targets = flat(args[2] ?? first).filter((v, i) => typeof v === 'number' && criteriaMatches(flat(first)[i], args[1])); return targets.length ? targets.reduce((a, b) => a + b, 0) / targets.length : fail('#DIV/0!'); }
    case 'VLOOKUP': {
      const table = args[1];
      if (args.length < 3 || args.length > 4 || !Array.isArray(table) || !table.every(Array.isArray)) fail('#VALUE!');
      const index = number(args[2]); const mode = args.length === 4 ? number(args[3]) : 1;
      if (![0, 1].includes(mode) || !Number.isInteger(index) || index < 1) fail('#VALUE!');
      if (table.some((row) => index > row.length)) fail('#REF!');
      let found = -1;
      if (mode === 0) found = table.findIndex((row) => compare(row[0], first, '='));
      // Approximate lookup follows ascending-order spreadsheet semantics: the
      // final key at or below the search key wins. The source must be sorted.
      else for (let i = 0; i < table.length; i++) { if (compare(table[i][0], first, '<=')) found = i; else break; }
      if (found < 0) fail('#N/A');
      return table[found][index - 1] ?? 0;
    }
    case 'INDEX': { const table = args[0]; if (!Array.isArray(table)) fail('#VALUE!'); return table[number(args[1]) - 1]?.[number(args[2] ?? 1) - 1] ?? fail('#REF!'); }
    case 'MATCH': {
      const range = args[1]; const mode = args.length === 3 ? number(args[2]) : 1;
      if (args.length < 2 || args.length > 3 || ![-1, 0, 1].includes(mode)) fail('#VALUE!');
      if (!Array.isArray(range) || !range.every(Array.isArray) || range.length > 1 && range.some((row) => row.length > 1)) fail('#N/A');
      const items = flat(range); let found = -1;
      if (mode === 0) found = items.findIndex((value) => compare(value, first, '='));
      // 1 expects ascending data; -1 expects descending data. Stop at the first
      // boundary so approximate modes never silently behave as exact lookup.
      else for (let i = 0; i < items.length; i++) { if (compare(items[i], first, mode === 1 ? '<=' : '>=')) found = i; else break; }
      return found < 0 ? fail('#N/A') : found + 1;
    }
    case 'TODAY': { if (args.length) fail('#VALUE!'); const now = new Date(); return dateToSerial(now.getFullYear(), now.getMonth() + 1, now.getDate()); }
    default: return fail('#NAME?');
  }
}

function makeContext(workbook) {
  const cache = new Map(); const stack = new Set(); const spills = new Map(); const spillOrigins = new Map();
  const scalar = (value) => Array.isArray(value) ? value[0]?.[0] ?? null : value;
  const resolveSheet = (sheet) => workbook.sheets.find((s) => s.id === sheet || s.name.toLowerCase() === String(sheet).toLowerCase()) ?? fail('#REF!');
  function read(sheet, reference) {
    const key = `${sheet.id}!${reference}`;
    if (stack.has(key)) fail('#CYCLE!');
    if (cache.has(key)) { const value = cache.get(key); if (value instanceof FormulaError) throw value; return value; }
    const cell = sheet.cells?.[reference];
    const value = cell?.value;
    if (value === undefined || value === '') return spills.get(key) ?? null;
    stack.add(key);
    try {
      let result;
      const input = parseCellInput(value, cell?.format).value;
      if (input.startsWith("'")) result = input.slice(1);
      else if (input.startsWith('=')) result = evaluate(parse(input.slice(1)), sheet);
      else if (/^(TRUE|FALSE)$/i.test(input)) result = input.toUpperCase() === 'TRUE';
      else result = numericText(input) && (!Number.isInteger(Number(input)) || Number.isSafeInteger(Number(input)) || /e/i.test(input)) ? Number(input) : input;
      if (typeof result === 'number' && !Number.isFinite(result)) fail('#NUM!');
      cache.set(key, result); return result;
    } finally { stack.delete(key); }
  }
  function evaluate(ast, currentSheet) {
    const result = evaluateAst(ast, currentSheet);
    if (flat(result).some((value) => typeof value === 'number' && !Number.isFinite(value))) fail('#NUM!');
    return result;
  }
  function evaluateAst(ast, currentSheet) {
    if (ast.kind === 'literal') return ast.value;
    if (ast.kind === 'error') fail(ast.value);
    if (ast.kind === 'name') {
      const named = (workbook.namedRanges || []).find((range) => range.name.toLowerCase() === ast.name.toLowerCase());
      if (!named) fail('#NAME?');
      const range = named.range; const value = evaluate({ kind: 'range', sheet: named.sheetId, start: cellKey(range.row, range.col), end: cellKey(range.endRow, range.endCol) }, currentSheet);
      return value.length === 1 && value[0].length === 1 ? value[0][0] : value;
    }
    if (ast.kind === 'ref') return scalar(read(ast.sheet ? resolveSheet(ast.sheet) : currentSheet, ast.reference));
    if (ast.kind === 'range') {
      const sheet = ast.sheet ? resolveSheet(ast.sheet) : currentSheet;
      const start = parseCell(ast.start); const end = parseCell(ast.end);
      const rows = Math.abs(end.row - start.row) + 1; const cols = Math.abs(end.col - start.col) + 1;
      if (rows * cols > 100000) fail('#NUM!');
      return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => scalar(read(sheet, cellKey(Math.min(start.row, end.row) + r, Math.min(start.col, end.col) + c)))));
    }
    if (ast.kind === 'unary') return (ast.op === '-' ? -1 : 1) * number(evaluate(ast.value, currentSheet));
    if (ast.kind === 'binary') {
      const left = evaluate(ast.left, currentSheet); const right = evaluate(ast.right, currentSheet);
      if (['=', '<>', '>', '<', '>=', '<='].includes(ast.op)) return compare(left, right, ast.op);
      if (ast.op === '&') return `${left ?? ''}${right ?? ''}`;
      const a = number(left); const b = number(right);
      if (ast.op === '+') return a + b; if (ast.op === '-') return a - b; if (ast.op === '*') return a * b;
      if (ast.op === '/') return b === 0 ? fail('#DIV/0!') : a / b;
      return a ** b;
    }
    if (ast.kind === 'call') {
      if (ast.name === 'IF') return truthy(evaluate(ast.args[0], currentSheet)) ? (ast.args[1] ? evaluate(ast.args[1], currentSheet) : true) : (ast.args[2] ? evaluate(ast.args[2], currentSheet) : false);
      if (ast.name === 'IFERROR') { try { return evaluate(ast.args[0], currentSheet); } catch (error) { if (error instanceof FormulaError) return ast.args[1] ? evaluate(ast.args[1], currentSheet) : ''; throw error; } }
      return callFunction(ast.name, ast.args.map((arg) => evaluate(arg, currentSheet)));
    }
    return fail('#ERROR!');
  }
  function prepareSpills() {
    const failures = [];
    for (const sheet of workbook.sheets) for (const [reference, cell] of Object.entries(sheet.cells || {})) {
      if (!String(cell.value).startsWith('=')) continue;
      try {
        const value = read(sheet, reference); if (!Array.isArray(value)) continue;
        const origin = parseCell(reference); const planned = [];
        for (let r = 0; r < value.length; r++) for (let c = 0; c < value[r].length; c++) {
          if (!r && !c) continue;
          const row = origin.row + r; const col = origin.col + c; const target = cellKey(row, col); const key = `${sheet.id}!${target}`;
          if (row >= 10000 || col >= 200 || sheet.cells[target]?.value || spills.has(key)) fail('#REF!');
          planned.push([key, value[r][c]]);
        }
        for (const [key, value] of planned) { spills.set(key, value); spillOrigins.set(key, reference); }
      } catch (error) { if (error instanceof FormulaError) failures.push([`${sheet.id}!${reference}`, error]); }
    }
    cache.clear(); for (const [key, error] of failures) cache.set(key, error);
  }
  return { read, evaluate, resolveSheet, prepareSpills, scalar, spillOrigins };
}
export function createCalculator(workbook) {
  const context = makeContext(workbook);
  context.prepareSpills();
  const calculate = (sheetId, reference) => {
    try { const result = context.scalar(context.read(context.resolveSheet(sheetId), reference.toUpperCase())); return result ?? ''; }
    catch (error) { return error instanceof FormulaError ? error.code : '#ERROR!'; }
  };
  calculate.spillOrigin = (sheetId, reference) => context.spillOrigins.get(`${sheetId}!${reference.toUpperCase()}`) || null;
  return calculate;
}
export const computeCell = (workbook, sheetId, reference) => createCalculator(workbook)(sheetId, reference);
export function evaluateFormula(formula, workbook, sheetId) {
  const context = makeContext(workbook);
  try { return context.evaluate(parse(formula.replace(/^=/, '')), context.resolveSheet(sheetId)); }
  catch (error) { return error instanceof FormulaError ? error.code : '#ERROR!'; }
}

// Move relative references when copying/filling a formula, preserving $ anchors and quoted text.
export function shiftFormulaReferences(formula, rowDelta, colDelta) {
  if (!String(formula).startsWith('=')) return formula;
  try {
    const tokens = tokenize(formula.slice(1)); let next = formula;
    for (let i = tokens.length - 2; i >= 0; i--) {
      const token = tokens[i]; const coordinate = token.type === 'identifier' ? parseCell(token.value) : null;
      if (!coordinate || tokens[i + 1]?.type === '!' || tokens[i + 1]?.type === '(') continue;
      const row = coordinate.row + (coordinate.absoluteRow ? 0 : rowDelta);
      const col = coordinate.col + (coordinate.absoluteCol ? 0 : colDelta);
      const replacement = row < 0 || col < 0 || row >= 10000 || col >= 200 ? '#REF!' : `${coordinate.absoluteCol ? '$' : ''}${columnName(col)}${coordinate.absoluteRow ? '$' : ''}${row + 1}`;
      next = next.slice(0, token.start + 1) + replacement + next.slice(token.end + 1);
    }
    return next;
  } catch { return formula; }
}

// A move relocates references to moved cells (including absolute references).
// Partial rectangular-range moves would require a union reference; reject them
// rather than silently changing the meaning of dependent formulas.
export function retargetMovedReferences(formula, { sourceSheet, sourceRange, targetSheet, targetRow, targetCol, currentSheet, movedFormula = false }) {
  if (!String(formula).startsWith('=')) return formula;
  const tokens=tokenize(formula.slice(1)),changes=[],inside=p=>p.row>=sourceRange.row&&p.row<=sourceRange.endRow&&p.col>=sourceRange.col&&p.col<=sourceRange.endCol;
  const quote=name=>`'${name.replaceAll("'","''")}'!`,encode=(p,moved)=>`${p.absoluteCol?'$':''}${columnName(p.col+(moved?targetCol-sourceRange.col:0))}${p.absoluteRow?'$':''}${p.row+1+(moved?targetRow-sourceRange.row:0)}`;
  for(let i=0;i<tokens.length-1;i++){
    const point=tokens[i].type==='identifier'?parseCell(tokens[i].value):null;
    if(!point||['!','('].includes(tokens[i+1]?.type)||tokens[i-1]?.type===':')continue;
    const explicit=tokens[i-1]?.type==='!',label=explicit?tokens[i-2].value:null,start=explicit?i-2:i;
    const refersSource=explicit?[sourceSheet.id,sourceSheet.name].some(n=>n.toLowerCase()===label.toLowerCase()):currentSheet.id===sourceSheet.id;
    let end=i,last=point;
    if(tokens[i+1]?.type===':'){last=parseCell(tokens[i+2]?.value||'');if(!last)throw new Error('This cut contains an unsupported qualified range. Move the whole referenced table instead.');end=i+2;}
    let moved=refersSource&&inside(point);
    if(end!==i&&refersSource){const intersects=Math.min(point.row,last.row)<=sourceRange.endRow&&Math.max(point.row,last.row)>=sourceRange.row&&Math.min(point.col,last.col)<=sourceRange.endCol&&Math.max(point.col,last.col)>=sourceRange.col;if(intersects&&!(inside(point)&&inside(last)))throw new Error('The cut moves only part of a formula range. Move the entire referenced range or copy instead.');moved=intersects;}
    const newContext=movedFormula?targetSheet:currentSheet;
    if(moved||movedFormula&&!explicit&&newContext.id!==currentSheet.id){const resolved=moved?targetSheet:currentSheet;const prefix=explicit||resolved.id!==newContext.id?quote(resolved.name):'';changes.push({start:tokens[start].start+1,end:tokens[end].end+1,value:prefix+encode(point,moved)+(end!==i?':'+encode(last,moved):'')});}
    i=end;
  }
  let result=formula;for(const change of changes.reverse())result=result.slice(0,change.start)+change.value+result.slice(change.end);return result;
}

export function transposeFormulaReferences(formula,sourceRow,sourceCol,targetRow,targetCol){
  if(!String(formula).startsWith('='))return formula;
  const tokens=tokenize(formula.slice(1));let result=formula;
  for(let i=tokens.length-2;i>=0;i--){const token=tokens[i],p=token.type==='identifier'?parseCell(token.value):null;if(!p||['!','('].includes(tokens[i+1]?.type))continue;const row=p.absoluteRow?p.row:targetRow+p.col-sourceCol,col=p.absoluteCol?p.col:targetCol+p.row-sourceRow;const value=row<0||col<0||row>=10000||col>=200?'#REF!':`${p.absoluteCol?'$':''}${columnName(col)}${p.absoluteRow?'$':''}${row+1}`;result=result.slice(0,token.start+1)+value+result.slice(token.end+1);}
  return result;
}

// Rename only parsed sheet-name tokens, leaving quoted text and other names intact.
export function renameSheetReferences(formula, oldName, newName) {
  if (!String(formula).startsWith('=')) return formula;
  try {
    const tokens = tokenize(formula.slice(1));
    const replacement = `'${String(newName).replaceAll("'", "''")}'`;
    let result = formula;
    for (let index = tokens.length - 2; index >= 0; index--) {
      const token = tokens[index];
      if (!['sheet', 'identifier'].includes(token.type) || tokens[index + 1]?.type !== '!' || token.value.toLowerCase() !== String(oldName).toLowerCase()) continue;
      result = result.slice(0, token.start + 1) + replacement + result.slice(token.end + 1);
    }
    return result;
  } catch { return formula; }
}

export function adjustWorkbookStructure(workbook, sheetId, axis, position, delta) {
  const target = workbook.sheets.find((sheet) => sheet.id === sheetId);
  const adjustFormula = (formula, currentSheet) => {
    if (!String(formula).startsWith('=')) return formula;
    try {
      const tokens = tokenize(formula.slice(1)); let next = formula;
      for (let i = tokens.length - 2; i >= 0; i--) {
        const token = tokens[i]; const coordinate = token.type === 'identifier' ? parseCell(token.value) : null;
        if (!coordinate || tokens[i + 1]?.type === '!' || tokens[i + 1]?.type === '(') continue;
        let namedSheet = null;
        if (tokens[i - 1]?.type === '!') namedSheet = tokens[i - 2]?.value;
        else if (tokens[i - 1]?.type === ':' && tokens[i - 3]?.type === '!') namedSheet = tokens[i - 4]?.value;
        const applies = namedSheet ? [target.id.toLowerCase(), target.name.toLowerCase()].includes(namedSheet.toLowerCase()) : currentSheet.id === sheetId;
        if (!applies) continue;
        const original = coordinate[axis === 'row' ? 'row' : 'col'];
        if (original < position) continue;
        let replacement;
        if (delta < 0 && original === position) {
          const counterpart = tokens[i + 1]?.type === ':' ? parseCell(tokens[i + 2]?.value || '') : tokens[i - 1]?.type === ':' ? parseCell(tokens[i - 2]?.value || '') : null;
          const other = counterpart?.[axis === 'row' ? 'row' : 'col'];
          if (other === undefined || other === position) replacement = '#REF!';
          else {
            coordinate[axis === 'row' ? 'row' : 'col'] = other > position ? position : position - 1;
            replacement = `${coordinate.absoluteCol ? '$' : ''}${columnName(coordinate.col)}${coordinate.absoluteRow ? '$' : ''}${coordinate.row + 1}`;
          }
        }
        else {
          coordinate[axis === 'row' ? 'row' : 'col'] += delta;
          replacement = `${coordinate.absoluteCol ? '$' : ''}${columnName(coordinate.col)}${coordinate.absoluteRow ? '$' : ''}${coordinate.row + 1}`;
        }
        next = next.slice(0, token.start + 1) + replacement + next.slice(token.end + 1);
      }
      return next;
    } catch { return formula; }
  };
  const adjustRange = (range) => {
    if (!range) return range;
    const startKey = axis === 'row' ? 'row' : 'col'; const endKey = axis === 'row' ? 'endRow' : 'endCol';
    let start = Math.min(range[startKey], range[endKey]); let end = Math.max(range[startKey], range[endKey]);
    if (delta > 0) { if (position <= start) { start += delta; end += delta; } else if (position <= end) end += delta; }
    else if (position < start) { start += delta; end += delta; }
    else if (position <= end) end += delta;
    return end < start ? null : { ...range, [startKey]: start, [endKey]: end };
  };
  return { ...workbook, namedRanges: (workbook.namedRanges || []).map((entry) => entry.sheetId === sheetId ? { ...entry, range: adjustRange(entry.range) } : entry).filter((entry) => entry.range), sheets: workbook.sheets.map((sheet) => {
    const cells = {};
    for (const [key, cell] of Object.entries(sheet.cells || {})) {
      const coordinate = parseCell(key); if (!coordinate) continue;
      if (sheet.id === sheetId) {
        const original = coordinate[axis === 'row' ? 'row' : 'col'];
        if (delta < 0 && original === position) continue;
        if (original >= position) coordinate[axis === 'row' ? 'row' : 'col'] += delta;
      }
      cells[cellKey(coordinate.row, coordinate.col)] = { ...cell, value: adjustFormula(cell.value, sheet) };
    }
    const columnWidths = {};
    for (const [key, width] of Object.entries(sheet.columnWidths || {})) { let col = Number(key); if (sheet.id === sheetId && axis === 'col' && col >= position) { if (delta < 0 && col === position) continue; col += delta; } columnWidths[col] = width; }
    const rangedChanges = {};
    if (sheet.id === sheetId) for (const key of ['charts', 'conditionalRules', 'validations', 'protectedRanges']) {
      if (Array.isArray(sheet[key])) rangedChanges[key] = sheet[key].map((entry) => ({ ...entry, range: adjustRange(entry.range) })).filter((entry) => entry.range);
    }
    if (sheet.id === sheetId) {
      rangedChanges.merges = (sheet.merges || []).map(adjustRange).filter(Boolean);
      const hiddenKey = axis === 'row' ? 'hiddenRows' : 'hiddenCols';
      rangedChanges[hiddenKey] = (sheet[hiddenKey] || []).filter((value) => !(delta < 0 && value === position)).map((value) => value >= position ? value + delta : value);
      if (axis === 'row') rangedChanges.rowHeights = Object.fromEntries(Object.entries(sheet.rowHeights || {}).filter(([row]) => !(delta < 0 && Number(row) === position)).map(([row,height]) => [Number(row) >= position ? Number(row) + delta : row,height]));
    }
    if (sheet.pivot?.sourceSheetId === sheetId) rangedChanges.pivot = { ...sheet.pivot, range: adjustRange(sheet.pivot.range) || { row: 0, col: 0, endRow: 0, endCol: 0 }, ...axis === 'col' ? { groupCol: sheet.pivot.groupCol >= position ? Math.max(0, sheet.pivot.groupCol + delta) : sheet.pivot.groupCol, valueCol: sheet.pivot.valueCol >= position ? Math.max(0, sheet.pivot.valueCol + delta) : sheet.pivot.valueCol } : {} };
    return { ...sheet, cells, columnWidths, ...rangedChanges };
  }) };
}
