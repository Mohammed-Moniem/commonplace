// This catalog describes the local interpreter, including its deliberate limits.
// It is guidance for entering formulas; no formula text is executed here.
const entries = [
  ['ABS', 'ABS(value)', 'Return the absolute value of a number.', 'Math', '=ABS(-7)'],
  ['AND', 'AND(condition1, [condition2, ...])', 'TRUE when every condition is true.', 'Logical', '=AND(1<2,2<3)'],
  ['AVERAGE', 'AVERAGE(value1, [value2, ...])', 'Average numeric values; blank and text cells are ignored.', 'Statistical', '=AVERAGE(2,4,6)'],
  ['AVERAGEIF', 'AVERAGEIF(range, criterion, [average_range])', 'Average numbers whose matching cells meet one criterion.', 'Statistical', '=AVERAGEIF(A1:A3,">1",B1:B3)'],
  ['AVERAGEIFS', 'AVERAGEIFS(average_range, criteria_range1, criterion1, [criteria_range2, criterion2, ...])', 'Average numbers whose matching cells meet every criterion.', 'Statistical', '=AVERAGEIFS(B1:B3,A1:A3,">1")'],
  ['CONCAT', 'CONCAT(value1, [value2, ...])', 'Join values and ranges as text.', 'Text', '=CONCAT("Plan ",2026)'],
  ['CONCATENATE', 'CONCATENATE(value1, [value2, ...])', 'Join values and ranges as text.', 'Text', '=CONCATENATE("A","B")'],
  ['COUNT', 'COUNT(value1, [value2, ...])', 'Count numeric values, including numbers returned by formulas.', 'Statistical', '=COUNT(1,"text",3)'],
  ['COUNTA', 'COUNTA(value1, [value2, ...])', 'Count nonempty values.', 'Statistical', '=COUNTA("A","",3)'],
  ['COUNTBLANK', 'COUNTBLANK(range)', 'Count empty cells or empty text values.', 'Statistical', '=COUNTBLANK(A1:A4)'],
  ['COUNTIF', 'COUNTIF(range, criterion)', 'Count cells matching a numeric or text criterion.', 'Statistical', '=COUNTIF(A1:A3,">1")'],
  ['COUNTIFS', 'COUNTIFS(criteria_range1, criterion1, [criteria_range2, criterion2, ...])', 'Count cells meeting every criterion in equally sized ranges.', 'Statistical', '=COUNTIFS(A1:A3,">1",B1:B3,">15")'],
  ['DATE', 'DATE(year, month, day)', 'Build a spreadsheet date serial; month and day overflow normalize.', 'Date & time', '=DATE(2026,10,18)'],
  ['DATEDIF', 'DATEDIF(start_date, end_date, unit)', 'Count complete days, months, years or remaining months between dates.', 'Date & time', '=DATEDIF(DATE(2025,1,1),DATE(2026,1,1),"Y")', 'Supported units: D, M, Y and YM. Start must not be after end.'],
  ['DATEVALUE', 'DATEVALUE(date_text)', 'Convert a supported date string to a spreadsheet date serial.', 'Date & time', '=DATEVALUE("2026-10-18")', 'Accepts strict ISO, US dates with a four-digit year, and supported English month names; ambiguous short years are rejected.'],
  ['DAY', 'DAY(date)', 'Return the day of the month from a date serial.', 'Date & time', '=DAY(DATE(2026,10,18))'],
  ['DAYS', 'DAYS(end_date, start_date)', 'Subtract the starting date from the ending date, in days.', 'Date & time', '=DAYS(DATE(2026,10,18),DATE(2026,10,1))'],
  ['EDATE', 'EDATE(start_date, months)', 'Move a date by whole months, clamping to the destination month end.', 'Date & time', '=DAY(EDATE(DATE(2026,1,31),1))'],
  ['EOMONTH', 'EOMONTH(start_date, months)', 'Return the last day of a month, offset from the starting date.', 'Date & time', '=DAY(EOMONTH(DATE(2026,1,10),1))'],
  ['FIND', 'FIND(search_for, text_to_search, [starting_at])', 'Find the first case-sensitive text match; positions start at 1.', 'Text', '=FIND("b","abc")'],
  ['HLOOKUP', 'HLOOKUP(search_key, range, row_index, [is_sorted])', 'Find a key in the first row and return a value from another row.', 'Lookup', '=HLOOKUP(1,A1:C2,2,FALSE)', 'Defaults to approximate matching in ascending key order. Use FALSE for exact.'],
  ['HOUR', 'HOUR(time)', 'Return the hour component of a time serial.', 'Date & time', '=HOUR(TIME(14,30,0))'],
  ['IF', 'IF(condition, value_if_true, [value_if_false])', 'Choose a result from a condition; only the chosen branch is evaluated.', 'Logical', '=IF(2>1,"Yes","No")'],
  ['IFERROR', 'IFERROR(value, [value_if_error])', 'Return a fallback when a formula raises a spreadsheet error.', 'Logical', '=IFERROR(1/0,0)'],
  ['INDEX', 'INDEX(reference, row, [column])', 'Return one cell from a range using positions starting at 1.', 'Lookup', '=INDEX(A1:B3,2,2)'],
  ['INT', 'INT(value)', 'Round down to the nearest integer, including negative values.', 'Math', '=INT(-1.2)'],
  ['ISBLANK', 'ISBLANK(value)', 'Test whether a cell is blank or evaluates to empty text.', 'Logical', '=ISBLANK("")'],
  ['ISNUMBER', 'ISNUMBER(value)', 'Test whether a value is a number.', 'Logical', '=ISNUMBER(42)'],
  ['ISTEXT', 'ISTEXT(value)', 'Test whether a value is text.', 'Logical', '=ISTEXT("42")'],
  ['LEFT', 'LEFT(text, [number_of_characters])', 'Return characters from the start of text; default is one.', 'Text', '=LEFT("Monday",3)'],
  ['LEN', 'LEN(text)', 'Return the number of characters in text.', 'Text', '=LEN("Hello")'],
  ['LOWER', 'LOWER(text)', 'Convert text to lowercase.', 'Text', '=LOWER("HELLO")'],
  ['MATCH', 'MATCH(search_key, range, [search_type])', 'Return a key position in a single row or column.', 'Lookup', '=MATCH(2,A1:A3,0)', 'Use 0 for exact; default 1 expects ascending data; -1 expects descending data.'],
  ['MAX', 'MAX(value1, [value2, ...])', 'Return the largest numeric value.', 'Statistical', '=MAX(2,9,4)'],
  ['MID', 'MID(text, starting_at, extract_length)', 'Return a section of text; positions start at 1.', 'Text', '=MID("Monday",2,3)'],
  ['MIN', 'MIN(value1, [value2, ...])', 'Return the smallest numeric value.', 'Statistical', '=MIN(2,9,4)'],
  ['MINUTE', 'MINUTE(time)', 'Return the minute component of a time serial.', 'Date & time', '=MINUTE(TIME(14,30,0))'],
  ['MOD', 'MOD(dividend, divisor)', 'Return the remainder with the divisor\'s sign.', 'Math', '=MOD(7,3)'],
  ['MONTH', 'MONTH(date)', 'Return the month number from a date serial.', 'Date & time', '=MONTH(DATE(2026,10,18))'],
  ['NOT', 'NOT(condition)', 'Reverse a logical condition.', 'Logical', '=NOT(FALSE)'],
  ['NOW', 'NOW()', 'Return the current date and time as a spreadsheet serial.', 'Date & time', '=NOW()', 'Volatile on recalculation. Uses the local calendar/time represented by the browser; not a live ticking clock.'],
  ['OR', 'OR(condition1, [condition2, ...])', 'TRUE when any condition is true.', 'Logical', '=OR(FALSE,TRUE)'],
  ['POWER', 'POWER(base, exponent)', 'Raise a number to a power.', 'Math', '=POWER(2,3)'],
  ['REPLACE', 'REPLACE(text, position, length, new_text)', 'Replace a section of text using positions starting at 1.', 'Text', '=REPLACE("abcdef",2,3,"X")'],
  ['RIGHT', 'RIGHT(text, [number_of_characters])', 'Return characters from the end of text; default is one.', 'Text', '=RIGHT("Monday",3)'],
  ['ROUND', 'ROUND(value, [places])', 'Round a number to the requested decimal places.', 'Math', '=ROUND(1.256,2)'],
  ['ROUNDDOWN', 'ROUNDDOWN(value, [places])', 'Round a number toward zero.', 'Math', '=ROUNDDOWN(1.256,2)'],
  ['ROUNDUP', 'ROUNDUP(value, [places])', 'Round a number away from zero.', 'Math', '=ROUNDUP(1.251,2)'],
  ['SEARCH', 'SEARCH(search_for, text_to_search, [starting_at])', 'Find the first case-insensitive text match; positions start at 1.', 'Text', '=SEARCH("B","abc")', 'Wildcard search characters *, ? and ~ are not supported here.'],
  ['SECOND', 'SECOND(time)', 'Return the second component of a time serial.', 'Date & time', '=SECOND(TIME(14,30,45))'],
  ['SEQUENCE', 'SEQUENCE(rows, [columns], [start], [step])', 'Generate a numeric array that spills into empty neighboring cells.', 'Array', '=SEQUENCE(2,2,1,1)', 'At most 100,000 output cells; occupied destination cells produce #REF!.'],
  ['SPLIT', 'SPLIT(text, delimiter, [split_by_each], [remove_empty_text])', 'Split text into a row of values that spills into neighboring cells.', 'Array', '=SPLIT("red,blue",",")', 'By default each delimiter character splits and empty values are removed. Use FALSE options to change these defaults.'],
  ['SQRT', 'SQRT(value)', 'Return the square root of a nonnegative number.', 'Math', '=SQRT(9)'],
  ['SUBSTITUTE', 'SUBSTITUTE(text, search_for, replace_with, [occurrence_number])', 'Replace matching text everywhere, or at one occurrence.', 'Text', '=SUBSTITUTE("a-a","a","b",2)'],
  ['SUM', 'SUM(value1, [value2, ...])', 'Add numeric values; text and blank cells are ignored.', 'Math', '=SUM(2,4,6)'],
  ['SUMIF', 'SUMIF(range, criterion, [sum_range])', 'Add numbers whose matching cells meet one criterion.', 'Math', '=SUMIF(A1:A3,">1",B1:B3)'],
  ['SUMIFS', 'SUMIFS(sum_range, criteria_range1, criterion1, [criteria_range2, criterion2, ...])', 'Add numbers whose matching cells meet every criterion.', 'Math', '=SUMIFS(B1:B3,A1:A3,">1")'],
  ['TEXT', 'TEXT(number, format)', 'Format a number or date as text using supported patterns.', 'Text', '=TEXT(DATE(2026,10,18),"yyyy-mm-dd")', 'Supports numeric 0/#/$/%/grouping patterns and yyyy-mm-dd, dd/mm/yyyy, mm/dd/yyyy, mmm d, yyyy, yyyy, mmmm or mmm.'],
  ['TEXTJOIN', 'TEXTJOIN(delimiter, ignore_empty, text1, [text2, ...])', 'Join values using a delimiter and optionally skip blank values.', 'Text', '=TEXTJOIN("-",TRUE,"A","","B")'],
  ['TIME', 'TIME(hour, minute, second)', 'Build a fraction of a day from nonnegative time components.', 'Date & time', '=TIME(12,0,0)', 'Overflow normalizes within a day.'],
  ['TIMEVALUE', 'TIMEVALUE(time_text)', 'Convert supported 24-hour or AM/PM time text to a fraction of a day.', 'Date & time', '=TIMEVALUE("12:00 PM")'],
  ['TODAY', 'TODAY()', 'Return today\'s date as a spreadsheet serial.', 'Date & time', '=TODAY()', 'Volatile on recalculation; not a live ticking clock.'],
  ['TRANSPOSE', 'TRANSPOSE(range)', 'Swap the rows and columns of a range as a spilling array.', 'Array', '=TRANSPOSE(A1:B2)'],
  ['TRIM', 'TRIM(text)', 'Remove outside whitespace and collapse repeated whitespace.', 'Text', '=TRIM("  A   B  ")'],
  ['UNIQUE', 'UNIQUE(range)', 'Return distinct rows from a range as a spilling array.', 'Array', '=UNIQUE(A1:A3)', 'This local implementation compares whole rows; optional by-column and exactly-once modes are not supported.'],
  ['UPPER', 'UPPER(text)', 'Convert text to uppercase.', 'Text', '=UPPER("hello")'],
  ['VALUE', 'VALUE(text)', 'Convert supported numeric, date or time text to a numeric value.', 'Text', '=VALUE("42")', 'Uses the same strict date, time, USD currency and percentage parsing as cell entry. DATEVALUE and TIMEVALUE are also available for explicit conversion.'],
  ['VLOOKUP', 'VLOOKUP(search_key, range, column_index, [is_sorted])', 'Find a key in the first column and return a value from another column.', 'Lookup', '=VLOOKUP(2,A1:B3,2,FALSE)', 'Defaults to approximate matching on ascending keys. Use FALSE for exact.'],
  ['WEEKDAY', 'WEEKDAY(date, [type])', 'Return the weekday from a date serial.', 'Date & time', '=WEEKDAY(DATE(2026,10,18),2)', 'Supported types: 1 (Sunday=1), 2 (Monday=1), 3 (Monday=0).'],
  ['XLOOKUP', 'XLOOKUP(search_key, lookup_range, result_range, [missing_value], [match_mode], [search_mode])', 'Find a key and return the corresponding value in a single row or column.', 'Lookup', '=XLOOKUP(2,A1:A3,B1:B3)', 'Match modes: 0 exact, -1 next smaller, 1 next larger, 2 wildcard. Search modes: 1 first to last, -1 last to first; binary modes are unsupported.'],
  ['YEAR', 'YEAR(date)', 'Return the year from a date serial.', 'Date & time', '=YEAR(DATE(2026,10,18))'],
];

export const FORMULA_CATALOG = Object.freeze(entries.map(([name,signature,description,category,example,notes]) => Object.freeze({ name, signature, description, category, example, ...(notes ? { notes } : {}) })).sort((a,b) => a.name.localeCompare(b.name)));
const catalogByName = new Map(FORMULA_CATALOG.map(entry => [entry.name,entry]));
export function getFormulaHelp(name) { return catalogByName.get(String(name ?? '').trim().replace(/^=/,'').replace(/\(.*$/,'').toUpperCase()) ?? null; }

const cursorPosition = (text,cursor) => Number.isFinite(cursor) ? Math.max(0,Math.min(text.length,Math.trunc(cursor))) : text.length;
function quoteAt(text,end) {
  let quote=null;
  for(let i=0;i<end;i++) {
    const char=text[i];
    if(quote) { if(char===quote) { if(text[i+1]===quote && i+1<end)i++; else quote=null; } }
    else if(char==='"' || char==="'")quote=char;
  }
  return quote;
}

export function getFormulaSuggestions(input, options={}) {
  const text=String(input ?? '');
  if(typeof options==='number')options={limit:options};
  const limit=Number.isFinite(options.limit) ? Math.max(0,Math.min(50,Math.trunc(options.limit))) : 8;
  if(!limit)return [];
  const cursor=cursorPosition(text,options.cursor);
  const formula=text.trimStart().startsWith('=');
  if(!formula && !/^[A-Za-z_]*$/.test(text))return [];
  if(quoteAt(text,cursor))return [];
  let start=cursor,end=cursor;
  while(start>0 && /[A-Za-z0-9_.$]/.test(text[start-1]))start--;
  while(end<text.length && /[A-Za-z0-9_.$]/.test(text[end]))end++;
  const prefix=text.slice(start,cursor).toUpperCase();
  const token=text.slice(start,end);
  const before=text.slice(0,start).trimEnd().at(-1);
  const after=text.slice(end).trimStart();
  if(prefix && !/^[A-Z_][A-Z_]*$/.test(prefix))return [];
  if(/^\$?[A-Z]+\$?\d+$/i.test(token) || before==='!' || before===':' || after.startsWith('!'))return [];
  if(formula && before && !/[=,(+\-*/^&<>]/.test(before))return [];
  return FORMULA_CATALOG.filter(entry=>entry.name.startsWith(prefix)).slice(0,limit).map(entry=>({ ...entry,start,end,insertText:entry.name+(after.startsWith('(')?'':'(') }));
}

export function suggestFunctions(input,limit=8) { return getFormulaSuggestions(input,{limit}); }

// Commas inside nested functions, grouping parentheses and quoted text do not
// advance the surrounding function's active argument.
export function functionContext(input,cursor) {
  const text=String(input ?? '');
  if(!text.trimStart().startsWith('='))return null;
  const end=cursorPosition(text,cursor),stack=[];
  let quote=null;
  for(let i=0;i<end;i++) {
    const char=text[i];
    if(quote) { if(char===quote) { if(text[i+1]===quote && i+1<end)i++; else quote=null; } continue; }
    if(char==='"' || char==="'") { quote=char;continue; }
    if(char==='(') { const match=/([A-Za-z_][A-Za-z0-9_.]*)\s*$/.exec(text.slice(0,i));const help=match ? getFormulaHelp(match[1]) : null;stack.push({ name:match?.[1].toUpperCase() ?? null, function:help, activeArgument:0, activeArg:0,start:match ? i-match[0].length : i, open:i }); }
    else if(char===')')stack.pop();
    else if(char===',' && stack.length) { stack.at(-1).activeArgument++;stack.at(-1).activeArg++; }
  }
  // An unknown nested function is not falsely labeled as its parent.
  const current=stack.findLast(entry=>entry.name);
  return current?.function ? { ...current,signature:current.function.signature,description:current.function.description } : null;
}
