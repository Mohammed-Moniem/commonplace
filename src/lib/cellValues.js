// Spreadsheet dates are civil calendar values. This epoch matches the existing
// formula engine (modern Excel/Sheets serials), without timezone-dependent parsing.
export const DAY_MILLISECONDS = 86400000;
export const SERIAL_EPOCH = Date.UTC(1899, 11, 30);
export const NUMBER_FORMATS = Object.freeze(['auto', 'text', 'number', 'currency', 'percent', 'date', 'time', 'datetime', 'scientific']);
export const DATE_FORMATS = Object.freeze(['iso', 'short', 'long']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthNumbers = new Map(MONTHS.flatMap((name, index) => [[name.toLowerCase(), index + 1], [name.slice(0, 3).toLowerCase(), index + 1]]));
monthNumbers.set('sept', 9);

/** Strict year/month/day to serial; impossible dates return null, never roll over. */
export function dateToSerial(year, month, day) {
  if (![year, month, day].every(Number.isInteger) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
  return (value.getTime() - SERIAL_EPOCH) / DAY_MILLISECONDS;
}

/** UTC Date for a serial, or null when it cannot be represented. */
export function serialToDate(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return null;
  const result = new Date(SERIAL_EPOCH + serial * DAY_MILLISECONDS);
  return Number.isFinite(result.getTime()) ? result : null;
}

/** Explicit ISO, US month/day/four-digit-year, or English month-name date. */
export function parseDateInput(raw) {
  const text = String(raw ?? '').trim();
  let match, year, month, day, dateFormat;
  if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text))) {
    [, year, month, day] = match; dateFormat = 'iso';
  } else if ((match = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/.exec(text))) {
    month = match[1]; day = match[3]; year = match[4]; dateFormat = 'short';
  } else if ((match = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)(\d{4})$/i.exec(text))) {
    month = monthNumbers.get(match[1].toLowerCase()); day = match[2]; year = match[3]; dateFormat = 'long';
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?(?:,\s*|\s+)(\d{4})$/i.exec(text))) {
    day = match[1]; month = monthNumbers.get(match[2].toLowerCase()); year = match[3]; dateFormat = 'long';
  } else return null;
  year = Number(year); month = Number(month); day = Number(day);
  const serial = dateToSerial(year, month, day);
  return serial === null ? null : { serial, year, month, day, dateFormat };
}

/** A strict 24-hour time or 12-hour AM/PM time. Returns a fraction of one day. */
export function parseTimeInput(raw) {
  const text = String(raw ?? '').trim();
  const match = /^(\d{1,2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?\s*(AM|PM)?$/i.exec(text);
  if (!match || !match[2] && !match[5]) return null;
  let hour = Number(match[1]); const minute = Number(match[2] ?? 0), second = Number(match[3] ?? 0), millisecond = Number((match[4] ?? '').padEnd(3, '0'));
  if (minute > 59 || second > 59 || (match[5] ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (match[5]) hour = hour % 12 + (match[5].toUpperCase() === 'PM' ? 12 : 0);
  return { fraction: (hour * 3600000 + minute * 60000 + second * 1000 + millisecond) / DAY_MILLISECONDS, hour, minute, second, millisecond };
}

export function parseDateTimeInput(raw) {
  const match = /^(.+?)[T ](\d{1,2}(?::\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?\s*(?:AM|PM)?)$/i.exec(String(raw ?? '').trim());
  if (!match) return null;
  const date = parseDateInput(match[1]), time = parseTimeInput(match[2]);
  return date && time ? { ...date, ...time, serial: date.serial + time.fraction } : null;
}

function parseNumberInput(input) {
  let text = input.trim(), negative = false, numberFormat;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1).trim(); }
  if (/%$/.test(text)) { numberFormat = 'percent'; text = text.slice(0, -1).trim(); }
  // The current workbook currency format is USD; other currency symbols stay
  // literal rather than being silently relabelled as dollars.
  if (/^[+-]?\s*(?:\$|USD\s)/i.test(text) || /\sUSD$/i.test(text)) {
    if (numberFormat) return null;
    numberFormat = 'currency';
    text = text.replace(/^([+-]?)\s*(?:\$|USD\s*)\s*/i, '$1').replace(/\s+USD$/i, '').trim();
  }
  if (negative && /^[+-]/.test(text)) return null;
  if (!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const value = Number(text.replaceAll(',', '')) * (negative ? -1 : 1) / (numberFormat === 'percent' ? 100 : 1);
  if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value) && !/[eE]/.test(text)) return null;
  return { value: String(Object.is(value, -0) ? 0 : value), numberFormat };
}

/** Convert an entered value while preserving formatting and explicit literals. */
export function parseCellInput(raw, existingFormat = {}) {
  const original = String(raw ?? '');
  const format = existingFormat && typeof existingFormat === 'object' && !Array.isArray(existingFormat) ? { ...existingFormat } : {};
  const result = (value, inferred = {}) => {
    const merged = { ...format, ...inferred };
    return { value, ...(Object.keys(merged).length ? { format: merged } : {}) };
  };
  if (original.startsWith("'")) return result(original);
  if (format.numberFormat === 'text') return result(original ? "'" + original : '');
  if (original.startsWith('=') || !original.trim()) return result(original);
  const automatic = !format.numberFormat || format.numberFormat === 'auto';
  if (automatic || ['date', 'datetime'].includes(format.numberFormat)) {
    const dateTime = parseDateTimeInput(original);
    const date = dateTime ?? parseDateInput(original);
    if (date) return result(String(date.serial), {
      ...(automatic ? { numberFormat: dateTime ? 'datetime' : 'date' } : {}),
      dateFormat: DATE_FORMATS.includes(format.dateFormat) ? format.dateFormat : date.dateFormat,
    });
  }
  if (automatic || ['time', 'datetime'].includes(format.numberFormat)) {
    const time = parseTimeInput(original);
    if (time) return result(String(time.fraction), automatic ? { numberFormat: 'time' } : {});
  }
  const numeric = parseNumberInput(original);
  if (numeric) return result(numeric.value, automatic && numeric.numberFormat ? { numberFormat: numeric.numberFormat } : {});
  return result(original);
}

const precision = (format, fallback) => Number.isInteger(format.decimalPlaces) && format.decimalPlaces >= 0 && format.decimalPlaces <= 10 ? format.decimalPlaces : fallback;
function formatDate(value, format) {
  const date = serialToDate(Math.floor(value));
  if (!date) return String(value);
  const year = String(date.getUTCFullYear()).padStart(4, '0'), month = date.getUTCMonth() + 1, day = date.getUTCDate();
  if (format.dateFormat === 'iso') return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (format.dateFormat === 'long') return `${MONTHS[month - 1]} ${day}, ${year}`;
  return `${month}/${day}/${year}`;
}
function formatTime(value, format) {
  const places = precision(format, 0), factor = 10 ** places;
  const daySeconds = 86400;
  const seconds = Math.round(((value % 1 + 1) % 1) * daySeconds * factor) / factor % daySeconds;
  const hour = Math.floor(seconds / 3600), minute = Math.floor(seconds % 3600 / 60), remainder = seconds % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${remainder.toFixed(places).padStart(places ? places + 3 : 2, '0')}`;
}

/** Stable en-US display for a calculated value; date/time display is UTC/civil. */
export function formatCellValue(calculated, format = {}) {
  if (calculated == null) return '';
  if (format.numberFormat === 'text') return String(calculated);
  if (typeof calculated === 'boolean') return calculated ? 'TRUE' : 'FALSE';
  if (typeof calculated !== 'number') return String(calculated);
  if (!Number.isFinite(calculated)) return '#NUM!';
  if (format.numberFormat === 'date') return formatDate(calculated, format);
  if (format.numberFormat === 'time') return formatTime(calculated, format);
  if (format.numberFormat === 'datetime') return `${formatDate(calculated, format)} ${formatTime(calculated, format)}`;
  if (format.numberFormat === 'scientific') {
    return new Intl.NumberFormat('en-US', { notation: 'scientific', minimumFractionDigits: precision(format, 2), maximumFractionDigits: precision(format, 2) }).format(calculated)
      .replace(/E(-?)(\d+)$/, (_, minus, digits) => `E${minus || '+'}${digits.padStart(2, '0')}`);
  }
  const places = precision(format, null);
  if (format.numberFormat === 'currency') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: places ?? 2, maximumFractionDigits: places ?? 2 }).format(calculated);
  if (format.numberFormat === 'percent') return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: places ?? 0, maximumFractionDigits: places ?? 2 }).format(calculated);
  if (format.numberFormat === 'number' || places !== null) return new Intl.NumberFormat('en-US', { minimumFractionDigits: places ?? 2, maximumFractionDigits: places ?? 2 }).format(calculated);
  return Number.isInteger(calculated) ? String(calculated) : String(Number(calculated.toPrecision(12)));
}
