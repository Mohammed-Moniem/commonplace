import { dateToSerial, parseDateInput, parseDateTimeInput, parseTimeInput } from './cellValues.js';
// Extra functions share the interpreter's coercion and error rules.
export function extendedFormula(name, args, { number, fail, compare, criteriaMatches }) {
  const flat = (v) => Array.isArray(v) ? v.flat(Infinity) : [v];
  const scalar = (v) => Array.isArray(v) ? v[0]?.[0] ?? '' : v;
  const num = (v) => number(scalar(v));
  const day = 86400000; const epoch = Date.UTC(1899, 11, 30);
  const date = (serial) => { const value = new Date(epoch + num(serial) * day); if (!Number.isFinite(value.getTime())) fail('#NUM!'); return value; };
  const serial = (value) => Math.floor((value.getTime() - epoch) / day);
  const arity = (min, max = min) => { if (args.length < min || args.length > max) fail('#VALUE!'); };
  if (name === 'DATEVALUE') { arity(1); const value = parseDateInput(scalar(args[0])) ?? parseDateTimeInput(scalar(args[0])); if (!value) fail('#VALUE!'); return Math.floor(value.serial); }
  if (name === 'TIMEVALUE') { arity(1); const value = parseTimeInput(scalar(args[0])) ?? parseDateTimeInput(scalar(args[0])); if (!value) fail('#VALUE!'); return value.fraction; }
  if (name === 'TIME') { arity(3); const parts = args.map((value) => Math.trunc(num(value))); if (parts.some((value) => value < 0)) fail('#NUM!'); return (parts[0] * 3600 + parts[1] * 60 + parts[2]) % 86400 / 86400; }
  if (['HOUR', 'MINUTE', 'SECOND'].includes(name)) { arity(1); const value = num(args[0]); if (value < 0) fail('#NUM!'); const seconds = Math.floor((value % 1) * 86400 + 0.000001); return name === 'HOUR' ? Math.floor(seconds / 3600) : name === 'MINUTE' ? Math.floor(seconds / 60) % 60 : seconds % 60; }
  if (name === 'NOW') { arity(0); const now = new Date(); return dateToSerial(now.getFullYear(), now.getMonth() + 1, now.getDate()) + (now.getHours() * 3600000 + now.getMinutes() * 60000 + now.getSeconds() * 1000 + now.getMilliseconds()) / day; }
  const vector = (v) => { if (!Array.isArray(v) || v.length > 1 && v.some((r) => r.length > 1)) fail('#VALUE!'); return flat(v); };
  const dates = ['DATE', 'YEAR', 'MONTH', 'DAY', 'EDATE', 'EOMONTH', 'DATEDIF', 'DAYS', 'WEEKDAY'];
  if (dates.includes(name)) {
    if (name === 'DATE') { arity(3); let year = Math.trunc(num(args[0])); if (year >= 0 && year < 1900) year += 1900; const value = new Date(0); value.setUTCFullYear(year, Math.trunc(num(args[1])) - 1, Math.trunc(num(args[2]))); value.setUTCHours(0, 0, 0, 0); return serial(value); }
    if (['YEAR', 'MONTH', 'DAY'].includes(name)) { arity(1); const value = date(args[0]); return name === 'YEAR' ? value.getUTCFullYear() : name === 'MONTH' ? value.getUTCMonth() + 1 : value.getUTCDate(); }
    if (name === 'EDATE' || name === 'EOMONTH') { arity(2); const value = date(args[0]); const month = value.getUTCMonth() + Math.trunc(num(args[1])); const last = new Date(Date.UTC(value.getUTCFullYear(), month + 1, 0)); return serial(new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), name === 'EOMONTH' ? last.getUTCDate() : Math.min(value.getUTCDate(), last.getUTCDate())))); }
    if (name === 'DAYS') { arity(2); return Math.floor(num(args[0])) - Math.floor(num(args[1])); }
    if (name === 'WEEKDAY') { arity(1, 2); const type = num(args[1] ?? 1); const value = date(args[0]).getUTCDay(); if (type === 1) return value + 1; if (type === 2) return (value + 6) % 7 + 1; if (type === 3) return (value + 6) % 7; fail('#NUM!'); }
    arity(3); const start = date(args[0]); const end = date(args[1]); if (start > end) fail('#NUM!'); const unit = String(args[2]).toUpperCase(); const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() - (end.getUTCDate() < start.getUTCDate() ? 1 : 0);
    if (unit === 'D') return serial(end) - serial(start); if (unit === 'M') return months; if (unit === 'Y') return Math.floor(months / 12); if (unit === 'YM') return months % 12; fail('#VALUE!');
  }
  if (['SUMIFS', 'COUNTIFS', 'AVERAGEIFS'].includes(name)) {
    const countOnly = name === 'COUNTIFS'; if (args.length < (countOnly ? 2 : 3) || args.length % 2 !== (countOnly ? 0 : 1)) fail('#VALUE!');
    const targets = countOnly ? flat(args[0]) : flat(args[0]); const start = countOnly ? 0 : 1; const pairs = [];
    for (let i = start; i < args.length; i += 2) { const values = flat(args[i]); if (values.length !== targets.length) fail('#VALUE!'); pairs.push([values, args[i + 1]]); }
    const matches = targets.filter((v, i) => pairs.every(([values, criterion]) => criteriaMatches(values[i], criterion)));
    if (countOnly) return matches.length; const nums = matches.filter((v) => typeof v === 'number'); if (name === 'AVERAGEIFS' && !nums.length) fail('#DIV/0!'); const sum = nums.reduce((a, b) => a + b, 0); return name === 'AVERAGEIFS' ? sum / nums.length : sum;
  }
  if (name === 'HLOOKUP') {
    arity(3, 4); const table = args[1]; if (!Array.isArray(table) || !table.every(Array.isArray)) fail('#VALUE!'); const row = num(args[2]); if (!Number.isInteger(row) || row < 1 || row > table.length) fail('#REF!'); const mode = num(args[3] ?? 1); if (![0, 1].includes(mode)) fail('#VALUE!'); let found = -1;
    for (let c = 0; c < table[0].length; c++) { if (compare(table[0][c], args[0], mode ? '<=' : '=')) { found = c; if (!mode) break; } else if (mode) break; }
    return found < 0 ? fail('#N/A') : table[row - 1][found] ?? 0;
  }
  if (name === 'XLOOKUP') {
    arity(3, 6); const keys = vector(args[1]); const results = vector(args[2]); if (keys.length !== results.length) fail('#VALUE!'); const mode = num(args[4] ?? 0); const search = num(args[5] ?? 1); if (![-1, 0, 1, 2].includes(mode) || ![-1, 1].includes(search)) fail('#VALUE!');
    let indices = keys.map((_, i) => i); if (search === -1) indices.reverse(); let found = indices.find((i) => mode === 2 ? criteriaMatches(keys[i], args[0]) : compare(keys[i], args[0], '='));
    if (found === undefined && [-1, 1].includes(mode)) for (const i of indices) if (compare(keys[i], args[0], mode === -1 ? '<' : '>') && (found === undefined || compare(keys[i], keys[found], mode === -1 ? '>' : '<'))) found = i;
    return found === undefined ? args.length >= 4 ? args[3] : fail('#N/A') : results[found];
  }
  if (name === 'REPLACE') { arity(4); const start = num(args[1]); const count = num(args[2]); if (start < 1 || count < 0) fail('#VALUE!'); return String(args[0]).slice(0, start - 1) + String(args[3]) + String(args[0]).slice(start - 1 + count); }
  if (name === 'FIND' || name === 'SEARCH') { arity(2, 3); const start = num(args[2] ?? 1); if (start < 1) fail('#VALUE!'); const source = String(args[1]); const query = String(args[0]); if (name === 'SEARCH' && /[*?~]/.test(query)) fail('#VALUE!'); const found = (name === 'SEARCH' ? source.toLowerCase() : source).indexOf(name === 'SEARCH' ? query.toLowerCase() : query, start - 1); return found < 0 ? fail('#VALUE!') : found + 1; }
  if (name === 'TEXT') {
    arity(2); const value = num(args[0]); const pattern = String(args[1]);
    if (/^(yyyy-mm-dd|dd\/mm\/yyyy|mm\/dd\/yyyy|mmm d, yyyy|yyyy|mmmm|mmm)$/i.test(pattern)) { const d = date(value); const y = String(d.getUTCFullYear()); const m = String(d.getUTCMonth() + 1).padStart(2, '0'); const day = String(d.getUTCDate()).padStart(2, '0'); const month = d.toLocaleString('en', { month: 'long', timeZone: 'UTC' }); return pattern.toLowerCase() === 'yyyy-mm-dd' ? `${y}-${m}-${day}` : pattern.toLowerCase() === 'dd/mm/yyyy' ? `${day}/${m}/${y}` : pattern.toLowerCase() === 'mm/dd/yyyy' ? `${m}/${day}/${y}` : pattern.toLowerCase() === 'yyyy' ? y : pattern.toLowerCase() === 'mmm' ? month.slice(0, 3) : pattern.toLowerCase() === 'mmmm' ? month : `${month.slice(0, 3)} ${Number(day)}, ${y}`; }
    if (!/^[0#,$.%]+$/.test(pattern)) fail('#VALUE!'); const digits = pattern.split('.')[1]?.replace(/[^0#]/g, '').length || 0; return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: pattern.includes(','), ...(pattern.includes('%') ? { style: 'percent' } : pattern.includes('$') ? { style: 'currency', currency: 'USD' } : {}) }).format(value);
  }
  if (name === 'SPLIT') { arity(2, 4); const delimiter = String(args[1]); if (!delimiter) fail('#VALUE!'); let parts; if (args[2] === false) parts = String(args[0]).split(delimiter); else { parts = ['']; for (const char of String(args[0])) { if (delimiter.includes(char)) parts.push(''); else parts[parts.length - 1] += char; } } return [args[3] === false ? parts : parts.filter((v) => v !== '')]; }
  if (name === 'SEQUENCE') { arity(1, 4); const rows = num(args[0]); const cols = num(args[1] ?? 1); if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows * cols > 100000) fail('#NUM!'); const start = num(args[2] ?? 1); const step = num(args[3] ?? 1); return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => start + (r * cols + c) * step)); }
  if (name === 'TRANSPOSE') { arity(1); const rows = Array.isArray(args[0]) ? args[0] : [[args[0]]]; return Array.from({ length: rows[0]?.length || 0 }, (_, c) => rows.map((r) => r[c] ?? null)); }
  if (name === 'UNIQUE') { arity(1); const rows = Array.isArray(args[0]) ? args[0] : [[args[0]]]; const seen = new Set(); return rows.filter((row) => { const key = JSON.stringify(row); if (seen.has(key)) return false; seen.add(key); return true; }); }
  return undefined;
}
