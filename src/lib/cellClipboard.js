/**
 * Parse clipboard/import CSV or TSV without stripping quotes from ordinary text.
 * Quotes open an enclosed field only at its beginning. Delimiters and line
 * breaks inside an enclosed field remain content; doubled quotes become one.
 * A final record terminator adds no phantom row, while real blank rows/fields
 * are retained. Malformed enclosed fields throw rather than silently lose data.
 */
export function parseDelimitedCells(input, separator = ',') {
  if (typeof separator !== 'string' || separator.length !== 1 || /["\r\n]/.test(separator)) throw new Error('Choose a single delimiter such as a comma or tab.');
  const text = String(input ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false, started = false;
  const pushField = () => { row.push(field); field = ''; closed = false; started = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closed = true; }
      } else field += char;
      continue;
    }
    if (char === separator) { pushField(); continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      pushRow(); continue;
    }
    if (closed) throw new Error('Unexpected text after a quoted cell. Separate cells with the selected delimiter.');
    if (char === '"' && !started && field === '') { quoted = true; started = true; }
    else { field += char; started = true; }
  }
  if (quoted) throw new Error('The pasted text contains an unclosed quoted cell.');
  if (started || field !== '' || row.length) { pushField(); rows.push(row); }
  return rows;
}
