import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContent, blankContent, openStore } from '../server/store.js';

test('all blank editor schemas and valid advanced spreadsheet content are accepted', () => {
  for (const kind of ['docs', 'sheets', 'slides']) assert.doesNotThrow(() => validateContent(kind, blankContent(kind)));
  const content = blankContent('sheets'); const sheet = content.sheets[0]; const range = { row: 0, col: 0, endRow: 3, endCol: 1 };
  sheet.cells = { A1: { value: 'Ready', format: { bold: true, color: '#335533', bg: '#ffffff', numberFormat: 'auto' } } };
  sheet.validations = [{ id: 'validation', range, options: ['Ready', 'Done'], strict: true }];
  sheet.conditionalRules = [{ id: 'format', range, type: 'equal', value: 'Ready', style: { bg: '#eeffee' } }];
  sheet.charts = [{ id: 'chart', range, title: 'Progress', type: 'bar' }];
  sheet.pivot = { sourceSheetId: sheet.id, range, groupCol: 0, valueCol: 1, aggregate: 'COUNT' };
  assert.doesNotThrow(() => validateContent('sheets', content));
});
test('malformed cells and worksheet structures cannot enter persistent storage', () => {
  for (const cells of [[], { A1: null }, { A1: {} }, { A1: { value: {} } }, { A1: { value: 123 } }, { bad: { value: 'x' } }, { A0: { value: 'x' } }, { A10001: { value: 'x' } }, { ZZ1: { value: 'x' } }, { A1: { value: 'x', format: null } }, { A1: { value: 'x', format: { color: {} } } }]) {
    assert.throws(() => validateContent('sheets', { sheets: [{ id: 'one', name: 'Main', cells }] }));
  }
  assert.throws(() => validateContent('sheets', { sheets: [null] }));
  assert.throws(() => validateContent('sheets', { sheets: [{ id: 'x', name: 'A', cells: {} }, { id: 'x', name: 'B', cells: {} }] }));
  assert.throws(() => validateContent('sheets', { ...blankContent('sheets'), activeSheetId: 'missing' }));
});
test('nonfinite coordinates, invalid metadata and object-valued slide text are rejected', () => {
  const element = { id: 'title', type: 'text', text: 'Hello', x: 10, y: 10, width: 200, height: 80, style: { fontSize: 32 } };
  const slide = { id: 'slide', elements: [element] };
  assert.doesNotThrow(() => validateContent('slides', { slides: [slide] }));
  for (const patch of [{ x: NaN }, { y: Infinity }, { width: -4 }, { height: null }, { text: {} }, { style: { fontSize: Infinity } }, { style: { opacity: 4 } }]) assert.throws(() => validateContent('slides', { slides: [{ ...slide, elements: [{ ...element, ...patch }] }] }));
  assert.throws(() => validateContent('slides', { slides: [{ ...slide, elements: [null] }] }));
  assert.throws(() => validateContent('slides', { slides: [{ ...slide, elements: [{ ...element, type: 'image', src: 'javascript:alert(1)' }] }] }));
  assert.throws(() => validateContent('slides', { slides: [{ ...slide, background: 'url(https://example.com/tracker)' }] }));
});
test('page settings cannot produce negative content width or render objects as text', () => {
  for (const page of [null, [], { margin: 10000 }, { margin: Infinity }, { header: {} }, { footer: 22 }, { pageNumbers: 'yes' }]) assert.throws(() => validateContent('docs', { html: '<p>Text</p>', page }));
  assert.doesNotThrow(() => validateContent('docs', { html: '<p>Text</p>', page: { size: 'a4', margin: 72, header: 'A header', footer: 'A footer', pageNumbers: true } }));
});
test('a rejected malformed update preserves both saved content and version history', () => {
  const store = openStore(':memory:', { seed: false });
  try { const file = store.create({ kind: 'sheets', title: 'Kept safely' }); assert.throws(() => store.update(file.id, { version: file.version, content: { sheets: [{ id: 'x', name: 'Broken', cells: { A1: null } }] } })); assert.deepEqual(store.file(file.id).content, file.content); assert.equal(store.file(file.id).version, 1); assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM versions WHERE file_id=?').get(file.id).total, 1); } finally { store.close(); }
});
