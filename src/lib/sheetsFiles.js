import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { createCalculator, parseCell, cellKey, columnName, shiftFormulaReferences, renameSheetReferences } from './formulas.js';
import { parseCellInput } from './cellValues.js';

const escapeXml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const decodeXml = (value) => String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity] ?? String.fromCodePoint(entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10))));
const attrs = (text) => Object.fromEntries([...text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1], decodeXml(m[2] ?? m[3])]));
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:\\w+:)?${name}\\s*>)`, 'g'))].map((m) => ({ attributes: attrs(m[1]), inner: m[2] || '', source: m[0] }));
const textTags = (xml) => tags(xml, 't').map((item) => decodeXml(item.inner)).join('');
const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const mainNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const color = (value) => value?.replace('#', '').toUpperCase().padStart(8, 'F');
const precision = (format, fallback) => Number.isInteger(format.decimalPlaces) && format.decimalPlaces >= 0 && format.decimalPlaces <= 10 ? format.decimalPlaces : fallback;
function nativeFormatCode(format) {
  const decimals = (fallback) => { const count = precision(format, fallback); return count ? '.' + '0'.repeat(count) : ''; };
  const date = { iso: 'yyyy-mm-dd', short: 'm/d/yyyy', long: 'mmmm d, yyyy' }[format.dateFormat] || 'm/d/yyyy';
  if (format.numberFormat === 'text') return '@';
  if (format.numberFormat === 'date') return date;
  if (format.numberFormat === 'time') return 'hh:mm:ss' + decimals(0);
  if (format.numberFormat === 'datetime') return date + ' hh:mm:ss' + decimals(0);
  if (format.numberFormat === 'currency') return '"$"#,##0' + decimals(2);
  if (format.numberFormat === 'percent') return '0' + (precision(format, null) === null ? '.##' : decimals(0)) + '%';
  if (format.numberFormat === 'scientific') return '0' + decimals(2) + 'E+00';
  if (format.numberFormat === 'number' || precision(format, null) !== null) return '#,##0' + decimals(2);
  return 'General';
}
const rangeRef = (range) => `${cellKey(Math.min(range.row, range.endRow), Math.min(range.col, range.endCol))}:${cellKey(Math.max(range.row, range.endRow), Math.max(range.col, range.endCol))}`;

export function exportXlsx(workbook) {
  const usedNames = new Set();
  const sheetNames = workbook.sheets.map((sheet, index) => {
    const base = String(sheet.name).replace(/[\\/*?:\[\]]/g, ' ').replace(/^'+|'+$/g, '').slice(0, 31) || `Sheet ${index + 1}`;
    let candidate = base; let suffix = 2;
    while (usedNames.has(candidate.toLowerCase())) { const ending = ` (${suffix++})`; candidate = `${base.slice(0, 31 - ending.length)}${ending}`; }
    usedNames.add(candidate.toLowerCase()); return candidate;
  });
  const renames = workbook.sheets.map((sheet, index) => ({ old: sheet.name, next: sheetNames[index], temporary: `__commonplace_export_${index}_${Date.now()}` })).filter((mapping) => mapping.old !== mapping.next);
  workbook = { ...workbook, sheets: workbook.sheets.map((sheet, index) => ({ ...sheet, name: sheetNames[index], cells: Object.fromEntries(Object.entries(sheet.cells || {}).map(([key, cell]) => { let value = cell.value; if (cell.format?.numberFormat !== 'text') { for (const mapping of renames) value = renameSheetReferences(value, mapping.old, mapping.temporary); for (const mapping of renames) value = renameSheetReferences(value, mapping.temporary, mapping.next); } return [key, { ...cell, ...parseCellInput(value, cell.format) }]; })) })) };
  const calculate = createCalculator(workbook); const files = {};
  const formats = [{}]; const formatIndices = new Map([['{}', 0]]);
  for (const sheet of workbook.sheets) for (const cell of Object.values(sheet.cells || {})) { const format = cell.format || {}; const key = JSON.stringify(format); if (!formatIndices.has(key)) { formatIndices.set(key, formats.length); formats.push(format); } }
  const fonts = formats.map((f) => `<font><sz val="${f.fontSize || 11}"/><name val="${escapeXml(f.fontFamily || 'Arial')}"/>${f.bold ? '<b/>' : ''}${f.italic ? '<i/>' : ''}${f.underline ? '<u/>' : ''}<color rgb="${color(f.color || '#26372d')}"/></font>`);
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', ...formats.map((f) => `<fill><patternFill patternType="solid"><fgColor rgb="${color(f.bg || '#ffffff')}"/><bgColor indexed="64"/></patternFill></fill>`)];
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>', ...formats.map((f) => `<border>${['left','right','top','bottom'].map((side) => f.borders?.[side] ? `<${side} style="${f.borders[side].style === 'solid' ? f.borders[side].width > 1 ? 'medium' : 'thin' : f.borders[side].style}"><color rgb="${color(f.borders[side].color)}"/></${side}>` : `<${side}/>`).join('')}<diagonal/></border>`)];
  const numberCodes = [...new Set(formats.map(nativeFormatCode).filter((code) => !['General', '@'].includes(code)))];
  const numberIds = new Map(numberCodes.map((code, index) => [code, 164 + index]));
  const styles = formats.map((f, i) => { const code = nativeFormatCode(f); const id = code === '@' ? 49 : numberIds.get(code) || 0; return `<xf numFmtId="${id}" fontId="${i}" fillId="${f.bg ? i + 2 : 0}" borderId="${i + 1}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${f.align || 'general'}" wrapText="${f.wrap ? 1 : 0}"/></xf>`; });
  const differential = workbook.sheets.flatMap((s) => s.conditionalRules || []);
  const dxfs = differential.map((r) => `<dxf><font><color rgb="${color(r.style?.color || '#26372d')}"/></font><fill><patternFill patternType="solid"><fgColor rgb="${color(r.style?.bg || '#e0efdc')}"/><bgColor indexed="64"/></patternFill></fill></dxf>`);
  files['xl/styles.xml'] = header + `<styleSheet xmlns="${mainNs}"><numFmts count="${numberCodes.length}">${numberCodes.map((code) => `<numFmt numFmtId="${numberIds.get(code)}" formatCode="${escapeXml(code)}"/>`).join('')}</numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styles.length}">${styles.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${dxfs.length}">${dxfs.join('')}</dxfs></styleSheet>`;
  const sheets = workbook.sheets.map((sheet, index) => {
    const name = sheet.name;
    const rows = new Map(); let maxRow = 0; let maxCol = 0;
    for (const [reference, cell] of Object.entries(sheet.cells || {})) {
      const coordinate = parseCell(reference); if (!coordinate) continue;
      maxRow = Math.max(maxRow, coordinate.row); maxCol = Math.max(maxCol, coordinate.col);
      const style = formatIndices.get(JSON.stringify(cell.format || {})) || 0;
      const raw = String(cell.value ?? ''); const result = calculate(sheet.id, reference);
      let xml;
      if (raw.startsWith('=')) {
        const type = typeof result === 'boolean' ? 'b' : typeof result === 'number' ? 'n' : /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!)/.test(result) ? 'e' : 'str';
        xml = `<c r="${reference}" s="${style}" t="${type}"><f>${escapeXml(raw.slice(1))}</f><v>${escapeXml(typeof result === 'boolean' ? Number(result) : result)}</v></c>`;
      } else if (raw !== '' && !raw.startsWith("'") && Number.isFinite(Number(raw))) xml = `<c r="${reference}" s="${style}"><v>${Number(raw)}</v></c>`;
      else if (/^(TRUE|FALSE)$/i.test(raw)) xml = `<c r="${reference}" s="${style}" t="b"><v>${Number(raw.toUpperCase() === 'TRUE')}</v></c>`;
      else xml = `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(raw.startsWith("'") ? raw.slice(1) : raw)}</t></is></c>`;
      if (!rows.has(coordinate.row)) rows.set(coordinate.row, []);
      rows.get(coordinate.row).push({ col: coordinate.col, xml });
    }
    for (const row of [...Object.keys(sheet.rowHeights || {}).map(Number), ...(sheet.hiddenRows || [])]) if (!rows.has(row)) rows.set(row, []);
    const columns = Object.entries({ ...Object.fromEntries((sheet.hiddenCols || []).map((c) => [c, 112])), ...sheet.columnWidths }).map(([col, width]) => `<col min="${Number(col) + 1}" max="${Number(col) + 1}" width="${Math.max(1, (width - 5) / 7).toFixed(2)}" customWidth="1" hidden="${(sheet.hiddenCols || []).includes(Number(col)) ? 1 : 0}"/>`).join('');
    const merges = (sheet.merges || []).length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((r) => `<mergeCell ref="${rangeRef(r)}"/>`).join('')}</mergeCells>` : '';
    const validations = (sheet.validations || []).flatMap((r) => r.type === 'formula' ? [`<dataValidation type="custom" allowBlank="1" showErrorMessage="${r.strict ? 1 : 0}" errorStyle="stop" sqref="${rangeRef(r.range)}"><formula1>${escapeXml(r.formula.replace(/^=/,''))}</formula1></dataValidation>`] : r.options.join(',').length < 254 && r.options.every(v=>!/[",]/.test(v)) ? [`<dataValidation type="list" allowBlank="1" showErrorMessage="${r.strict ? 1 : 0}" errorStyle="stop" sqref="${rangeRef(r.range)}"><formula1>&quot;${escapeXml(r.options.join(','))}&quot;</formula1></dataValidation>`] : []);
    const rules = (sheet.conditionalRules || []).map((r) => { const cell = cellKey(r.range.row,r.range.col); const text = String(r.value).replaceAll('"','""'); const formula = r.type === 'formula' ? r.value.replace(/^=/,'') : r.type === 'contains' ? `NOT(ISERROR(SEARCH("${text}",${cell})))` : r.type === 'empty' ? `LEN(TRIM(${cell}))=0` : r.type === 'notEmpty' ? `LEN(TRIM(${cell}))>0` : Number.isFinite(Number(r.value)) ? r.value : `"${text}"`; return `<conditionalFormatting sqref="${rangeRef(r.range)}"><cfRule type="${['contains','empty','notEmpty','formula'].includes(r.type) ? 'expression' : 'cellIs'}" ${['greater','less','equal'].includes(r.type) ? `operator="${{greater:'greaterThan',less:'lessThan',equal:'equal'}[r.type]}"` : ''} dxfId="${differential.indexOf(r)}" priority="${differential.indexOf(r)+1}"><formula>${escapeXml(formula)}</formula></cfRule></conditionalFormatting>`; }).join('');
    files[`xl/worksheets/sheet${index + 1}.xml`] = header + `<worksheet xmlns="${mainNs}"><dimension ref="A1:${cellKey(maxRow, maxCol)}"/><sheetViews><sheetView workbookViewId="0">${sheet.frozenRows || sheet.frozenCols ? `<pane ySplit="${sheet.frozenRows || 0}" xSplit="${sheet.frozenCols || 0}" topLeftCell="${cellKey(sheet.frozenRows || 0, sheet.frozenCols || 0)}" activePane="${sheet.frozenRows && sheet.frozenCols ? 'bottomRight' : sheet.frozenCols ? 'topRight' : 'bottomLeft'}" state="frozen"/>` : ''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/>${columns ? `<cols>${columns}</cols>` : ''}<sheetData>${[...rows].sort((a, b) => a[0] - b[0]).map(([row, cells]) => `<row r="${row + 1}"${sheet.rowHeights?.[row] ? ` ht="${sheet.rowHeights[row] * 0.75}" customHeight="1"` : ''}${(sheet.hiddenRows || []).includes(row) ? ' hidden="1"' : ''}>${cells.sort((a, b) => a.col - b.col).map((c) => c.xml).join('')}</row>`).join('')}</sheetData>${sheet.protected ? '<sheetProtection sheet="1" objects="1" scenarios="1"/>' : ''}${merges}${rules}${validations.length ? `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>` : ''}</worksheet>`;
    return `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`;
  });
  const definedNames = (workbook.namedRanges || []).map((r) => { const target = workbook.sheets.find((s) => s.id === r.sheetId); const absolute = rangeRef(r.range).split(':').map((ref) => { const point = parseCell(ref); return String.fromCharCode(36) + columnName(point.col) + String.fromCharCode(36) + (point.row + 1); }).join(':'); return target ? `<definedName name="${escapeXml(r.name)}">${escapeXml("'" + target.name.replaceAll("'","''") + "'!" + absolute)}</definedName>` : ''; }).join('');
  files['xl/workbook.xml'] = header + `<workbook xmlns="${mainNs}" xmlns:r="${relNs}"><bookViews><workbookView activeTab="${Math.max(0, workbook.sheets.findIndex((s) => s.id === workbook.activeSheetId))}"/></bookViews><sheets>${sheets.join('')}</sheets>${definedNames ? `<definedNames>${definedNames}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = header + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbook.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${relNs}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="${relNs}/styles" Target="styles.xml"/></Relationships>`;
  files['_rels/.rels'] = header + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relNs}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  files['[Content_Types].xml'] = header + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${workbook.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const metadataSheets = workbook.sheets.map(sheet => {
    const result = Object.fromEntries(['id','charts','conditionalRules','validations','pivot','protectedRanges','protected','merges','rowHeights','hiddenRows','hiddenCols','frozenCols','filterState','filterViews','tabColor'].filter(key=>sheet[key]!==undefined).map(key=>[key,sheet[key]]));
    result.cellExtras = Object.fromEntries(Object.entries(sheet.cells).filter(([,cell])=>cell.checkbox!==undefined||cell.note||cell.link).map(([key,cell])=>[key,Object.fromEntries(['checkbox','note','link'].filter(field=>cell[field]!==undefined).map(field=>[field,cell[field]]))]));
    return result;
  });
  files['commonplace/workbook.json'] = JSON.stringify({ namedRanges:workbook.namedRanges||[], sheets:metadataSheets });
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, source]) => [name, strToU8(source)])), { level: 6 });
}

const builtinNumberCodes = { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 5: '"$"#,##0', 6: '"$"#,##0', 7: '"$"#,##0.00', 8: '"$"#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm', 37: '#,##0', 38: '#,##0', 39: '#,##0.00', 40: '#,##0.00', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@' };
function interpretedNumberFormat(id, customFormats) {
  const code = customFormats[id] ?? builtinNumberCodes[id] ?? 'General';
  // Quoted literal words, escaped characters and color/locale sections are not
  // date tokens. Retain elapsed-time brackets for classification only.
  const bare = code.split(';')[0].replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[([^\]]*)\]/g, (_, value) => /^[hms]+$/i.test(value) ? value : '');
  const scientific = /[eE][+-]?0/.test(bare), hasTime = /[hs]/i.test(bare), hasDate = /[yd]/i.test(bare) || /m/i.test(bare) && !hasTime;
  const numberFormat = code === '@' ? 'text' : scientific ? 'scientific' : /%/.test(bare) ? 'percent' : hasDate && hasTime ? 'datetime' : hasDate ? 'date' : hasTime ? 'time' : /[$€£¥]/.test(code) ? 'currency' : /[0#?]/.test(bare) ? 'number' : 'auto';
  const result = { numberFormat };
  if (numberFormat === 'date' || numberFormat === 'datetime') result.dateFormat = /y+-m+-d+/i.test(bare) ? 'iso' : /mmmm/i.test(bare) ? 'long' : 'short';
  if (['number', 'currency', 'percent', 'scientific', 'time', 'datetime'].includes(numberFormat)) {
    const fraction = /\.([0#?]+)/.exec(bare)?.[1];
    if (!fraction || /^0+$/.test(fraction)) result.decimalPlaces = Math.min(10, fraction?.length || 0);
  }
  return result;
}
function importStyles(xml) {
  const fonts = tags(tags(xml, 'fonts')[0]?.inner || '', 'font').map((font) => ({ bold: /<(?:\w+:)?b\b/.test(font.inner), italic: /<(?:\w+:)?i\b/.test(font.inner), underline: /<(?:\w+:)?u\b/.test(font.inner), fontSize: Number(tags(font.inner, 'sz')[0]?.attributes.val || 11), fontFamily: tags(font.inner, 'name')[0]?.attributes.val || 'Arial', color: tags(font.inner, 'color')[0]?.attributes.rgb ? '#' + tags(font.inner, 'color')[0].attributes.rgb.slice(-6) : undefined }));
  const fills = tags(tags(xml, 'fills')[0]?.inner || '', 'fill').map((fill) => tags(fill.inner, 'fgColor')[0]?.attributes.rgb);
  const customFormats = Object.fromEntries(tags(xml, 'numFmt').map((f) => [f.attributes.numFmtId, f.attributes.formatCode]));
  const borders = tags(tags(xml, 'borders')[0]?.inner || '', 'border').map((border) => Object.fromEntries(['left','right','top','bottom'].map((side) => { const edge = tags(border.inner,side)[0]; return edge?.attributes.style ? [side, { color: '#' + (tags(edge.inner,'color')[0]?.attributes.rgb || 'FF999999').slice(-6), width: edge.attributes.style === 'medium' ? 2 : 1, style: ['dashed','dotted'].includes(edge.attributes.style) ? edge.attributes.style : 'solid' }] : null; }).filter(Boolean)));
  return tags(tags(xml, 'cellXfs')[0]?.inner || '', 'xf').map((xf) => {
    const id = Number(xf.attributes.numFmtId || 0);
    const fill = fills[Number(xf.attributes.fillId || 0)];
    return { ...fonts[Number(xf.attributes.fontId || 0)], ...(fill ? { bg: '#' + fill.slice(-6) } : {}), borders: borders[Number(xf.attributes.borderId || 0)] || {}, wrap: tags(xf.inner,'alignment')[0]?.attributes.wrapText === '1', align: tags(xf.inner, 'alignment')[0]?.attributes.horizontal || undefined, ...interpretedNumberFormat(id, customFormats) };
  });
}
export function importXlsx(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > 25 * 1024 * 1024) throw new Error('Workbook exceeds the 25 MB import limit.');
  let total = 0;
  const entries = unzipSync(bytes, { filter: (entry) => { total += entry.originalSize; if (total > 64 * 1024 * 1024 || entry.originalSize > 32 * 1024 * 1024) throw new Error('Workbook expands beyond the import limit.'); return /\.xml$|\.rels$/i.test(entry.name) || entry.name === 'commonplace/workbook.json'; } });
  const read = (path) => entries[path] ? strFromU8(entries[path]) : '';
  const workbookXml = read('xl/workbook.xml'); if (!workbookXml) throw new Error('This file is not a supported XLSX workbook.');
  const relationships = tags(read('xl/_rels/workbook.xml.rels'), 'Relationship');
  const resolve = (target) => { const components = (target.startsWith('/') ? target.slice(1) : `xl/${target}`).split('/'); const result = []; for (const part of components) { if (part === '..') result.pop(); else if (part && part !== '.') result.push(part); } return result.join('/'); };
  const related = (type, fallback) => resolve(relationships.find((r) => r.attributes.Type.endsWith(`/${type}`))?.attributes.Target || fallback);
  const sharedStrings = tags(read(related('sharedStrings', 'sharedStrings.xml')), 'si').map((item) => textTags(item.inner));
  const styles = importStyles(read(related('styles', 'styles.xml')));
  let count = 0;
  const sheets = tags(tags(workbookXml, 'sheets')[0]?.inner || '', 'sheet').slice(0, 100).map((item, index) => {
    const relationship = relationships.find((r) => r.attributes.Id === item.attributes['r:id']);
    const xml = read(resolve(relationship?.attributes.Target || `worksheets/sheet${index + 1}.xml`));
    const cells = {}; const sharedFormulas = new Map();
    for (const entry of tags(tags(xml, 'sheetData')[0]?.inner || '', 'c')) {
      if (++count > 100000) throw new Error('Workbook has more than 100,000 cells.');
      const reference = entry.attributes.r?.toUpperCase(); const coordinate = parseCell(reference || ''); if (!coordinate) continue;
      if (coordinate.row >= 10000 || coordinate.col >= 200) throw new Error('Workbook exceeds the local grid limit of 10,000 rows and 200 columns.');
      const raw = decodeXml(tags(entry.inner, 'v')[0]?.inner || ''); const type = entry.attributes.t; const formula = tags(entry.inner, 'f')[0]; let value;
      if (formula) {
        if (formula.inner) { value = '=' + decodeXml(formula.inner); if (formula.attributes.t === 'shared') sharedFormulas.set(formula.attributes.si, { reference, formula: value }); }
        else if (formula.attributes.t === 'shared' && sharedFormulas.has(formula.attributes.si)) { const source = sharedFormulas.get(formula.attributes.si); const origin = parseCell(source.reference); value = shiftFormulaReferences(source.formula, coordinate.row - origin.row, coordinate.col - origin.col); }
        else value = raw;
      } else if (type === 's') value = sharedStrings[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = textTags(tags(entry.inner, 'is')[0]?.inner || '');
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else value = raw;
      const format = styles[Number(entry.attributes.s || 0)];
      if (!formula && ['s', 'inlineStr', 'str'].includes(type)) {
        const literal = String(value);
        if (literal.startsWith("'") || literal.startsWith('=') || literal.trim() !== '' && Number.isFinite(Number(literal)) || /^(TRUE|FALSE)$/i.test(literal) || parseCellInput(literal, format).value !== literal) value = "'" + literal;
      }
      cells[reference] = { value, ...(format ? { format: Object.fromEntries(Object.entries(format).filter(([, v]) => v !== undefined && v !== false)) } : {}) };
    }
    const columnWidths = {}; const hiddenCols = [];
    for (const col of tags(tags(xml, 'cols')[0]?.inner || '', 'col')) { const start = Number(col.attributes.min) - 1; const end = Math.min(Number(col.attributes.max) - 1, 199); for (let i = start; i <= end; i++) { columnWidths[i] = Math.round(Number(col.attributes.width || 15) * 7 + 5); if (col.attributes.hidden === '1') hiddenCols.push(i); } }
    const pane = tags(xml, 'pane')[0]; const rowHeights = {}; const hiddenRows = [];
    for (const row of tags(tags(xml,'sheetData')[0]?.inner || '', 'row')) { const r = Number(row.attributes.r) - 1; if (r >= 0 && r < 10000) { if (row.attributes.ht) rowHeights[r] = Math.round(Number(row.attributes.ht) / 0.75); if (row.attributes.hidden === '1') hiddenRows.push(r); } }
    const merges = tags(xml,'mergeCell').map((entry) => { const parts = entry.attributes.ref?.split(':').map(parseCell); if (!parts?.[0] || !parts[1]) return null; return { row: parts[0].row, col: parts[0].col, endRow: parts[1].row, endCol: parts[1].col }; }).filter(Boolean);
    const validations = tags(xml,'dataValidation').filter((entry) => entry.attributes.type === 'list').flatMap((entry) => { const formula = decodeXml(tags(entry.inner,'formula1')[0]?.inner || ''); if (!formula.startsWith('"') || !formula.endsWith('"')) return []; return String(entry.attributes.sqref || '').split(' ').map((ref, n) => { const parts = ref.split(':').map(parseCell); if (!parts[0]) return null; const end = parts[1] || parts[0]; return { id: `validation-${index}-${n}-${ref}`, range: { row: parts[0].row, col: parts[0].col, endRow: end.row, endCol: end.col }, options: formula.slice(1,-1).split(','), strict: entry.attributes.showErrorMessage === '1' }; }).filter(Boolean); });
    return { id: `import-${index}-${Date.now()}`, name: item.attributes.name || `Sheet ${index + 1}`, cells, columnWidths, rowHeights, hiddenRows, hiddenCols, merges, validations, protected: tags(xml,'sheetProtection')[0]?.attributes.sheet === '1', frozenCols: pane?.attributes.state === 'frozen' ? Number(pane.attributes.xSplit || 0) : 0, frozenRows: pane?.attributes.state === 'frozen' ? Number(pane.attributes.ySplit || 0) : 0, charts: [] };
  });
  if (!sheets.length) throw new Error('The workbook contains no sheets.');
  let namedRanges = tags(workbookXml,'definedName').map((entry) => { const ref = decodeXml(entry.inner); const match = /^(?:'((?:[^']|'')+)'|([^!]+))!([$]?[A-Z]+[$]?[1-9]\d*)(?::([$]?[A-Z]+[$]?[1-9]\d*))?$/.exec(ref); if (!match) return null; const target = sheets.find((s) => s.name === (match[1]?.replaceAll("''","'") || match[2])); const start = parseCell(match[3]); const end = parseCell(match[4] || match[3]); return target ? { name: entry.attributes.name, sheetId: target.id, range: { row: start.row, col: start.col, endRow: end.row, endCol: end.col } } : null; }).filter(Boolean);
  if (entries['commonplace/workbook.json']) { try { const metadata = JSON.parse(strFromU8(entries['commonplace/workbook.json'])); if (Array.isArray(metadata.sheets)) metadata.sheets.forEach((value,index) => { if (sheets[index] && value && typeof value === 'object') for (const key of ['charts','conditionalRules','validations','pivot','protectedRanges','protected','merges','rowHeights','hiddenRows','hiddenCols','frozenCols','filterState','filterViews','tabColor']) if (value[key] !== undefined) sheets[index][key] = value[key]; }); for (let index=0;index<sheets.length;index++) for (const [key,extra] of Object.entries(metadata.sheets?.[index]?.cellExtras || {})) if (parseCell(key) && extra && typeof extra==='object') sheets[index].cells[key]={...sheets[index].cells[key],value:sheets[index].cells[key]?.value||'',...Object.fromEntries(Object.entries(extra).filter(([field,value])=>field==='checkbox'&&typeof value==='boolean'||field==='note'&&typeof value==='string'&&value.length<=10000||field==='link'&&typeof value==='string'&&/^(https?:\/\/|mailto:)[^\s<>]+$/i.test(value)))}; for (const target of sheets) if (target.pivot) { const originalIndex = metadata.sheets?.findIndex((s) => s.id === target.pivot.sourceSheetId); if (originalIndex >= 0 && sheets[originalIndex]) target.pivot.sourceSheetId = sheets[originalIndex].id; } } catch { /* Standard OOXML remains usable if optional metadata is invalid. */ } }
  const activeIndex = Number(tags(workbookXml, 'workbookView')[0]?.attributes.activeTab || 0);
  return { sheets, namedRanges, activeSheetId: sheets[activeIndex]?.id || sheets[0].id };
}
