import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { markdownToHtml, htmlToMarkdown } from '../src/editors/docsMarkdown.js';
import { createDocx, documentHtml } from '../src/editors/docsExport.js';
import { importDocx } from '../src/editors/docsImport.js';
import { unzipSync, strFromU8 } from 'fflate';
import { normalizeDocument, updateActiveDocument, changeDocumentTab, pageBreakLayout, allDocumentTabsHtml } from '../src/editors/docsModel.js';
import { TaskList, TaskItem, Superscript, Subscript, ParagraphLayout, Footnote, TableOfContents, DocumentStructure, SuggestionInsert, SuggestionDelete, createSuggesting, collectSuggestions, reviewSuggestions, documentHeadings, documentFootnotes, RichImage } from '../src/editors/docsExtensions.js';

const window = new Window();
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'Element', 'DOMParser', 'MutationObserver', 'getComputedStyle']) globalThis[key] = key === 'window' ? window : typeof window[key] === 'function' && key === 'getComputedStyle' ? window[key].bind(window) : window[key];
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
const makeEditor = (html, enabled = false) => {
  const mode = { enabled };
  const element = document.createElement('div'); document.body.append(element);
  const editor = new Editor({ element, extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), Superscript, Subscript, ParagraphLayout, Footnote, TableOfContents, DocumentStructure, SuggestionInsert, SuggestionDelete, createSuggesting(() => mode.enabled), RichImage.configure({ allowBase64: true })], content: html });
  return { editor, mode, destroy() { editor.destroy(); element.remove(); } };
};

test('[D2-01] tabs preserve separate bodies, active mirror, order and last-tab safety', () => {
  let doc = normalizeDocument({ html: '<p>Legacy body</p>', page: { margin: 96 } });
  assert.equal(doc.tabs[0].html, '<p>Legacy body</p>');
  doc = changeDocumentTab(doc, { type: 'add', id: 'research', name: 'Research' });
  doc = updateActiveDocument(doc, { html: '<p>References</p>', page: { mode: 'pageless' } });
  doc = changeDocumentTab(doc, { type: 'rename', id: 'main', name: 'Draft' });
  doc = changeDocumentTab(doc, { type: 'move', id: 'research', direction: -1 });
  assert.deepEqual(doc.tabs.map(tab => tab.name), ['Research', 'Draft']);
  doc = changeDocumentTab(JSON.parse(JSON.stringify(doc)), { type: 'select', id: 'main' });
  assert.equal(doc.html, '<p>Legacy body</p>');
  assert.equal(doc.page.margin, 96);
  assert.equal(doc.tabs[0].page.mode, 'pageless');
  doc = changeDocumentTab(doc, { type: 'delete', id: 'main' });
  assert.equal(doc.html, '<p>References</p>');
  assert.equal(changeDocumentTab(doc, { type: 'delete', id: 'research' }).tabs.length, 1);
});

test('[D2-02] suggesting replacement rejects to exact original and accepts proposed text', () => {
  for (const accept of [false, true]) {
    const fixture = makeEditor('<p>Hello world</p>', true), { editor } = fixture;
    editor.commands.setTextSelection({ from: 7, to: 12 });
    editor.commands.insertContent('team');
    const changes = collectSuggestions(editor.state.doc);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].deleted, 'world');
    assert.equal(changes[0].inserted, 'team');
    reviewSuggestions(editor, accept);
    assert.equal(editor.getText(), accept ? 'Hello team' : 'Hello world');
    assert.equal(collectSuggestions(editor.state.doc).length, 0);
    fixture.destroy();
  }
});

test('[D2-03] insertion coalesces typing, deletion of own insertion cancels, undo restores', () => {
  const fixture = makeEditor('<p>A</p>', true), { editor } = fixture;
  editor.commands.setTextSelection(2);
  editor.commands.insertContent('B'); editor.commands.insertContent('C');
  assert.equal(collectSuggestions(editor.state.doc).length, 1);
  assert.equal(collectSuggestions(editor.state.doc)[0].inserted, 'BC');
  editor.commands.deleteRange({ from: 3, to: 4 });
  assert.equal(editor.getText(), 'AB');
  assert.equal(collectSuggestions(editor.state.doc)[0].deleted, '');
  assert.equal(editor.commands.undo(), true);
  assert.equal(collectSuggestions(editor.state.doc).length, 0);
  assert.equal(editor.getText(), 'A');
  assert.equal(editor.commands.redo(), true);
  assert.equal(editor.getText(), 'AB');
  fixture.destroy();
});

test('[D2-04] separate suggestions can be reviewed individually and survive HTML serialization', () => {
  const fixture = makeEditor('<p>One two three</p>', true), { editor } = fixture;
  editor.commands.insertContentAt(4, '!');
  editor.commands.deleteRange({ from: 10, to: 15 });
  const changes = collectSuggestions(editor.state.doc);
  assert.equal(changes.length, 2);
  const restored = makeEditor(editor.getHTML());
  assert.equal(collectSuggestions(restored.editor.state.doc).length, 2);
  reviewSuggestions(restored.editor, false, changes.find(change => change.deleted).id);
  assert.match(restored.editor.getText(), /three/);
  assert.equal(collectSuggestions(restored.editor.state.doc).length, 1);
  restored.destroy(); fixture.destroy();
});

test('[D2-05] checklist toggles checked state and nested items roundtrip', () => {
  const fixture = makeEditor('<p>Write plan</p>'), { editor } = fixture;
  editor.commands.toggleTaskList();
  assert.equal(editor.isActive('taskList'), true);
  editor.commands.updateAttributes('taskItem', { checked: true });
  const restored = makeEditor(editor.getHTML());
  assert.equal(restored.editor.getJSON().content[0].content[0].attrs.checked, true);
  restored.destroy(); fixture.destroy();
});

test('[D2-06] superscript and subscript are exclusive and serialize', () => {
  const fixture = makeEditor('<p>H2O</p>'), { editor } = fixture;
  editor.commands.setTextSelection({ from: 2, to: 3 }); editor.commands.toggleSubscript();
  assert.match(editor.getHTML(), /<sub>2<\/sub>/);
  editor.commands.toggleSuperscript();
  assert.match(editor.getHTML(), /<sup>2<\/sup>/); assert.doesNotMatch(editor.getHTML(), /<sub>/);
  fixture.destroy();
});

test('[D2-07] paragraph indent and line spacing apply to selected paragraphs and roundtrip', () => {
  const fixture = makeEditor('<p>First</p><p>Second</p>'), { editor } = fixture;
  editor.commands.selectAll(); editor.commands.indentParagraph(); editor.commands.setParagraphSpacing('2');
  const restored = makeEditor(editor.getHTML());
  assert.equal(restored.editor.getJSON().content[0].attrs.indent, 1);
  assert.equal(restored.editor.getJSON().content[1].attrs.lineHeight, '2');
  editor.commands.outdentParagraph();
  assert.equal(editor.getJSON().content[0].attrs.indent, 0);
  restored.destroy(); fixture.destroy();
});

test('[D2-08] footnotes renumber after deletion and preserve text in saved HTML', () => {
  const fixture = makeEditor('<p>Intro</p>'), { editor } = fixture;
  editor.commands.setTextSelection(6); editor.commands.insertFootnote('First source'); editor.commands.insertContent(' body '); editor.commands.insertFootnote('Second source');
  assert.deepEqual(documentFootnotes(editor.state.doc).map(note => note.number), [1, 2]);
  const first = documentFootnotes(editor.state.doc)[0];
  editor.commands.deleteRange({ from: first.pos, to: first.pos + 1 });
  const notes = documentFootnotes(editor.state.doc);
  assert.equal(notes[0].number, 1); assert.equal(notes[0].text, 'Second source');
  const restored = makeEditor(editor.getHTML());
  assert.equal(documentFootnotes(restored.editor.state.doc)[0]?.text, 'Second source', editor.getHTML() + JSON.stringify(restored.editor.getJSON()));
  restored.destroy(); fixture.destroy();
});

test('[D2-09] table of contents updates text and stable links after heading edits', () => {
  const fixture = makeEditor('<h1>First chapter</h1><h2>Details</h2><p>Body</p>'), { editor } = fixture;
  editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'tableOfContents' });
  let toc; editor.state.doc.descendants(node => { if (node.type.name === 'tableOfContents') toc = node; });
  assert.deepEqual(toc.attrs.entries.map(entry => entry.text), ['First chapter', 'Details']);
  const id = documentHeadings(editor.state.doc)[0].id;
  editor.commands.insertContentAt({ from: 1, to: 14 }, 'Renamed');
  editor.state.doc.descendants(node => { if (node.type.name === 'tableOfContents') toc = node; });
  assert.equal(toc.attrs.entries[0].text, 'Renamed'); assert.equal(toc.attrs.entries[0].id, id);
  assert.match(editor.getHTML(), new RegExp('href="#' + id + '"'));
  fixture.destroy();
});

test('[D2-10] image width and wrapping survive HTML and explicit page layout calculates gaps', () => {
  const fixture = makeEditor('<p>Body</p><img src="data:image/png;base64,aA==" width="240" height="120" data-wrap="left">');
  const html = fixture.editor.getHTML();
  assert.match(html, /width="240"/); assert.match(html, /data-wrap="left"/); assert.match(html, /float:\s*left/);
  const layout = pageBreakLayout([{ pos: 0, height: 300 }, { pos: 10, height: 400 }, { pos: 20, height: 300 }], 800, 72);
  assert.equal(layout.pages, 2); assert.equal(layout.breaks[0].pos, 20); assert.equal(layout.breaks[0].height, 268);
  fixture.destroy();
});

test('[D2-11] Markdown imports headings, inline formatting, nested tasks, links, table and code safely', () => {
  const source = ['# Plan', '', '**Bold** and *italic*, [Guide](https://example.com).', '', '- [x] Done', '  - Child', '- [ ] Next', '', '| Item | Cost |', '| --- | --- |', '| Pen | 5 |', '', '~~~js', 'const value = "<unsafe>";', '~~~', '', '<script>alert(1)</script>', '[bad](javascript:alert)'].join('\n');
  const imported = markdownToHtml(source);
  assert.match(imported.html, /<h1>Plan<\/h1>/);
  assert.match(imported.html, /<strong>Bold<\/strong>/);
  assert.match(imported.html, /data-checked="true"/);
  assert.match(imported.html, /<li><p>Child<\/p><\/li>/);
  assert.match(imported.html, /<td><p>5<\/p><\/td>/);
  assert.match(imported.html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(imported.html, /<script|href="javascript:/);
  assert.equal(imported.warnings.length, 0);
});

test('[D2-12] Markdown export and reimport retain portable document content and footnotes', () => {
  const fixture = makeEditor('<h2>Overview</h2><p><strong>Bold</strong> and <em>italic</em></p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul><p>Source<sup data-footnote-id="source" data-footnote-text="A source" data-footnote-number="1">1</sup></p>');
  const markdown = htmlToMarkdown(fixture.editor.getHTML());
  assert.match(markdown, /## Overview/); assert.match(markdown, /\*\*Bold\*\*/); assert.match(markdown, /- \[x\] Done/); assert.match(markdown, /\[\^1\]: A source/);
  const restored = makeEditor(markdownToHtml(markdown).html);
  assert.equal(documentFootnotes(restored.editor.state.doc)[0].text, 'A source');
  assert.match(restored.editor.getText(), /Overview/);
  restored.destroy(); fixture.destroy();
});

test('[D2-13] multiple replace-all steps reject without losing text and review is undoable', () => {
  const fixture = makeEditor('<p>Cat Cat</p>', true), { editor } = fixture;
  const tr = editor.state.tr; tr.insertText('Dog', 5, 8); tr.insertText('Dog', 1, 4); editor.view.dispatch(tr);
  assert.equal(collectSuggestions(editor.state.doc).length, 2);
  reviewSuggestions(editor, false);
  assert.equal(editor.getText(), 'Cat Cat');
  editor.commands.undo();
  assert.equal(collectSuggestions(editor.state.doc).length, 2);
  fixture.destroy();
});

test('[D2-14] pageless preference stays independent per tab through saved JSON', () => {
  let doc = normalizeDocument({ html: '<p>Page one</p>' });
  doc = updateActiveDocument(doc, { page: { mode: 'pageless' } });
  doc = changeDocumentTab(doc, { type: 'add', id: 'paper' });
  doc = updateActiveDocument(doc, { page: { mode: 'pages' } });
  doc = changeDocumentTab(JSON.parse(JSON.stringify(doc)), { type: 'select', id: 'main' });
  assert.equal(doc.page.mode, 'pageless');
  assert.equal(doc.tabs[1].page.mode, 'pages');
});

test('[D2-15] suggesting across paragraph boundaries retains deleted text and rejects without loss', () => {
  const fixture = makeEditor('<p>One</p><p>Two</p>', true), { editor } = fixture;
  editor.commands.insertContentAt({ from: 2, to: 7 }, 'X');
  assert.equal(collectSuggestions(editor.state.doc)[0].deleted, 'neT');
  reviewSuggestions(editor, false);
  assert.equal(editor.getText(), 'One\n\nTwo');
  fixture.destroy();
});

test('[D2-16] Word package contains real footnotes, script styles and paragraph layout and reimports them', async () => {
  const html = '<h1>Report</h1><p data-indent="2" style="margin-left:48px;line-height:2">H<sub>2</sub>O x<sup>2</sup><sup data-footnote-id="src" data-footnote-text="Verified source" data-footnote-number="1">1</sup></p>';
  const bytes = createDocx(html, { header: 'Header', pageNumbers: true });
  const files = unzipSync(bytes), xml = strFromU8(files['word/document.xml']);
  assert.match(xml, /<w:footnoteReference w:id="1"\/>/);
  assert.match(xml, /<w:vertAlign w:val="subscript"\/>/);
  assert.match(xml, /<w:ind w:left="720"\/>/);
  assert.match(xml, /w:line="480"/);
  assert.match(strFromU8(files['word/footnotes.xml']), /Verified source/);
  assert.match(strFromU8(files['[Content_Types].xml']), /wordprocessingml.footnotes\+xml/);
  const imported = await importDocx({ size: bytes.length, arrayBuffer: async () => bytes.buffer });
  assert.match(imported.html, /data-footnote-text="Verified source"/);
  assert.match(imported.html, /<sub>2<\/sub>/); assert.match(imported.html, /margin-left:48px/);
  const restored = makeEditor(imported.html);
  assert.equal(documentFootnotes(restored.editor.state.doc)[0].text, 'Verified source');
  assert.equal(restored.editor.getJSON().content[1].attrs.lineHeight, '2');
  assert.equal(imported.page.header, 'Header'); assert.equal(imported.page.pageNumbers, true);
  restored.destroy();
});

test('[D2-17] printable HTML includes linked footnotes and escapes running header text', () => {
  const html = documentHtml('<p>Text<sup data-footnote-id="ref" data-footnote-text="A &amp; B">1</sup></p>', { header: '<script>bad</script>', pageNumbers: true });
  assert.match(html, /id="fn-ref"/); assert.match(html, /A &amp; B/);
  assert.doesNotMatch(html, /<script>bad/); assert.match(html, /counter\(page\)/);
});

test('[D2-18] browser-style full text-node reconciliation marks only the changed phrase', () => {
  const original = 'Second tab keeps its own ideas.', phrase = ' A suggested next step.';
  for (const prefix of [true, false]) {
    const fixture = makeEditor('<p>' + original + '</p>', true), { editor } = fixture;
    editor.view.dispatch(editor.state.tr.insertText(prefix ? phrase + original : original + phrase, 1, original.length + 1));
    const changes = collectSuggestions(editor.state.doc);
    assert.equal(changes.length, 1); assert.equal(changes[0].inserted, phrase); assert.equal(changes[0].deleted, '');
    reviewSuggestions(editor, false);
    assert.equal(editor.getText(), original);
    fixture.destroy();
  }
});

test('[D2-19] exporting all tabs includes inactive bodies with escaped labels and tab separators', () => {
  const content = { tabs: [{ id: 'a', name: '<Draft>', html: '<p>Draft body</p>' }, { id: 'b', name: 'Research', html: '<p>Source body</p>' }], activeTabId: 'b' };
  const html = allDocumentTabsHtml(content);
  assert.match(html, /&lt;Draft&gt;/); assert.match(html, /Draft body/); assert.match(html, /Source body/);
  assert.equal((html.match(/data-type="page-break"/g) || []).length, 1);
});
