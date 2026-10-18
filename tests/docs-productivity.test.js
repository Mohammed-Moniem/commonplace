import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { unzipSync, strFromU8 } from 'fflate';
import { normalizeDocument, changeDocumentTab, updateActiveDocument, tabDepth, allDocumentTabsHtml } from '../src/editors/docsModel.js';
import { ParagraphLayout, RichImage } from '../src/editors/docsExtensions.js';
import { productivityExtensions, citationLibrary, citationText, setCitationLibrary, documentBookmarks, captureFormatting, applyFormatting, changeTextCase, equationTree, imageGeometry, transformImage, replacementImageAttributes, searchDocument, searchDocumentTabs, expandReplacement, sortParagraphs, unwrapColumnSection, setColumnSection, validateSearchRegex } from '../src/editors/docsProductivity.js';
import { createDocx, documentHtml } from '../src/editors/docsExport.js';
import { sanitizeHtml } from '../src/lib/sanitize.js';

const window = new Window();
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'Element', 'DOMParser', 'MutationObserver', 'getComputedStyle']) globalThis[key] = key === 'window' ? window : key === 'getComputedStyle' ? window[key].bind(window) : window[key];
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
const fixture = (html = '<p></p>') => { const element = document.createElement('div'); document.body.append(element); const editor = new Editor({ element, extensions: [StarterKit, TextStyle, TextAlign.configure({ types: ['paragraph', 'heading'] }), ParagraphLayout, RichImage.configure({ allowBase64: true }), ...productivityExtensions], content: html }); return { editor, close() { editor.destroy(); element.remove(); } }; };
const wordXml = (html) => strFromU8(unzipSync(createDocx(html))['word/document.xml']);
const sources = [{ id: 's1', author: 'Ada Lovelace', title: 'Notes on engines', year: '1843', publisher: 'Scientific Memoirs', url: 'https://example.test/notes' }, { id: 's2', author: 'Grace Hopper', title: 'Compilers', year: '1952', publisher: 'ACM', url: '' }];

test('[D4-01] duplicated tabs have independent ids, content and page objects', () => {
  let model = normalizeDocument({ html: '<p>Original</p>', page: { margin: 96 } }); model = changeDocumentTab(model, { type: 'duplicate', id: 'main', newId: 'copy' });
  assert.deepEqual(model.tabs.map((tab) => tab.id), ['main', 'copy']); assert.equal(model.tabs[1].html, model.tabs[0].html); assert.notEqual(model.tabs[1].page, model.tabs[0].page);
  model = updateActiveDocument(model, { html: '<p>Independent</p>', page: { margin: 48 } }); assert.equal(model.tabs[0].html, '<p>Original</p>'); assert.equal(model.tabs[0].page.margin, 96); assert.equal(model.html, '<p>Independent</p>');
  const sharedHtml = '<h2 id="heading-same">Heading</h2><p><span data-bookmark-name="Test" id="bookmark-same">⚑</span><a href="#bookmark-same">Jump</a><sup data-footnote-id="note-same" id="fnref-note-same"><a href="#fn-note-same">1</a></sup></p>';
  const exported = new DOMParser().parseFromString(allDocumentTabsHtml({ tabs: [{ id: 'one', html: sharedHtml }, { id: 'two', html: sharedHtml }] }), 'text/html');
  const ids = [...exported.querySelectorAll('[id]')].map((element) => element.id); assert.equal(new Set(ids).size, ids.length);
  const sections = [...exported.querySelectorAll('[data-document-tab]')]; sections.forEach((section, index) => { assert.equal(section.querySelector('[data-bookmark-name]').id, 'tab-' + index + '-bookmark-same'); assert.equal(section.querySelector('p>a').getAttribute('href'), '#tab-' + index + '-bookmark-same'); assert.equal(section.querySelector('[data-footnote-id]').id, 'fnref-tab-' + index + '-note-same'); });
});

test('[D4-02] tab nesting enforces three levels and preserves subtree moves and promotion', () => {
  let model = normalizeDocument({ tabs: ['a','b','c','d'].map((id) => ({ id, name: id, html: '<p>' + id + '</p>' })) });
  model = changeDocumentTab(model, { type: 'indent', id: 'b' }); model = changeDocumentTab(model, { type: 'indent', id: 'c' }); model = changeDocumentTab(model, { type: 'indent', id: 'c' });
  assert.equal(tabDepth(model.tabs, 'c'), 2); model = changeDocumentTab(model, { type: 'indent', id: 'c' }); assert.equal(tabDepth(model.tabs, 'c'), 2);
  model = changeDocumentTab(model, { type: 'move', id: 'a', direction: 1 }); assert.deepEqual(model.tabs.map((tab) => tab.id), ['d','a','b','c']);
  model = changeDocumentTab(model, { type: 'delete', id: 'b' }); assert.equal(model.tabs.find((tab) => tab.id === 'c').parentId, 'a'); model = changeDocumentTab(model, { type: 'outdent', id: 'c' }); assert.equal(tabDepth(model.tabs, 'c'), 0);
});

test('[D4-03] image crop computes actual source rectangle and rejects empty or invalid crops', async () => {
  assert.deepEqual(imageGeometry(400, 200, { type: 'crop', left: 25, right: 10, top: 10, bottom: 20 }), { sx: 100, sy: 20, sw: 260, sh: 140, width: 260, height: 140, rotate: false });
  assert.throws(() => imageGeometry(400, 200, { type: 'crop', left: 50, right: 49 }), /5%/); assert.throws(() => imageGeometry(400, 200, { type: 'crop', left: -1 }), /5%/);
  await assert.rejects(() => transformImage('https://example.test/image.png', { type: 'crop' }), /uploaded local/);
});

test('[D4-04] rotation redraws pixels through a rotated canvas with swapped dimensions', async () => {
  const createElement = document.createElement.bind(document), oldImage = globalThis.Image, calls = [];
  class DecodedImage { naturalWidth = 400; naturalHeight = 200; set src(value) { this.value = value; queueMicrotask(() => this.onload()); } }
  globalThis.Image = DecodedImage;
  document.createElement = (tag, ...args) => tag !== 'canvas' ? createElement(tag, ...args) : { width: 0, height: 0, getContext: () => ({ translate: (...values) => calls.push(['translate', ...values]), rotate: (...values) => calls.push(['rotate', ...values]), drawImage: (...values) => calls.push(['draw', ...values.slice(1)]) }), toDataURL: () => 'data:image/png;base64,cm90YXRlZA==' };
  try { const result = await transformImage('data:image/png;base64,b2xk', { type: 'rotate' }); assert.equal(result.width, 200); assert.equal(result.height, 400); assert.deepEqual(calls, [['translate',100,200], ['rotate',Math.PI / 2], ['draw',-200,-100]]); assert.notEqual(result.src, 'data:image/png;base64,b2xk'); } finally { document.createElement = createElement; globalThis.Image = oldImage; }
});

test('[D4-05] replacement retains display width and wrapping but follows new aspect ratio', () => {
  const previous = { src: 'old', width: 300, height: 100, wrap: 'right', title: 'diagram' }, next = replacementImageAttributes(previous, { width: 100, height: 200 }, 'new', 'replacement');
  assert.equal(next.width, 300); assert.equal(next.height, 600); assert.equal(next.wrap, 'right'); assert.equal(next.title, 'diagram'); assert.equal(next.alt, 'replacement'); assert.equal(previous.src, 'old'); assert.throws(() => replacementImageAttributes(previous, { width: 0, height: 200 }, 'x'), /invalid/);
});

test('[D4-06] source edits update inline citations and citation library survives HTML reload', () => {
  const f = fixture('<p>Claim.</p>'), { editor } = f; setCitationLibrary(editor, sources); editor.commands.setTextSelection(7); editor.commands.insertContent({ type: 'citation', attrs: { sourceId: 's1' } }); assert.match(editor.getHTML(), /Lovelace, 1843/);
  setCitationLibrary(editor, [{ ...sources[0], year: '1844' }, sources[1]]); assert.match(editor.getHTML(), /Lovelace, 1844/); const html = editor.getHTML(); editor.commands.setContent(sanitizeHtml(html)); assert.equal(citationLibrary(editor.state.doc).sources[0].title, 'Notes on engines'); assert.equal(citationLibrary(editor.state.doc).sources.length, 2);
  assert.doesNotThrow(() => editor.commands.setContent('<p>safe</p><div data-type="citation-library" data-sources="{}"></div>')); f.close();
  const cap = fixture(); const before = cap.editor.getHTML(); assert.throws(() => setCitationLibrary(cap.editor, Array.from({ length: 101 }, (_, index) => ({ ...sources[0], id: String(index) }))), /100 sources/); assert.equal(cap.editor.getHTML(), before); cap.close();
});

test('[D4-07] bibliography includes only cited sources and refreshes style and deletion', () => {
  const f = fixture(), { editor } = f; setCitationLibrary(editor, sources); editor.commands.setTextSelection(1); editor.commands.insertContent([{ type: 'citation', attrs: { sourceId: 's1' } }, { type: 'bibliography' }]);
  let html = editor.getHTML(); assert.match(html, /Notes on engines/); assert.doesNotMatch(new DOMParser().parseFromString(html, 'text/html').querySelector('[data-type="bibliography"]').textContent, /Compilers/); setCitationLibrary(editor, sources, 'mla'); assert.match(editor.getText(), /Ada Lovelace\. “Notes on engines\.”/); assert.equal(citationText(sources[0], 'chicago', true), 'Ada Lovelace. Notes on engines. Scientific Memoirs. https://example.test/notes, 1843.');
  let pos; editor.state.doc.descendants((node, at) => { if (node.type.name === 'citation') pos = at; }); editor.commands.deleteRange({ from: pos, to: pos + 1 }); assert.match(editor.getText(), /Insert a citation/); f.close();
});

test('[D4-08] bookmarks link without visible flag in Word and preserve internal anchors', () => {
  const f = fixture('<p><span id="bookmark-proof" data-bookmark-name="Proof">⚑</span>Read <a href="#bookmark-proof">source</a></p>'); assert.equal(documentBookmarks(f.editor.state.doc)[0].name, 'Proof'); const html = f.editor.getHTML(), xml = wordXml(html); assert.match(xml, /w:bookmarkStart/); assert.match(xml, /w:hyperlink w:anchor="Bookmark1"/); assert.doesNotMatch(xml, /⚑/); const reloaded = fixture(sanitizeHtml(html)); assert.equal(documentBookmarks(reloaded.editor.state.doc)[0].id, 'bookmark-proof'); reloaded.close(); f.close();
});

test('[D4-09] format painter copies marks and paragraph formatting while retaining target links and words', () => {
  const f = fixture('<p dir="rtl"><strong>Bold</strong></p><p><a href="https://example.test">Link</a></p>'), { editor } = f; editor.commands.setTextSelection({ from: 1, to: 5 }); const saved = captureFormatting(editor); editor.commands.setTextSelection({ from: 7, to: 11 }); applyFormatting(editor, saved); assert.match(editor.getHTML(), /<strong><a[^>]+>Link<\/a><\/strong>|<a[^>]+><strong>Link<\/strong><\/a>/); assert.equal(editor.state.doc.child(1).attrs.direction, 'rtl'); assert.equal(editor.getText(), 'Bold\n\nLink'); f.close();
  const edge = fixture('<p>Outside</p><p dir="rtl"><strong>Target</strong></p>'); edge.editor.commands.setTextSelection({ from: 8, to: 16 }); const captured = captureFormatting(edge.editor); assert.equal(captured.paragraph.direction, 'rtl'); assert.equal(captured.marks[0].type, 'bold'); edge.close();
});

test('[D4-10] equation grammar renders real fractions and scripts with safe reload and clear rejection', () => {
  const f = fixture(), { editor } = f; const source = '\\frac{a_1}{\\sqrt{x}} = \\alpha^2'; equationTree(source); editor.commands.insertContent({ type: 'equation', attrs: { source } }); const html = editor.getHTML(); assert.match(html, /<math/); assert.match(html, /<mfrac>/); assert.match(html, /<msqrt>/); assert.match(html, /<msub>/); assert.match(html, /α/); editor.commands.setContent(sanitizeHtml(html)); assert.match(editor.getHTML(), /<mfrac>/); assert.throws(() => equationTree('\\unknown{x}'), /Unsupported/); assert.throws(() => equationTree('x^{2'), /Close/); assert.match(wordXml(html), /frac/); f.close();
});

test('[D4-11] column sections wrap and unwrap real blocks and export native Word columns', () => {
  const f = fixture('<p>One</p><p>Two</p>'), { editor } = f; editor.commands.selectAll(); assert.equal(editor.commands.wrapIn('columnSection', { columns: 3 }), true); assert.match(editor.getHTML(), /column-count: 3|column-count:3/); assert.match(wordXml(editor.getHTML()), /w:cols w:num="3"/); const html = editor.getHTML(); editor.commands.setContent(sanitizeHtml(html)); assert.equal(editor.state.doc.firstChild.type.name, 'columnSection'); editor.commands.setTextSelection(2); assert.equal(unwrapColumnSection(editor), true); assert.equal(editor.getText().trimEnd(), 'One\n\nTwo'); assert.equal(editor.state.doc.firstChild.type.name, 'paragraph'); f.close();
  const edge = fixture('<p>Outside</p><p>One</p><p>Two</p>'); edge.editor.commands.setTextSelection({ from: 8, to: 18 }); setColumnSection(edge.editor, 2); assert.equal(edge.editor.state.doc.firstChild.type.name, 'paragraph'); assert.equal(edge.editor.state.doc.firstChild.textContent, 'Outside'); assert.equal(edge.editor.state.doc.child(1).type.name, 'columnSection'); edge.close();
});

test('[D4-12] selected text case preserves marks and Unicode expansions and excludes unselected text', () => {
  const f = fixture('<p>keep <strong>straße</strong> Last</p>'), { editor } = f; editor.commands.setTextSelection({ from: 6, to: 12 }); changeTextCase(editor, 'upper'); assert.equal(editor.getText(), 'keep STRASSE Last'); assert.match(editor.getHTML(), /<strong>STRASSE<\/strong>/); editor.commands.setContent('<p><strong>hELLO</strong> wORLD. nEXT</p>'); editor.commands.selectAll(); changeTextCase(editor, 'sentence'); assert.equal(editor.getText(), 'Hello world. Next'); f.close();
});

test('[D4-13] all-tab search returns correct tab ids and rich-text selection positions', () => {
  const f = fixture(); const found = searchDocumentTabs(f.editor.schema, [{ id: 'a', name: 'First', html: '<p>Zero</p>' }, { id: 'b', name: 'Nested', html: '<p>A <strong>target</strong> here</p>' }, { id: 'c', name: 'Third', html: '<p>target twice target</p>' }], 'target'); assert.equal(found.length, 3); assert.equal(found[0].tabId, 'b'); assert.equal(found[0].from, 3); assert.equal(found[0].to, 9); assert.equal(found[1].tabId, 'c'); assert.match(found[0].excerpt, /target/); f.close();
});

test('[D4-14] whole-word Unicode search excludes partial and underscore words and honors case', () => {
  const f = fixture('<p>cat scatter Cat cat_1 café cafés</p>'); assert.equal(searchDocument(f.editor.state.doc, 'cat').length, 4); assert.equal(searchDocument(f.editor.state.doc, 'cat', { wholeWord: true }).length, 2); assert.equal(searchDocument(f.editor.state.doc, 'cat', { wholeWord: true, matchCase: true }).length, 1); assert.equal(searchDocument(f.editor.state.doc, 'café', { wholeWord: true }).length, 1); f.close();
});

test('[D4-15] regex replacements expand captured groups and reject invalid or costly patterns', () => {
  assert.throws(() => validateSearchRegex('((a+))+$'), /simpler/); assert.throws(() => validateSearchRegex('(?:(a?)){25}a{25}'), /simpler/); assert.doesNotThrow(() => validateSearchRegex('(Alpha) (Beta)')); assert.doesNotThrow(() => validateSearchRegex('(a\\+)+'));
  const f = fixture('<p>Cat 12 and Cat 34</p>'); const matches = searchDocument(f.editor.state.doc, '(Cat) (\\d+)', { regex: true }); assert.equal(matches.length, 2); assert.equal(expandReplacement('$2:$1 $$ $&', matches[0]), '12:Cat $ Cat 12'); const tr = f.editor.state.tr; matches.reverse().forEach((match) => tr.insertText(expandReplacement('$2/$1', match), match.from, match.to)); f.editor.view.dispatch(tr); assert.equal(f.editor.getText(), '12/Cat and 34/Cat'); assert.throws(() => searchDocument(f.editor.state.doc, '[', { regex: true })); assert.throws(() => searchDocument(f.editor.state.doc, '(a+)+', { regex: true }), /simpler/); assert.throws(() => searchDocument(f.editor.state.doc, '(a?){25}a{25}', { regex: true }), /simpler/); assert.deepEqual(searchDocument(f.editor.state.doc, '^', { regex: true }), []); f.close();
});

test('[D4-16] paragraph borders and shading persist through HTML and native Word properties', () => {
  const f = fixture('<p>Design</p>'); f.editor.commands.setParagraphDesign({ borderColor: '#123456', shadeColor: '#eeddcc' }); const html = f.editor.getHTML(); assert.match(html, /border: 1px solid|border:1px solid/); const xml = wordXml(html); assert.match(xml, /w:pBdr/); assert.match(xml, /w:color="123456"/); assert.match(xml, /w:shd w:fill="eeddcc"/); f.editor.commands.setContent(sanitizeHtml(html)); assert.equal(f.editor.state.doc.firstChild.attrs.shadeColor, '#eeddcc'); f.editor.commands.setParagraphDesign({ borderColor: null, shadeColor: null }); assert.doesNotMatch(f.editor.getHTML(), /data-border-color|data-shade-color/); f.close();
  const edge = fixture('<p>Outside</p><p>Target</p>'); edge.editor.commands.setTextSelection({ from: 8, to: 16 }); edge.editor.commands.setParagraphDesign({ borderColor: '#112233' }); assert.equal(edge.editor.state.doc.firstChild.attrs.borderColor, null); assert.equal(edge.editor.state.doc.child(1).attrs.borderColor, '#112233'); edge.close();
});

test('[D4-17] before and after spacing are independent from line height and export as twips', () => {
  const f = fixture('<p style="line-height:2">Space</p>'); f.editor.commands.setParagraphDesign({ spaceBefore: 8, spaceAfter: 0 }); const html = f.editor.getHTML(); f.editor.commands.setContent(sanitizeHtml(html)); assert.equal(f.editor.state.doc.firstChild.attrs.spaceBefore, 8); assert.equal(f.editor.state.doc.firstChild.attrs.spaceAfter, 0); assert.equal(f.editor.state.doc.firstChild.attrs.lineHeight, '2'); const xml = wordXml(html); assert.match(xml, /w:line="480"/); assert.match(xml, /w:before="120"/); assert.match(xml, /w:after="0"/); f.close();
});

test('[D4-18] RTL paragraph direction does not replace explicit alignment and exports bidi', () => {
  const f = fixture('<p style="text-align:center">مرحبا بالعالم</p>'); f.editor.commands.setParagraphDesign({ direction: 'rtl' }); assert.equal(f.editor.state.doc.firstChild.attrs.textAlign, 'center'); const html = f.editor.getHTML(); assert.match(html, /dir="rtl"/); assert.match(wordXml(html), /w:bidi/); f.editor.commands.setParagraphDesign({ direction: 'ltr' }); assert.match(f.editor.getHTML(), /dir="ltr"/); f.close();
});

test('[D4-19] special characters insert at the existing cursor and remain portable text', () => {
  const f = fixture('<p>A B</p>'); f.editor.commands.setTextSelection(3); f.editor.commands.insertContent('© → π'); assert.equal(f.editor.getText(), 'A © → πB'); const html = f.editor.getHTML(); f.editor.commands.setContent(sanitizeHtml(html)); assert.equal(f.editor.getText(), 'A © → πB'); assert.match(documentHtml(html), /© → π/); assert.match(wordXml(html), /© → π/); f.close();
});

test('[D4-20] paragraph sorting keeps inline formatting and is undoable without flattening mixed blocks', () => {
  const f = fixture('<p><strong>Zulu</strong></p><p>alpha</p><p>Item 10</p><p>Item 2</p>'); f.editor.commands.selectAll(); sortParagraphs(f.editor); assert.equal(f.editor.getText(), 'alpha\n\nItem 2\n\nItem 10\n\nZulu'); assert.match(f.editor.getHTML(), /<strong>Zulu<\/strong>/); f.editor.commands.undo(); assert.equal(f.editor.state.doc.firstChild.textContent, 'Zulu'); f.editor.commands.setContent('<p>One</p><h2>Two</h2>'); f.editor.commands.selectAll(); assert.throws(() => sortParagraphs(f.editor), /ordinary/); f.close();
});
