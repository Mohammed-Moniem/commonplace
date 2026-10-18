import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const window = new Window();
globalThis.document = window.document;
globalThis.Node = window.Node;
// Happy DOM21 does not match a wildcard namespace in getElementsByTagNameNS.
// Apply the same standards-compatible lookup to both subjects; target sources stay unchanged.
globalThis.DOMParser = class extends window.DOMParser {
  parseFromString(text, type) {
    const document = super.parseFromString(text, type);
    if (type === 'application/xml') {
      for (const node of [document, ...document.getElementsByTagName('*')]) {
        const original = node.getElementsByTagNameNS.bind(node);
        node.getElementsByTagNameNS = (namespace, local) => namespace === '*'
          ? Array.from(node.getElementsByTagName('*')).filter(element => local === '*' || element.localName === local)
          : original(namespace, local);
      }
    }
    return document;
  }
};
const subjectRoot = process.env.DOCS_BENCHMARK_ROOT ? pathToFileURL(resolve(process.env.DOCS_BENCHMARK_ROOT) + '/') : new URL('../', import.meta.url);
const { createDocx, documentHtml } = await import(new URL('src/editors/docsExport.js', subjectRoot));
const { importDocx } = await import(new URL('src/editors/docsImport.js', subjectRoot));
const wordFiles = (html) => unzipSync(createDocx(html));
const readXml = (files, path) => files[path] ? strFromU8(files[path]) : '';
const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const elements = (xml, name) => Array.from(parseXml(xml).getElementsByTagNameNS('*', name));
const attr = (element, name) => element.getAttribute('w:' + name);

test('[D2-20] comparable DOCX exports a real footnote part, reference, relationship and source text', () => {
  const files = wordFiles('<p>Claim<sup data-footnote-id="source-a" data-footnote-text="Osman, Local study, 2026." data-footnote-number="1">1</sup></p>');
  assert.ok(files['word/footnotes.xml'], 'Footnotes must be an editable OOXML footnotes part, not a superscript label.');
  const references = elements(readXml(files, 'word/document.xml'), 'footnoteReference');
  assert.equal(references.length, 1); assert.equal(attr(references[0], 'id'), '1');
  const notes = elements(readXml(files, 'word/footnotes.xml'), 'footnote').filter(note => attr(note, 'id') === '1');
  assert.equal(notes.length, 1); assert.match(notes[0].textContent, /Osman, Local study, 2026\./);
  const relationships = readXml(files, 'word/_rels/document.xml.rels');
  assert.match(relationships, /relationships\/footnotes" Target="footnotes.xml"/);
  assert.match(readXml(files, '[Content_Types].xml'), /wordprocessingml.footnotes\+xml/);
});

test('[D2-21] comparable DOCX represents subscript and superscript with native run vertical alignment', () => {
  const xml = readXml(wordFiles('<p>H<sub>2</sub>O and x<sup>2</sup></p>'), 'word/document.xml');
  const scriptRuns = elements(xml, 'r').filter(run => run.getElementsByTagNameNS('*', 'vertAlign').length);
  assert.equal(scriptRuns.length, 2);
  assert.deepEqual(scriptRuns.map(run => attr(run.getElementsByTagNameNS('*', 'vertAlign')[0], 'val')), ['subscript', 'superscript']);
  assert.deepEqual(scriptRuns.map(run => run.getElementsByTagNameNS('*', 't')[0].textContent), ['2', '2']);
});

test('[D2-22] comparable DOCX encodes selected paragraph indentation and double line spacing', () => {
  const xml = readXml(wordFiles('<p style="margin-left:48px;line-height:2">Indented paragraph</p><p>Normal paragraph</p>'), 'word/document.xml');
  const paragraphs = elements(xml, 'p'), first = paragraphs[0], second = paragraphs[1];
  const indent = first.getElementsByTagNameNS('*', 'ind')[0], spacing = first.getElementsByTagNameNS('*', 'spacing')[0];
  assert.ok(indent, 'Paragraph indentation must be a native paragraph property.');
  assert.equal(attr(indent, 'left'), '720');
  assert.ok(spacing, 'Line spacing must be a native paragraph property.');
  assert.equal(attr(spacing, 'line'), '480'); assert.equal(attr(spacing, 'lineRule'), 'auto');
  assert.equal(second.getElementsByTagNameNS('*', 'ind').length, 0);
  assert.equal(second.getElementsByTagNameNS('*', 'spacing').length, 0);
});

test('[D2-23] comparable printable HTML includes readable footnote source with a navigable destination', () => {
  const html = documentHtml('<p>Claim<sup id="fnref-ref-a" data-footnote-id="ref-a" data-footnote-text="A &amp; B source">1</sup></p>');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const note = doc.querySelector('#fn-ref-a');
  assert.ok(note, 'A footnote reference must resolve to a readable footnote destination.');
  assert.match(note.textContent, /A & B source/);
  assert.equal(note.querySelector('a').getAttribute('href'), '#fnref-ref-a');
  assert.equal(doc.querySelectorAll('.document-footnotes li').length, 1);
  assert.equal(doc.querySelector('.document-footnotes script'), null);
});

test('[D2-24] comparable standard OOXML footnote import retains editable source text and reference', async () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>',
    'word/document.xml': '<w:document xmlns:w="' + W + '"><w:body><w:p><w:r><w:t>Claim</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:sectPr/></w:body></w:document>',
    'word/footnotes.xml': '<w:footnotes xmlns:w="' + W + '"><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>Independent source text.</w:t></w:r></w:p></w:footnote></w:footnotes>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>',
  };
  const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])));
  const imported = await importDocx({ size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const doc = new DOMParser().parseFromString(imported.html, 'text/html'), note = doc.querySelector('[data-footnote-id]');
  assert.ok(note, 'Imported footnotes must retain editable source metadata, not only a visible reference number.');
  assert.equal(note.dataset.footnoteText, 'Independent source text.');
  assert.equal(note.dataset.footnoteNumber, '1');
  assert.match(doc.body.textContent, /Claim/);
});
