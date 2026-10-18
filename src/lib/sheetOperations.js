import { cellKey, parseCell, createCalculator, shiftFormulaReferences, evaluateFormula } from './formulas.js';
import { parseCellInput } from './cellValues.js';

export function isProtected(sheet, reference) { return !!sheet.protected || (sheet.protectedRanges || []).some((entry) => inRange(reference, entry.range)); }
export function mergeCells(sheet, range, unmerge = false) {
  const overlaps = (a, b) => Math.min(a.row, a.endRow) <= Math.max(b.row, b.endRow) && Math.max(a.row, a.endRow) >= Math.min(b.row, b.endRow) && Math.min(a.col, a.endCol) <= Math.max(b.col, b.endCol) && Math.max(a.col, a.endCol) >= Math.min(b.col, b.endCol);
  if (unmerge) return { ...sheet, merges: (sheet.merges || []).filter((entry) => !overlaps(entry, range)) };
  if ((sheet.merges || []).some((entry) => overlaps(entry, range))) throw new Error('Unmerge existing cells in this range first.');
  if (range.row === range.endRow && range.col === range.endCol) throw new Error('Select more than one cell to merge.');
  return { ...sheet, merges: [...(sheet.merges || []), { row: Math.min(range.row, range.endRow), col: Math.min(range.col, range.endCol), endRow: Math.max(range.row, range.endRow), endCol: Math.max(range.col, range.endCol) }] };
}
export function fillSeries(sheet, range, direction = 'down', { seedRange, workbook } = {}) {
  if (!['down', 'right'].includes(direction)) throw new Error('Choose fill down or fill right.');
  const normalize = (value) => {
    if (!value || ![value.row, value.col, value.endRow, value.endCol].every(Number.isInteger)) throw new Error('Choose a valid fill range.');
    const result = { row: Math.min(value.row, value.endRow), col: Math.min(value.col, value.endCol), endRow: Math.max(value.row, value.endRow), endCol: Math.max(value.col, value.endCol) };
    if (result.row < 0 || result.col < 0 || result.endRow >= 10000 || result.endCol >= 200) throw new Error('Fill within 10,000 rows and 200 columns.');
    return result;
  };
  const target = normalize(range);
  if ((target.endRow - target.row + 1) * (target.endCol - target.col + 1) > 100000) throw new Error('Fill at most 100,000 cells at once.');
  const explicit = !!seedRange;
  const seed = explicit ? normalize(seedRange) : { ...target, endRow: direction === 'down' ? target.row : target.endRow, endCol: direction === 'right' ? target.col : target.endCol };
  if (seed.row < target.row || seed.col < target.col || seed.endRow > target.endRow || seed.endCol > target.endCol || seed.row !== target.row || seed.col !== target.col || direction === 'down' && seed.endCol !== target.endCol || direction === 'right' && seed.endRow !== target.endRow) throw new Error('The original seed range must start the filled range and cover its lanes.');
  if ((sheet.merges || []).some(merge => target.row <= merge.endRow && target.endRow >= merge.row && target.col <= merge.endCol && target.endCol >= merge.col)) throw new Error('Unmerge cells in this range before filling it.');
  const cells = { ...sheet.cells }, changed = [], calculate = createCalculator(workbook || { sheets: [sheet] });
  const seedCount = direction === 'down' ? seed.endRow - seed.row + 1 : seed.endCol - seed.col + 1;
  const numeric = value => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value));
  for (let row = target.row; row <= target.endRow; row++) for (let col = target.col; col <= target.endCol; col++) {
    const reference = cellKey(row, col), offset = direction === 'down' ? row - target.row : col - target.col;
    if (explicit && row >= seed.row && row <= seed.endRow && col >= seed.col && col <= seed.endCol) continue;
    if (isProtected(sheet, reference)) throw new Error('Unprotect this range before filling it.');
    const origin = calculate.spillOrigin(sheet.id, reference);
    if (origin) throw new Error(reference + ' belongs to the array in ' + origin + '. Edit or clear its source formula first.');
    const lane = direction === 'down' ? col : row;
    const at = (index) => direction === 'down' ? { row: seed.row + index, col: lane } : { row: lane, col: seed.col + index };
    const get = (index) => { const point = at(index); const source = sheet.cells?.[cellKey(point.row, point.col)] || { value: '' }; return { point, source, parsed: parseCellInput(source.value, source.format) }; };
    const first = get(0), second = get(explicit ? Math.min(1, seedCount - 1) : 1), last = get(seedCount - 1), previous = get(Math.max(0, seedCount - 2));
    const basis = explicit ? get(offset % seedCount) : first;
    let value = basis.parsed.value, format = basis.parsed.format;
    if (value.startsWith('=')) value = shiftFormulaReferences(value, row - basis.point.row, col - basis.point.col);
    else if (numeric(first.parsed.value)) {
      const a = explicit ? last : first, b = explicit ? previous : second;
      if (!numeric(a.parsed.value) || explicit && seedCount > 1 && !numeric(b.parsed.value)) throw new Error('Use matching numeric or date seed values for a numeric series.');
      const step = numeric(b.parsed.value) && (!explicit || seedCount > 1) ? explicit ? Number(a.parsed.value) - Number(b.parsed.value) : Number(b.parsed.value) - Number(a.parsed.value) : 1;
      const next = Number(a.parsed.value) + (explicit ? offset - seedCount + 1 : offset) * step;
      if (!Number.isFinite(next)) throw new Error('The filled value is outside the supported numeric range.');
      value = String(next);
      format = first.parsed.format;
    } else {
      const match = /^(.*?)(-?\d+)$/.exec(first.parsed.value);
      if (match && !first.parsed.value.startsWith("'")) {
        const a = explicit ? last : first, b = explicit ? previous : second;
        const lastMatch = /^(.*?)(-?\d+)$/.exec(a.parsed.value), secondMatch = /^(.*?)(-?\d+)$/.exec(b.parsed.value);
        if (lastMatch && lastMatch[1] === match[1]) {
          const step = secondMatch && secondMatch[1] === match[1] && (!explicit || seedCount > 1) ? explicit ? Number(lastMatch[2]) - Number(secondMatch[2]) : Number(secondMatch[2]) - Number(lastMatch[2]) : 1;
          const next = Number(lastMatch[2]) + (explicit ? offset - seedCount + 1 : offset) * step;
          if (!Number.isFinite(next)) throw new Error('The filled value is outside the supported numeric range.');
          value = match[1] + next;
        }
      } else if (!explicit) {
        const seeds = [], count = direction === 'down' ? target.endRow - target.row + 1 : target.endCol - target.col + 1;
        for (let index = 0; index < count; index++) { const item = get(index); if (item.source.value === '' || item.source.value === undefined) break; seeds.push(item); }
        if (seeds.length) { const item = seeds[offset % seeds.length]; value = item.parsed.value; format = item.parsed.format; }
      }
    }
    cells[reference] = { ...structuredClone(basis.source), value, ...(format ? { format: structuredClone(format) } : {}) };
    changed.push(reference);
  }
  if (Object.keys(cells).length > 100000) throw new Error('A worksheet can contain at most 100,000 populated cells.');
  const proposed={...sheet,cells},next=workbook?{...workbook,sheets:workbook.sheets.map(s=>s.id===sheet.id?proposed:s)}:{sheets:[proposed]};
  for(const reference of changed){const invalid=validationError(proposed,reference,cells[reference].value,next,{proposed:true});if(invalid)throw new Error(invalid);}
  return proposed;
}

export function inRange(reference, range) {
  const point = typeof reference === 'string' ? parseCell(reference) : reference;
  if (!point || !range) return false;
  return point.row >= Math.min(range.row, range.endRow) && point.row <= Math.max(range.row, range.endRow) && point.col >= Math.min(range.col, range.endCol) && point.col <= Math.max(range.col, range.endCol);
}
const formulaPasses = (book, sheet, reference, rule, formula) => { const p=parseCell(reference),r=rule.range;const result=evaluateFormula(shiftFormulaReferences(formula,p.row-r.row,p.col-r.col),book||{sheets:[sheet]},sheet.id);return result===true||typeof result==='number'&&result!==0; };
export function conditionalStyle(sheet, reference, value, workbook) {
  let result = {};
  for (const rule of sheet.conditionalRules || []) {
    if (!inRange(reference, rule.range)) continue;
    const numeric = typeof value === 'number' ? value : Number(String(value));
    const target = Number(rule.value);
    const matches = rule.type === 'formula' ? formulaPasses(workbook,sheet,reference,rule,rule.value) : rule.type === 'greater' ? value !== '' && Number.isFinite(numeric) && numeric > target
      : rule.type === 'less' ? value !== '' && Number.isFinite(numeric) && numeric < target
      : rule.type === 'equal' ? String(value).toLowerCase() === String(rule.value).toLowerCase()
      : rule.type === 'contains' ? String(value).toLowerCase().includes(String(rule.value).toLowerCase())
      : rule.type === 'notEmpty' ? value !== '' && value !== null
      : rule.type === 'empty' ? value === '' || value === null : false;
    if (matches) result = { ...result, ...rule.style };
  }
  return result;
}
export function validationFor(sheet, reference) { return (sheet.validations || []).find((rule) => inRange(reference, rule.range)); }
export function validationError(sheet, reference, value, workbook, { proposed = false } = {}) {
  if(value==='')return null;
  for(const rule of sheet.validations||[]){
    if(!rule.strict||!inRange(reference,rule.range))continue;
    if(rule.type==='formula'){const cells=proposed?sheet.cells:{...sheet.cells,[reference]:{...sheet.cells[reference],...parseCellInput(value,sheet.cells[reference]?.format)}};const candidate={...sheet,cells},book=workbook?{...workbook,sheets:workbook.sheets.map(s=>s.id===sheet.id?candidate:s)}:{sheets:[candidate]};if(!formulaPasses(book,candidate,reference,rule,rule.formula))return `${reference} does not satisfy the validation formula ${rule.formula}`;}
    else if(!rule.options?.includes(String(value)))return `${reference} must be one of: ${(rule.options||[]).join(', ')}`;
  }
  return null;
}
export function createPivotData(workbook, sourceSheetId, range, options) {
  const sheet = workbook.sheets.find((s) => s.id === sourceSheetId);
  if (!sheet) throw new Error('The source sheet no longer exists.');
  const top = Math.min(range.row, range.endRow); const bottom = Math.max(range.row, range.endRow); const left = Math.min(range.col, range.endCol); const right = Math.max(range.col, range.endCol);
  if (top === bottom) throw new Error('Select a header row and at least one data row.');
  const groupCols = [...new Set(options.groupCols?.length ? options.groupCols.map(Number) : [Number(options.groupCol)])]; const valueCol = Number(options.valueCol);
  const columnCol = options.columnCol === null || options.columnCol === undefined ? null : Number(options.columnCol);
  if ([...groupCols, valueCol, ...(columnCol === null ? [] : [columnCol])].some((c) => !Number.isInteger(c) || c < left || c > right)) throw new Error('Choose fields within the source range.');
  if (groupCols.length > 5) throw new Error('Use up to five grouping fields.');
  const aggregate = String(options.aggregate).toUpperCase();
  if (!['SUM','COUNT','AVERAGE','MIN','MAX'].includes(aggregate)) throw new Error('Choose a supported aggregation.');
  const calculate = createCalculator(workbook); const groups = new Map(); const columns = new Set(); const total = { numbers: [], count: 0 }; const columnTotals = new Map();
  const fresh = () => ({ numbers: [], count: 0 });
  const add = (bucket, value) => { if (value !== '') bucket.count++; if (typeof value === 'number' && Number.isFinite(value)) bucket.numbers.push(value); };
  const label = (value) => value === '' || value === null ? '(blank)' : String(value);
  for (let row = top + 1; row <= bottom; row++) {
    const labels = groupCols.map((col) => calculate(sheet.id, cellKey(row,col))); const value = calculate(sheet.id,cellKey(row,valueCol));
    if (labels.every((v) => v === '') && value === '') continue;
    const key = JSON.stringify(labels.map(label)); const column = columnCol === null ? '' : label(calculate(sheet.id,cellKey(row,columnCol))); columns.add(column);
    if (!groups.has(key)) groups.set(key, { labels: labels.map(label), buckets: new Map(), total: fresh() });
    const group = groups.get(key); if (!group.buckets.has(column)) group.buckets.set(column,fresh()); if (!columnTotals.has(column)) columnTotals.set(column,fresh());
    add(group.buckets.get(column),value); add(group.total,value); add(total,value); add(columnTotals.get(column),value);
  }
  const summarize = (bucket = fresh()) => aggregate === 'COUNT' ? bucket.count : aggregate === 'SUM' ? bucket.numbers.reduce((a,b) => a+b,0) : aggregate === 'AVERAGE' ? bucket.numbers.length ? bucket.numbers.reduce((a,b) => a+b,0)/bucket.numbers.length : 0 : aggregate === 'MIN' ? bucket.numbers.length ? Math.min(...bucket.numbers) : 0 : bucket.numbers.length ? Math.max(...bucket.numbers) : 0;
  const header = { bold:true,bg:'#e5efdf',color:'#2e613e' }; const numeric = {numberFormat:'number'}; const cells = {};
  const headings = groupCols.map((c) => String(calculate(sheet.id,cellKey(top,c)) || 'Group'));
  const columnKeys = [...columns].sort((a,b) => a.localeCompare(b,undefined,{numeric:true}));
  const title = aggregate + ' of ' + (calculate(sheet.id,cellKey(top,valueCol)) || 'Value');
  const outputHeaders = [...headings,...(columnCol === null ? [title] : [...columnKeys.map((key) => key + ' · ' + title),'Grand total'])];
  outputHeaders.forEach((value,col) => cells[cellKey(0,col)] = {value,format:header});
  let row = 1;
  for (const [,group] of [...groups].sort((a,b) => a[0].localeCompare(b[0],undefined,{numeric:true}))) {
    group.labels.forEach((value,col) => cells[cellKey(row,col)] = {value});
    const values = columnCol === null ? [summarize(group.total)] : [...columnKeys.map((key) => summarize(group.buckets.get(key))),summarize(group.total)];
    values.forEach((value,col) => cells[cellKey(row,groupCols.length+col)] = {value:String(value),format:numeric}); row++;
  }
  cells[cellKey(row,0)] = {value:'Grand total',format:header};
  const totals = columnCol === null ? [summarize(total)] : [...columnKeys.map((key) => summarize(columnTotals.get(key))),summarize(total)];
  totals.forEach((value,col) => cells[cellKey(row,groupCols.length+col)] = {value:String(value),format:{...header,...numeric}});
  return {cells,groupCount:groups.size,columnCount:columnKeys.length};
}
