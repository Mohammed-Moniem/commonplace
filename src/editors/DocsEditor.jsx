import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import { EditorState } from '@tiptap/pm/state';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, ChevronLeft, ChevronRight, FileText, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, Minus, PanelLeft, Plus, Printer, Redo2, RemoveFormatting, Search, Strikethrough, Table2, Underline, Undo2, X } from 'lucide-react';
import { sanitizeHtml } from '../lib/sanitize.js';
import { createDocx, documentHtml, downloadDocument } from './docsExport.js';
import { importDocx } from './docsImport.js';
import { markdownToHtml, htmlToMarkdown } from './docsMarkdown.js';
import { defaultPage as pageDefault, normalizeDocument, updateActiveDocument, changeDocumentTab, allDocumentTabsHtml, tabDepth } from './docsModel.js';
import { TaskList, TaskItem, Superscript, Subscript, ParagraphLayout, Footnote, TableOfContents, DocumentStructure, SuggestionInsert, SuggestionDelete, RichImage, createSuggesting, createPagination, paginationKey, collectSuggestions, reviewSuggestions, documentFootnotes } from './docsExtensions.js';
import { productivityExtensions, searchDocument, expandReplacement, transformImage, replacementImageAttributes } from './docsProductivity.js';
import { LinkedSheetBlock, insertLinkedSheet, refreshLinkedSheets } from './docsLinkedSheets.js';
import DocsTools from './DocsTools.jsx';
import './docs.css';

const FontStyle = Extension.create({
  name: 'fontStyle',
  addGlobalAttributes() {
    return [{ types: ['textStyle'], attributes: {
      fontSize: { default: null, parseHTML: (element) => element.style.fontSize || null, renderHTML: (attributes) => attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {} },
      fontFamily: { default: null, parseHTML: (element) => element.style.fontFamily || null, renderHTML: (attributes) => attributes.fontFamily ? { style: `font-family: ${attributes.fontFamily}` } : {} },
      backgroundColor: { default: null, parseHTML: (element) => element.style.backgroundColor || null, renderHTML: (attributes) => attributes.backgroundColor ? { style: `background-color: ${attributes.backgroundColor}` } : {} },
    } }];
  },
});

const PageBreak = Node.create({
  name: 'pageBreak', group: 'block', atom: true, selectable: true,
  parseHTML: () => [{ tag: 'div[data-type="page-break"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page-break', class: 'docs-page-break' })],
});

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fontOptions = ['Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Courier New'];
const fontSizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
const colorInput = (value, fallback) => {
  if (/^#[a-f\d]{6}$/i.test(value || '')) return value;
  const rgb = String(value || '').match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return rgb ? `#${rgb.slice(1).map((number) => Math.max(0, Math.min(255, Number(number))).toString(16).padStart(2, '0')).join('')}` : fallback;
};

function getOutline(editor) {
  if (!editor) return [];
  const headings = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'heading') headings.push({ level: node.attrs.level, text: node.textContent || 'Untitled heading', position });
  });
  return headings;
}

function findMatches(editor, query, matchCase) {
  if (!editor || !query) return [];
  const matches = [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
  editor.state.doc.descendants((block, position) => {
    if (!block.isTextblock) return;
    let text = '';
    const positions = [];
    block.descendants((node, offset) => {
      if (node.isText) {
        for (let index = 0; index < node.text.length; index++) {
          text += node.text[index];
          positions.push(position + 1 + offset + index);
        }
      } else if (node.type.name === 'hardBreak') {
        text += '\n';
        positions.push(position + 1 + offset);
      }
    });
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      matches.push({ from: positions[match.index], to: positions[match.index + match[0].length - 1] + 1 });
    }
    return false;
  });
  return matches;
}

function ToolButton({ icon: Icon, label, onClick, active, disabled, children, className = '' }) {
  return <button type="button" className={`docs-tool ${active ? 'is-active' : ''} ${className}`} title={label} aria-label={label} aria-pressed={active === undefined ? undefined : Boolean(active)} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{Icon && <Icon size={17} strokeWidth={1.8} />}{children}</button>;
}

export default function DocsEditor({ content, onChange, readOnly = false, onReady }) {
  const [viewTabId, setViewTabId] = useState(null);
  const model = normalizeDocument(content || {});
  if (readOnly && viewTabId && model.tabs.some((tab) => tab.id === viewTabId)) { const viewed = model.tabs.find((tab) => tab.id === viewTabId); model.activeTabId = viewed.id; model.html = viewed.html; model.page = viewed.page; }
  const contentRef = useRef(model);
  const onChangeRef = useRef(onChange);
  const readOnlyRef = useRef(readOnly);
  const editorRef = useRef(null);
  const actionsRef = useRef({});
  const imageInput = useRef(null);
  const replaceImageRef = useRef(null);
  const fileInput = useRef(null);
  const paperRef = useRef(null);
  const fileMenuRef = useRef(null);
  const findRef = useRef(null);
  const loadedTabRef = useRef(model.activeTabId);
  const modeRef = useRef(false);
  const pageOptionsRef = useRef({});
  const [revision, setRevision] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [menu, setMenu] = useState(null);
  const [zoom, setZoom] = useState(100);
  const [paperHeight, setPaperHeight] = useState(1123);
  const [notice, setNotice] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexSearch, setRegexSearch] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const [linkDialog, setLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [pageDialog, setPageDialog] = useState(false);
  const [pageDraft, setPageDraft] = useState(pageDefault);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [editingMode, setEditingMode] = useState('editing');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [textDialog, setTextDialog] = useState(null);
  const [writingTool, setWritingTool] = useState(null);
  const [painter, setPainter] = useState(null);
  contentRef.current = model;
  modeRef.current = !readOnly && editingMode === 'suggesting';
  onChangeRef.current = onChange;
  readOnlyRef.current = readOnly;
  const page = model.page;
  const portraitWidth = page.size === 'letter' ? 816 : 794;
  const portraitHeight = page.size === 'letter' ? 1056 : 1123;
  const pageWidth = page.orientation === 'landscape' ? portraitHeight : portraitWidth;
  const pageHeight = page.orientation === 'landscape' ? portraitWidth : portraitHeight;
  const margin = Number(page.margin) || 72;
  const pageless = page.mode === 'pageless';
  pageOptionsRef.current = { enabled: !pageless, height: pageHeight, margin, zoom: zoom / 100 };
  const publish = useCallback((next) => { contentRef.current = next; onChangeRef.current?.(next); }, []);

  const inform = useCallback((message) => setNotice(message), []);
  const insertImages = useCallback(async (files) => {
    if (readOnlyRef.current) return;
    const replacing = replaceImageRef.current; replaceImageRef.current = null;
    for (const file of replacing ? files.slice(0, 1) : files) {
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) { inform('Use a PNG, JPEG, GIF, or WebP image. SVG and other formats are not supported.'); continue; }
      if (file.size > 8 * 1024 * 1024) { inform('Choose an image smaller than 8 MB.'); continue; }
      try {
        const source = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        if (!readOnlyRef.current) {
          const current = editorRef.current;
          if (replacing) { if (current.state.doc !== replacing.doc) { inform('Document changed while opening the image. Select it and replace again.'); return; } const image = new Image(); await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = source; }); if (readOnlyRef.current || current.state.doc !== replacing.doc) return inform('Document changed. Select the image and try again.'); current.chain().focus().setNodeSelection(replacing.pos).updateAttributes('image', replacementImageAttributes(replacing.attrs, { width: image.naturalWidth, height: image.naturalHeight }, source, file.name)).run(); }
          else current?.chain().focus().setImage({ src: source, alt: file.name }).run();
        }
      } catch { inform('This image could not be opened. Try a PNG or JPEG.'); }
    }
  }, [inform]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TextStyle, FontStyle, Color, Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      RichImage.configure({ allowBase64: true, resize: { enabled: true, directions: ['bottom-right'], minWidth: 40, minHeight: 40, alwaysPreserveAspectRatio: true }, HTMLAttributes: { loading: 'lazy' } }),
      Table.configure({ resizable: true, HTMLAttributes: { class: 'docs-table' } }), TableRow, TableHeader, TableCell, PageBreak,
      TaskList, TaskItem.configure({ nested: true }), Superscript, Subscript, ParagraphLayout, Footnote, TableOfContents,
      ...productivityExtensions, LinkedSheetBlock,
      DocumentStructure, SuggestionInsert, SuggestionDelete, createSuggesting(() => modeRef.current), createPagination(() => pageOptionsRef.current),
    ],
    content: sanitizeHtml(model.html || '<p></p>'),
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'docs-prose', spellcheck: 'true', 'aria-label': 'Document content', 'aria-multiline': 'true', role: 'textbox' },
      handleClick: (view, _pos, event) => { const anchor = event.target.closest?.('a[href^="#"]'); if (!anchor) return false; const id = anchor.getAttribute('href').slice(1); let found = null; view.state.doc.descendants((node, pos) => { if (node.attrs.id === id || node.attrs.headingId === id) found = node.type.name === 'heading' ? pos + 1 : pos; }); if (found === null) return false; event.preventDefault(); editorRef.current?.chain().setTextSelection(found).focus().scrollIntoView().run(); return true; },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith('image/'));
        if (!files.length || readOnlyRef.current) return false;
        event.preventDefault(); insertImages(files); return true;
      },
      handleDrop: (_view, event) => {
        const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith('image/'));
        if (!files.length || readOnlyRef.current) return false;
        event.preventDefault(); insertImages(files); return true;
      },
      transformPastedHTML: (html) => sanitizeHtml(html),
    },
    onUpdate: ({ editor: current }) => {
      if (!readOnlyRef.current) publish(updateActiveDocument(contentRef.current, { html: current.getHTML() }));
      setRevision((number) => number + 1);
    },
    onSelectionUpdate: () => setRevision((number) => number + 1),
    onTransaction: () => setRevision((number) => number + 1),
  });
  editorRef.current = editor;

  useEffect(() => { if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly); }, [editor, readOnly]);
  useEffect(() => {
    if (editor && (model.html !== editor.getHTML() || loadedTabRef.current !== model.activeTabId)) {
      const tabChanged = loadedTabRef.current !== model.activeTabId;
      editor.commands.setContent(sanitizeHtml(model.html || '<p></p>'), { emitUpdate: false });
      if (tabChanged) editor.view.updateState(EditorState.create({ schema: editor.schema, doc: editor.state.doc, plugins: editor.state.plugins }));
      loadedTabRef.current = model.activeTabId;
      setRevision((number) => number + 1);
    }
  }, [editor, model.html, model.activeTabId]);
  useEffect(() => { if (editor) editor.view.dispatch(editor.state.tr.setMeta('docsLayoutRefresh', true).setMeta('addToHistory', false)); }, [editor, page.mode, page.size, page.orientation, page.margin, zoom]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!paperRef.current) return;
    const observer = new ResizeObserver(([entry]) => setPaperHeight(entry.target.offsetHeight));
    observer.observe(paperRef.current);
    return () => observer.disconnect();
  }, [editor]);
  useEffect(() => {
    if (!menu) return;
    const close = (event) => { if (!fileMenuRef.current?.contains(event.target)) setMenu(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  useEffect(() => {
    const shortcuts = (event) => {
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
      if ((isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setFindOpen(true); setTimeout(() => findRef.current?.focus(), 0); }
      if ((isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); actionsRef.current.print?.(); }
      if ((isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'k' && !readOnlyRef.current) { event.preventDefault(); actionsRef.current.openLink?.(); }
      if ((isMac ? event.metaKey : event.ctrlKey) && event.key === '\\' && !readOnlyRef.current) { event.preventDefault(); editorRef.current?.chain().focus().unsetAllMarks().clearNodes().run(); }
      if (event.key === 'Escape') { setMenu(null); setFindOpen(false); setLinkDialog(false); setPageDialog(false); setTextDialog(null); setWritingTool(null); }
    };
    document.addEventListener('keydown', shortcuts);
    return () => document.removeEventListener('keydown', shortcuts);
  }, []);

  const importFile = useCallback(async (file) => {
    if (readOnlyRef.current || !editorRef.current) return;
    if (!file) { fileInput.current?.click(); return; }
    if (file.size > 15 * 1024 * 1024) return inform('Choose a document smaller than 15 MB.');
    try {
      let html, importedPage, warnings = [];
      if (/\.docx$/i.test(file.name)) {
        const imported = await importDocx(file);
        html = sanitizeHtml(imported.html); importedPage = imported.page; warnings = imported.warnings || [];
      } else if (/\.md$/i.test(file.name) || file.type === 'text/markdown') {
        const imported = markdownToHtml(await file.text()); html = imported.html; warnings = imported.warnings;
      } else {
        const text = await file.text();
        html = /\.html?$/i.test(file.name) || file.type === 'text/html'
          ? sanitizeHtml(text)
          : text.split(/\n\s*\n/).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
      }
      if (!readOnlyRef.current) {
        editorRef.current.commands.setContent(html || '<p></p>', { emitUpdate: false });
        publish(updateActiveDocument(contentRef.current, { html: editorRef.current.getHTML(), page: importedPage }));
        setRevision((number) => number + 1);
        inform(`Imported ${file.name}.${warnings.length ? ` ${warnings.join(' ')}` : ''}`);
      }
    } catch (error) { inform(error.message || 'This file could not be opened. Import a Word, text, or HTML file.'); }
  }, [inform]);

  const exportHtml = useCallback((all = false) => {
    const current = editorRef.current;
    if (current) downloadDocument('document.html', documentHtml(all ? allDocumentTabsHtml(updateActiveDocument(contentRef.current, { html: current.getHTML() })) : current.getHTML(), contentRef.current.page), 'text/html;charset=utf-8');
  }, []);
  const exportText = useCallback(() => {
    const current = editorRef.current;
    if (current) downloadDocument('document.txt', current.getText({ blockSeparator: '\n\n' }), 'text/plain;charset=utf-8');
  }, []);
  const exportMarkdown = useCallback(() => {
    const current = editorRef.current;
    if (current) { downloadDocument('document.md', htmlToMarkdown(current.getHTML()), 'text/markdown;charset=utf-8'); inform('Markdown exported. Page layout, fonts, image wrapping, and review metadata are not represented by Markdown.'); }
  }, [inform]);
  const exportDocx = useCallback((all = false) => {
    try {
      const current = editorRef.current;
      if (current) { downloadDocument('document.docx', createDocx(all ? allDocumentTabsHtml(updateActiveDocument(contentRef.current, { html: current.getHTML() })) : current.getHTML(), contentRef.current.page), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); if (all) inform('All tabs exported with the active tab’s page settings. Pending suggestions are exported as visible text, without review metadata.'); else if (collectSuggestions(current.state.doc).length) inform('Pending suggestions are exported as visible text, without review metadata.'); }
    } catch { inform('The Word export could not be created. HTML export preserves the document formatting.'); }
  }, [inform]);
  const print = useCallback((all = false) => {
    const current = editorRef.current;
    if (!current) return;
    const frame = document.createElement('iframe');
    frame.className = 'docs-print-frame';
    frame.title = 'Document print preview';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(frame);
    frame.onload = async () => {
      try {
        await Promise.all([...frame.contentDocument.images].map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; })));
        await frame.contentDocument.fonts?.ready;
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(() => frame.remove(), 60000);
      } catch { frame.remove(); inform('Print preview could not be opened. Export HTML to print this document.'); }
    };
    frame.srcdoc = documentHtml(all ? allDocumentTabsHtml(updateActiveDocument(contentRef.current, { html: current.getHTML() })) : current.getHTML(), contentRef.current.page);
  }, [inform]);
  useEffect(() => {
    if (editor) onReady?.({ exportHtml, exportText, exportDocx, exportMarkdown, print, importFile, getHtml: () => editor.getHTML(), getText: () => editor.getText(), insertLinkedSheet: (snapshot) => { if (readOnlyRef.current) throw new Error('This document is read-only.'); return insertLinkedSheet(editor, snapshot); }, refreshLinkedSheets: async (resolve) => { if (readOnlyRef.current) throw new Error('This document is read-only.'); return refreshLinkedSheets(editor, resolve); } });
  }, [editor, onReady, exportHtml, exportText, exportDocx, exportMarkdown, print, importFile]);

  let matches = [], findError = '';
  try { matches = editor ? searchDocument(editor.state.doc, query, { matchCase, wholeWord, regex: regexSearch }) : []; } catch (error) { findError = error.message; }
  const outline = getOutline(editor);
  const words = editor?.getText().trim().match(/\S+/g)?.length || 0;
  const characters = editor?.getText().length || 0;
  const selection = editor?.state.selection;
  const selectedWords = selection && !selection.empty ? editor.state.doc.textBetween(selection.from, selection.to, ' ').trim().match(/\S+/g)?.length || 0 : 0;
  const suggestions = editor ? collectSuggestions(editor.state.doc) : [];
  const footnotes = editor ? documentFootnotes(editor.state.doc) : [];
  const pages = editor ? paginationKey.getState(editor.state)?.pages || 1 : 1;
  const blockType = editor?.isActive('heading') ? `h${editor.getAttributes('heading').level}` : 'paragraph';
  const headingSizes = { 1: 26, 2: 20, 3: 16, 4: 14, 5: 12, 6: 12 };
  const fontSize = editor?.getAttributes('textStyle').fontSize || `${headingSizes[editor?.getAttributes('heading').level] || 11}pt`;
  const fontSizePoints = parseFloat(fontSize) * (fontSize.endsWith('px') ? 0.75 : 1);
  const fontFamily = (editor?.getAttributes('textStyle').fontFamily || 'Arial').split(',')[0].replace(/["']/g, '').trim();

  const run = (action) => { if (!readOnly && editor) action(editor.chain().focus()).run(); setMenu(null); };
  const jumpMatch = (index) => {
    if (!matches.length || !editor) return;
    const next = ((index % matches.length) + matches.length) % matches.length;
    setMatchIndex(next);
    editor.chain().setTextSelection(matches[next]).scrollIntoView().run();
  };
  const replaceMatch = (all) => {
    if (readOnly || !editor || !matches.length) return;
    const transaction = editor.state.tr;
    if (all) [...matches].reverse().forEach((match) => transaction.insertText(regexSearch ? expandReplacement(replacement, match) : replacement, match.from, match.to));
    else {
      const current = matches[Math.min(matchIndex, matches.length - 1)];
      transaction.insertText(regexSearch ? expandReplacement(replacement, current) : replacement, current.from, current.to);
    }
    editor.view.dispatch(transaction);
    inform(all ? `Replaced ${matches.length} occurrence${matches.length === 1 ? '' : 's'}.` : 'Replaced one occurrence.');
    setMatchIndex(0);
  };
  const openLink = () => { setLinkUrl(editor?.getAttributes('link').href || ''); setLinkDialog(true); setMenu(null); };
  actionsRef.current = { print, openLink };
  const saveLink = (event) => {
    event.preventDefault();
    let url = linkUrl.trim();
    if (url && !url.startsWith('#') && !/^[a-z][a-z\d+.-]*:/i.test(url)) url = `https://${url}`;
    if (url && !/^(https?:|mailto:|tel:|#[a-zA-Z0-9_-]+$)/i.test(url)) return inform('Use an https, email, telephone, or bookmark link.');
    if (!readOnly && editor) {
      const chain = editor.chain().focus().extendMarkRange('link');
      if (url) chain.setLink({ href: url }).run(); else chain.unsetLink().run();
    }
    setLinkDialog(false);
  };
  const showPageSetup = () => { setPageDraft(page); setPageDialog(true); setMenu(null); };
  const savePage = (event) => {
    event.preventDefault();
    if (!readOnly) publish(updateActiveDocument(contentRef.current, { html: editor?.getHTML() || '', page: pageDraft }));
    setPageDialog(false);
  };
  const toggleMenu = (name) => setMenu((previous) => previous === name ? null : name);
  const openWritingTool = (name) => { setWritingTool(name); setMenu(null); };
  const rotateImage = async () => {
    if (readOnly || !editor.isActive('image')) return;
    const before = editor.state.doc, pos = editor.state.selection.from, attrs = editor.getAttributes('image');
    try { const image = await transformImage(attrs.src, { type: 'rotate' }); if (readOnlyRef.current || editor.state.doc !== before) return inform('Document changed. Select the image and try again.'); const oldWidth = Number(attrs.width) || 480, oldHeight = Number(attrs.height) || oldWidth * image.width / image.height; editor.chain().focus().setNodeSelection(pos).updateAttributes('image', { src: image.src, width: oldHeight, height: oldWidth }).run(); inform('Image rotated. Animated images become a still PNG.'); } catch (error) { inform(error.message); }
  };
  const tabAction = (operation) => {
    if (operation.type === 'select' && readOnly) { setViewTabId(operation.id); return; }
    if (readOnly) return;
    if (operation.type !== 'select' && editingMode === 'suggesting') return inform('Switch to Editing mode to change document tabs.');
    const current = updateActiveDocument(contentRef.current, { html: editor?.getHTML() || contentRef.current.html });
    publish(changeDocumentTab(current, operation));
  };
  const review = (accept, id) => { if (!readOnly) { reviewSuggestions(editor, accept, id); inform(accept ? 'Suggestion accepted.' : 'Suggestion rejected.'); } };
  const saveTextDialog = (event) => {
    event.preventDefault();
    if (!readOnly && textDialog.value.trim()) {
      if (textDialog.type === 'rename') tabAction({ type: 'rename', id: textDialog.id, name: textDialog.value });
      else if (textDialog.type === 'footnote-edit') editor.chain().focus().setNodeSelection(textDialog.pos).updateAttributes('footnote', { text: textDialog.value.trim() }).run();
      else editor.chain().focus().insertFootnote(textDialog.value.trim()).run();
    }
    setTextDialog(null);
  };
  const menuItem = (label, action, shortcut, disabled = false) => <button key={label} type="button" role="menuitem" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => { action(); setMenu(null); }}><span>{label}</span>{shortcut && <span className="docs-shortcut">{shortcut}</span>}</button>;
  const menuItems = {
    File: <>{menuItem('Import Word, Markdown, text, or HTML…', () => fileInput.current?.click(), null, readOnly)}<div className="docs-menu-separator" />{menuItem('Download as Word (.docx)', () => exportDocx())}{menuItem('Download as HTML (.html)', () => exportHtml())}{menuItem('Download as Markdown (.md)', exportMarkdown)}{menuItem('Download as plain text (.txt)', exportText)}{model.tabs.length > 1 && <>{menuItem('Download all tabs as Word', () => exportDocx(true))}{menuItem('Download all tabs as HTML', () => exportHtml(true))}{menuItem('Print all tabs', () => print(true))}</>}<div className="docs-menu-separator" />{menuItem('Page setup…', showPageSetup, null, readOnly)}{menuItem('Print / Save as PDF', print, '⌘ P')}</>,
    Edit: <>{menuItem('Undo', () => editor?.chain().focus().undo().run(), '⌘ Z', readOnly || !editor?.can().undo())}{menuItem('Redo', () => editor?.chain().focus().redo().run(), '⇧ ⌘ Z', readOnly || !editor?.can().redo())}<div className="docs-menu-separator" />{menuItem('Select all', () => editor?.chain().focus().selectAll().run(), '⌘ A')}{menuItem('Find and replace…', () => { setFindOpen(true); setTimeout(() => findRef.current?.focus(), 0); }, '⌘ F')}</>,
    View: <>{menuItem(`${outlineOpen ? 'Hide' : 'Show'} document outline`, () => setOutlineOpen(!outlineOpen))}{menuItem('Review suggestions', () => setReviewOpen(!reviewOpen))}{menuItem(pageless ? 'Switch to pages' : 'Switch to pageless', () => { if (!readOnly) publish(updateActiveDocument(contentRef.current, { page: { mode: pageless ? 'pages' : 'pageless' } })); }, null, readOnly)}{menuItem('Zoom to 100%', () => setZoom(100))}{menuItem('Zoom to 75%', () => setZoom(75))}{menuItem('Zoom to 125%', () => setZoom(125))}</>,
    Insert: <>{menuItem('Document tab', () => tabAction({ type: 'add' }), null, readOnly || editingMode === 'suggesting' || model.tabs.length >= 100)}{menuItem('Image from computer…', () => imageInput.current?.click(), null, readOnly)}{menuItem('Table…', () => setTimeout(() => setMenu('Table'), 0), null, readOnly)}{menuItem('Link…', openLink, '⌘ K', readOnly)}{menuItem('Checklist', () => run((chain) => chain.toggleTaskList()), null, readOnly)}{menuItem('Footnote…', () => setTextDialog({ type: 'footnote', title: 'Insert footnote', value: '' }), null, readOnly)}{menuItem('Table of contents', () => run((chain) => chain.insertContent({ type: 'tableOfContents' })), null, readOnly)}<div className="docs-menu-separator" />{menuItem('Horizontal line', () => run((chain) => chain.setHorizontalRule()), null, readOnly)}{menuItem('Page break', () => run((chain) => chain.insertContent({ type: 'pageBreak' })), null, readOnly || pageless)}{menuItem('Header, footer, and page numbers…', showPageSetup, null, readOnly)}</>,
    Format: <>{menuItem('Bold', () => run((chain) => chain.toggleBold()), '⌘ B', readOnly)}{menuItem('Italic', () => run((chain) => chain.toggleItalic()), '⌘ I', readOnly)}{menuItem('Underline', () => run((chain) => chain.toggleUnderline()), '⌘ U', readOnly)}{menuItem('Strikethrough', () => run((chain) => chain.toggleStrike()), null, readOnly)}{menuItem('Superscript', () => run((chain) => chain.toggleSuperscript()), '⌘ .', readOnly)}{menuItem('Subscript', () => run((chain) => chain.toggleSubscript()), '⌘ ,', readOnly)}<div className="docs-menu-separator" />{menuItem('Increase indent', () => run((chain) => chain.indentParagraph()), '⌘ ]', readOnly)}{menuItem('Decrease indent', () => run((chain) => chain.outdentParagraph()), '⌘ [', readOnly)}{menuItem('Block quote', () => run((chain) => chain.toggleBlockquote()), null, readOnly)}{menuItem('Code block', () => run((chain) => chain.toggleCodeBlock()), null, readOnly)}{menuItem('Clear formatting', () => run((chain) => chain.unsetAllMarks().clearNodes()), '⌘ \\', readOnly)}</>,
    Tools: <>{menuItem('Find and replace…', () => { setFindOpen(true); setTimeout(() => findRef.current?.focus(), 0); }, '⌘ F')}{menuItem('Word count', () => inform(`${words.toLocaleString()} words · ${characters.toLocaleString()} characters${selectedWords ? ` · ${selectedWords} selected words` : ''}`))}{menuItem('Spelling', () => inform('Browser spelling is enabled. Right-click an underlined word to see suggestions.'))}</>,
    Writing: <>{[['painter', 'Format painter…'], ['case', 'Change text case…'], ['paragraph', 'Paragraph borders, spacing, and direction…'], ['columns', 'Column section…'], ['sort', 'Sort paragraphs…'], ['bookmark', 'Bookmarks and internal links…'], ['equation', 'Insert or edit equation…'], ['characters', 'Special characters…'], ['citations', 'Citations and bibliography…'], ['search', 'Search all tabs…']].map(([key, label]) => menuItem(label, () => openWritingTool(key), null, readOnly && key !== 'search'))}</>,
  };

  if (!editor) return <div className="docs-loading">Opening your document…</div>;

  return <div className={`docs-editor ${readOnly ? 'docs-read-only' : ''}`} data-revision={revision}>
    <div className="docs-menu-bar" ref={fileMenuRef}>
      <div className="docs-menus" role="menubar" aria-label="Document menus">
        {Object.keys(menuItems).map((name) => <div key={name} className="docs-menu-wrap"><button type="button" role="menuitem" className={menu === name ? 'is-open' : ''} aria-haspopup="menu" aria-expanded={menu === name} onClick={() => toggleMenu(name)}>{name}</button>{menu === name && <div role="menu" className="docs-dropdown">{menuItems[name]}</div>}</div>)}
      </div>
      <div className="docs-mode-controls"><button type="button" className="docs-review-toggle" onClick={() => setReviewOpen(!reviewOpen)} aria-expanded={reviewOpen}>Suggestions{suggestions.length ? ' (' + suggestions.length + ')' : ''}</button><label className="docs-editing-mode"><span className={readOnly ? 'is-viewing' : editingMode === 'suggesting' ? 'is-suggesting' : ''} /><select aria-label="Editing mode" disabled={readOnly} value={readOnly ? 'viewing' : editingMode} onChange={(event) => { setEditingMode(event.target.value); if (event.target.value === 'suggesting') setReviewOpen(true); }}><option value="editing">Editing</option><option value="suggesting">Suggesting</option>{readOnly && <option value="viewing">Viewing</option>}</select></label></div>
      {menu === 'Table' && <div role="menu" className="docs-dropdown docs-table-menu"><strong>Insert a table</strong><div className="docs-table-size"><label>Rows<input type="number" min="1" max="20" value={tableRows} onChange={(event) => setTableRows(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label><span>×</span><label>Columns<input type="number" min="1" max="12" value={tableCols} onChange={(event) => setTableCols(Math.max(1, Math.min(12, Number(event.target.value) || 1)))} /></label></div><button className="docs-primary" type="button" disabled={readOnly} onClick={() => run((chain) => chain.insertTable({ rows: tableRows, cols: tableCols, withHeaderRow: true }))}>Insert table</button></div>}
    </div>
    <div className="docs-toolbar" role="toolbar" aria-label="Text formatting">
      <ToolButton icon={Undo2} label="Undo (⌘ Z)" disabled={readOnly || !editor.can().undo()} onClick={() => run((chain) => chain.undo())} />
      <ToolButton icon={Redo2} label="Redo (⇧ ⌘ Z)" disabled={readOnly || !editor.can().redo()} onClick={() => run((chain) => chain.redo())} />
      <ToolButton icon={Printer} label="Print / Save as PDF" onClick={() => print()} />
      <span className="docs-toolbar-divider" />
      <label className="docs-select docs-zoom-select"><span className="sr-only">Zoom</span><select aria-label="Zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>{[50, 75, 90, 100, 110, 125, 150].map((value) => <option key={value} value={value}>{value}%</option>)}</select><ChevronDown size={13} /></label>
      <span className="docs-toolbar-divider" />
      <label className="docs-select docs-style-select"><span className="sr-only">Paragraph style</span><select aria-label="Paragraph style" disabled={readOnly} value={blockType} onChange={(event) => run((chain) => event.target.value === 'paragraph' ? chain.setParagraph() : chain.setHeading({ level: Number(event.target.value.slice(1)) }))}><option value="paragraph">Normal text</option>{[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={`h${level}`}>Heading {level}</option>)}</select><ChevronDown size={13} /></label>
      <span className="docs-toolbar-divider" />
      <label className="docs-select docs-font-select"><span className="sr-only">Font</span><select aria-label="Font" disabled={readOnly} value={fontFamily} onChange={(event) => run((chain) => chain.setMark('textStyle', { fontFamily: event.target.value }))}>{fontOptions.map((font) => <option key={font} value={font}>{font}</option>)}{!fontOptions.includes(fontFamily) && <option value={fontFamily}>{fontFamily}</option>}</select><ChevronDown size={13} /></label>
      <div className="docs-size-control"><ToolButton icon={Minus} label="Decrease font size" disabled={readOnly} onClick={() => run((chain) => chain.setMark('textStyle', { fontSize: `${Math.max(6, Math.round(fontSizePoints) - 1)}pt` }))} /><select aria-label="Font size" disabled={readOnly} value={fontSize} onChange={(event) => run((chain) => chain.setMark('textStyle', { fontSize: event.target.value }))}>{fontSizes.map((size) => <option key={size} value={`${size}pt`}>{size}</option>)}{!fontSizes.some((size) => `${size}pt` === fontSize) && <option value={fontSize}>{fontSizePoints}</option>}</select><ToolButton icon={Plus} label="Increase font size" disabled={readOnly} onClick={() => run((chain) => chain.setMark('textStyle', { fontSize: `${Math.min(144, Math.round(fontSizePoints) + 1)}pt` }))} /></div>
      <span className="docs-toolbar-divider" />
      <ToolButton icon={Bold} label="Bold (⌘ B)" active={editor.isActive('bold')} disabled={readOnly} onClick={() => run((chain) => chain.toggleBold())} />
      <ToolButton icon={Italic} label="Italic (⌘ I)" active={editor.isActive('italic')} disabled={readOnly} onClick={() => run((chain) => chain.toggleItalic())} />
      <ToolButton icon={Underline} label="Underline (⌘ U)" active={editor.isActive('underline')} disabled={readOnly} onClick={() => run((chain) => chain.toggleUnderline())} />
      <ToolButton icon={Strikethrough} label="Strikethrough" active={editor.isActive('strike')} disabled={readOnly} onClick={() => run((chain) => chain.toggleStrike())} />
      <label className="docs-color-picker" title="Text color"><span className="docs-color-letter">A</span><span className="docs-color-swatch" style={{ background: editor.getAttributes('textStyle').color || '#202124' }} /><input aria-label="Text color" disabled={readOnly} type="color" value={colorInput(editor.getAttributes('textStyle').color, '#202124')} onChange={(event) => run((chain) => chain.setColor(event.target.value))} /></label>
      <label className="docs-color-picker" title="Highlight color"><Highlighter size={17} /><span className="docs-color-swatch" style={{ background: editor.getAttributes('highlight').color || '#ffe88b' }} /><input aria-label="Highlight color" disabled={readOnly} type="color" value={colorInput(editor.getAttributes('highlight').color, '#ffe88b')} onChange={(event) => run((chain) => chain.setHighlight({ color: event.target.value }))} /></label>
      <span className="docs-toolbar-divider" />
      <ToolButton icon={Link2} label="Insert link" active={editor.isActive('link')} disabled={readOnly} onClick={openLink} />
      <ToolButton icon={ImagePlus} label="Insert image" disabled={readOnly} onClick={() => imageInput.current?.click()} />
      <ToolButton icon={Table2} label="Insert table" disabled={readOnly} onClick={() => toggleMenu('Table')} />
      <span className="docs-toolbar-divider" />
      {[['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify]].map(([alignment, Icon]) => <ToolButton key={alignment} icon={Icon} label={`Align ${alignment}`} active={editor.isActive({ textAlign: alignment })} disabled={readOnly} onClick={() => run((chain) => chain.setTextAlign(alignment))} />)}
      <span className="docs-toolbar-divider" />
      <ToolButton icon={List} label="Bulleted list" active={editor.isActive('bulletList')} disabled={readOnly} onClick={() => run((chain) => chain.toggleBulletList())} />
      <ToolButton icon={ListOrdered} label="Numbered list" active={editor.isActive('orderedList')} disabled={readOnly} onClick={() => run((chain) => chain.toggleOrderedList())} />
      <ToolButton label="Checklist" active={editor.isActive('taskList')} disabled={readOnly} onClick={() => run((chain) => chain.toggleTaskList())}>☑</ToolButton>
      <label className="docs-select"><select aria-label="Line spacing" disabled={readOnly} value={editor.getAttributes(blockType.startsWith('h') ? 'heading' : 'paragraph').lineHeight || '1.55'} onChange={(event) => run((chain) => chain.setParagraphSpacing(event.target.value))}>{[['1', 'Single'], ['1.15', '1.15'], ['1.55', 'Normal'], ['1.5', '1.5'], ['2', 'Double']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <ToolButton icon={RemoveFormatting} label="Clear formatting" disabled={readOnly} onClick={() => run((chain) => chain.unsetAllMarks().clearNodes())} />
    </div>
    {editor.isActive('image') && <div className="docs-table-actions" role="toolbar" aria-label="Image options"><ImagePlus size={14} /><strong>Image</strong><label>Width <input aria-label="Image width" disabled={readOnly} type="number" min="40" max="1600" value={editor.getAttributes('image').width || 480} onChange={(event) => { const width = Math.max(40, Math.min(1600, Number(event.target.value) || 40)); const attrs = editor.getAttributes('image'); run((chain) => chain.updateAttributes('image', { width, height: attrs.height && attrs.width ? Math.round(attrs.height * width / attrs.width) : null })); }} /></label><label>Wrapping <select aria-label="Image wrapping" disabled={readOnly} value={editor.getAttributes('image').wrap || 'inline'} onChange={(event) => run((chain) => chain.updateAttributes('image', { wrap: event.target.value }))}><option value="inline">Inline</option><option value="left">Wrap left</option><option value="right">Wrap right</option><option value="break">Break text</option></select></label><button type="button" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => run((chain) => chain.deleteSelection())}>Delete image</button></div>}
    {editor.isActive('table') && <div className="docs-table-actions" role="toolbar" aria-label="Table actions"><Table2 size={14} /><span>Table</span>{[['Add row above', 'addRowBefore'], ['Add row below', 'addRowAfter'], ['Add column left', 'addColumnBefore'], ['Add column right', 'addColumnAfter'], ['Delete row', 'deleteRow'], ['Delete column', 'deleteColumn'], ['Toggle header', 'toggleHeaderRow'], ['Merge cells', 'mergeCells'], ['Split cell', 'splitCell'], ['Delete table', 'deleteTable']].map(([label, command]) => <button key={command} type="button" disabled={readOnly || !editor.can()[command]()} onMouseDown={(event) => event.preventDefault()} onClick={() => run((chain) => chain[command]())}>{label}</button>)}</div>}
    {editor.isActive('image') && <div className="docs-image-edit-actions" role="toolbar" aria-label="Image editing"><button type="button" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => openWritingTool('crop')}>Crop image…</button><button type="button" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={rotateImage}>Rotate 90°</button><button type="button" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => { replaceImageRef.current = { pos: editor.state.selection.from, attrs: editor.getAttributes('image'), doc: editor.state.doc }; imageInput.current?.click(); }}>Replace image…</button></div>}
    {findOpen && <div className="docs-find-options"><label><input type="checkbox" checked={wholeWord} onChange={(event) => { setWholeWord(event.target.checked); setMatchIndex(0); }} />Whole words</label><label><input type="checkbox" checked={regexSearch} onChange={(event) => { setRegexSearch(event.target.checked); setMatchIndex(0); }} />Regular expression</label><button type="button" onClick={() => openWritingTool('search')}>Search all tabs…</button>{findError && <span role="alert">{findError}</span>}</div>}
    {findOpen && <div className="docs-find-panel"><div className="docs-find-row"><Search size={17} /><input ref={findRef} aria-label="Find in document" placeholder="Find in document" value={query} onChange={(event) => { setQuery(event.target.value); setMatchIndex(0); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); jumpMatch(matchIndex + (event.shiftKey ? -1 : 1)); } }} /><span className="docs-match-count">{matches.length ? `${Math.min(matchIndex + 1, matches.length)} of ${matches.length}` : query ? 'No results' : ''}</span><ToolButton icon={ChevronLeft} label="Previous match" disabled={!matches.length} onClick={() => jumpMatch(matchIndex - 1)} /><ToolButton icon={ChevronRight} label="Next match" disabled={!matches.length} onClick={() => jumpMatch(matchIndex + 1)} /><ToolButton icon={X} label="Close find" onClick={() => setFindOpen(false)} /></div><div className="docs-find-row"><input aria-label="Replace with" placeholder="Replace with" value={replacement} disabled={readOnly} onChange={(event) => setReplacement(event.target.value)} /><button type="button" disabled={readOnly || !matches.length} onClick={() => replaceMatch(false)}>Replace</button><button type="button" disabled={readOnly || !matches.length} onClick={() => replaceMatch(true)}>Replace all</button><label className="docs-case-option"><input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />Match case</label></div></div>}
    <div className="docs-workspace">
      <aside className={'docs-outline ' + (outlineOpen ? '' : 'is-collapsed')} aria-label="Document tabs and outline"><button className="docs-outline-toggle" type="button" title={outlineOpen ? 'Hide outline' : 'Show outline'} aria-label={outlineOpen ? 'Hide outline' : 'Show outline'} onClick={() => setOutlineOpen(!outlineOpen)}><PanelLeft size={18} /></button>{outlineOpen && <>
        <div className="docs-tabs-heading"><span>DOCUMENT TABS</span><ToolButton icon={Plus} label="Add document tab" disabled={readOnly || editingMode === "suggesting" || model.tabs.length >= 100} onClick={() => tabAction({ type: 'add' })} /></div>
        <div className="docs-tab-quick-actions" aria-label="Active tab actions"><button type="button" disabled={readOnly || editingMode === 'suggesting' || model.tabs.length >= 100} onClick={() => tabAction({ type: 'duplicate', id: model.activeTabId })}>Duplicate tab</button><button type="button" disabled={readOnly || editingMode === 'suggesting' || tabDepth(model.tabs, model.activeTabId) >= 2} onClick={() => tabAction({ type: 'indent', id: model.activeTabId })}>Nest →</button><button type="button" disabled={readOnly || editingMode === 'suggesting' || !model.tabs.find((tab) => tab.id === model.activeTabId)?.parentId} onClick={() => tabAction({ type: 'outdent', id: model.activeTabId })}>← Unnest</button></div>
        <div className="docs-document-tabs" role="tablist" aria-label="Document tabs">{model.tabs.map((tab, index) => <div key={tab.id} style={{ marginLeft: tabDepth(model.tabs, tab.id) * 14 }} data-depth={tabDepth(model.tabs, tab.id)} className={'docs-document-tab ' + (model.activeTabId === tab.id ? 'is-active' : '')}><button type="button" role="tab" aria-selected={model.activeTabId === tab.id} onClick={() => tabAction({ type: 'select', id: tab.id })}><FileText size={14} /><span>{tab.name}</span></button><details><summary aria-label={'Options for ' + tab.name}><ChevronDown size={13} /></summary><div className="docs-tab-options"><button type="button" disabled={readOnly || editingMode === "suggesting"} onClick={() => setTextDialog({ type: 'rename', title: 'Rename tab', id: tab.id, value: tab.name })}>Rename</button><button type="button" disabled={readOnly || editingMode === "suggesting" || index === 0} onClick={() => tabAction({ type: 'move', id: tab.id, direction: -1 })}>Move up</button><button type="button" disabled={readOnly || editingMode === "suggesting" || index === model.tabs.length - 1} onClick={() => tabAction({ type: 'move', id: tab.id, direction: 1 })}>Move down</button><button type="button" disabled={readOnly || editingMode === "suggesting" || model.tabs.length === 1} onClick={() => setTextDialog({ type: 'delete-tab', title: 'Delete tab?', id: tab.id, value: tab.name })}>Delete</button></div></details></div>)}</div>
        <div className="docs-outline-label">DOCUMENT OUTLINE</div>{outline.length ? <nav>{outline.map((heading, index) => <button type="button" key={heading.position + '-' + index} style={{ paddingLeft: 16 + (heading.level - 1) * 12 }} onClick={() => editor.chain().setTextSelection(heading.position + 1).focus().scrollIntoView().run()}>{heading.text}</button>)}</nav> : <div className="docs-outline-empty">Headings you add to your document appear here.</div>}<div className="docs-outline-tip"><FileText size={15} /><span>A little space for your next big idea.</span></div></>}</aside>
      <div className={'docs-canvas ' + (pageless ? 'is-pageless' : '')} onClick={(event) => { if (event.target === event.currentTarget) editor.commands.focus('end'); }}>
        <div className={'docs-page-stage ' + (pageless ? 'is-pageless' : '')} style={pageless ? { width: '100%', maxWidth: 1200 * zoom / 100, minHeight: paperHeight * zoom / 100 + 34 } : { width: pageWidth * zoom / 100, minHeight: Math.max(pageHeight, paperHeight) * zoom / 100 + 34 }}>
          {!pageless && <div className="docs-ruler" style={{ width: pageWidth, transform: 'scale(' + zoom / 100 + ')' }} aria-hidden="true"><div className="docs-ruler-margin" style={{ width: margin }} /><div className="docs-ruler-numbers">{Array.from({ length: Math.floor((pageWidth - margin * 2) / 48) + 1 }, (_, index) => <span key={index}>{index % 2 === 0 ? index / 2 : ''}</span>)}</div><div className="docs-ruler-margin" style={{ width: margin }} /></div>}
          <div ref={paperRef} className={'docs-paper ' + (pageless ? 'is-pageless' : '')} style={{ width: pageless ? '100%' : pageWidth, minHeight: pageless ? 600 : pages * pageHeight + (pages - 1) * 24, padding: pageless ? '48px 56px' : margin, transform: 'scale(' + zoom / 100 + ')', '--docs-page-height': pageHeight + 'px', '--docs-page-cycle': pageHeight + 24 + 'px', '--docs-content-height': pageHeight - margin * 2 + 'px' }}>
            {!pageless && Array.from({ length: pages }, (_, index) => <React.Fragment key={index}>{page.header && <div className="docs-page-header" style={{ left: margin, right: margin, top: index * (pageHeight + 24) + 30 }}>{page.header}</div>}{(page.footer || page.pageNumbers) && <div className="docs-page-footer" style={{ left: margin, right: margin, bottom: 'auto', top: index * (pageHeight + 24) + pageHeight - 40 }}><span>{page.footer}</span>{page.pageNumbers && <span>Page {index + 1}</span>}</div>}</React.Fragment>)}
            <EditorContent editor={editor} />
            {footnotes.length > 0 && <section className="docs-footnotes" aria-label="Footnotes"><h3>Footnotes</h3><ol>{footnotes.map((note) => <li id={'fn-' + note.id} key={note.id}><a href={'#fnref-' + note.id} aria-label={'Back to footnote ' + note.number}>{note.number}</a><span>{note.text}</span><button type="button" disabled={readOnly} onClick={() => setTextDialog({ type: 'footnote-edit', title: 'Edit footnote', pos: note.pos, value: note.text })}>Edit</button><button type="button" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (!readOnly) editor.chain().focus().deleteRange({ from: note.pos, to: note.pos + 1 }).run(); }}>Remove</button></li>)}</ol></section>}
          </div>
        </div>
      </div>
      {reviewOpen && <aside className="docs-review-panel" aria-label="Suggestions"><div className="docs-review-heading"><h2>Suggestions</h2><ToolButton icon={X} label="Close suggestions" onClick={() => setReviewOpen(false)} /></div><p className="docs-review-intro">Text changes made in Suggesting mode stay in the document until reviewed. Formatting changes apply directly.</p>{suggestions.length > 0 && <div className="docs-review-all"><button disabled={readOnly} type="button" onClick={() => review(true)}>Accept all</button><button disabled={readOnly} type="button" onClick={() => review(false)}>Reject all</button></div>}{suggestions.length ? suggestions.map((suggestion) => <article key={suggestion.id} className="docs-suggestion-card"><button className="docs-suggestion-location" type="button" onClick={() => editor.chain().setTextSelection(suggestion.ranges[0].from).focus().scrollIntoView().run()}>{suggestion.author} suggested a change</button>{suggestion.deleted && <del>{suggestion.deleted}</del>}{suggestion.inserted && <ins>{suggestion.inserted}</ins>}<div><button type="button" disabled={readOnly} onClick={() => review(true, suggestion.id)}>Accept</button><button type="button" disabled={readOnly} onClick={() => review(false, suggestion.id)}>Reject</button></div></article>) : <div className="docs-review-empty">No pending suggestions.</div>}</aside>}
    </div>
    <footer className="docs-status"><span>{selectedWords ? `${selectedWords.toLocaleString()} selected / ` : ''}{words.toLocaleString()} words</span><span className="docs-status-dot">·</span><span>{characters.toLocaleString()} characters</span><span className="docs-status-spacer" /><button type="button" onClick={showPageSetup}>{pageless ? 'Pageless' : (page.size === 'letter' ? 'Letter' : 'A4') + ' · ' + pages + (pages === 1 ? ' page' : ' pages')}</button><span className="docs-status-dot">·</span><span>{readOnly ? 'View only' : editingMode === 'suggesting' ? 'Suggesting · local' : 'Local document'}</span></footer>
    {notice && <div className="docs-notice" role="status">{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {linkDialog && <div className="docs-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLinkDialog(false); }}><form className="docs-modal" role="dialog" aria-modal="true" aria-labelledby="docs-link-title" onSubmit={saveLink}><div className="docs-modal-heading"><h2 id="docs-link-title">Insert link</h2><ToolButton icon={X} label="Close link dialog" onClick={() => setLinkDialog(false)} /></div><label>Link address<input autoFocus type="text" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://example.com" /></label><div className="docs-modal-actions"><button type="button" disabled={readOnly} onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setLinkDialog(false); }}>Remove link</button><button className="docs-primary" disabled={readOnly} type="submit">Apply</button></div></form></div>}
    {pageDialog && <div className="docs-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPageDialog(false); setTextDialog(null); }}><form className="docs-modal" role="dialog" aria-modal="true" aria-labelledby="docs-page-title" onSubmit={savePage}><div className="docs-modal-heading"><h2 id="docs-page-title">Page setup</h2><ToolButton icon={X} label="Close page setup" onClick={() => setPageDialog(false)} /></div><label>Layout<select disabled={readOnly} value={pageDraft.mode || "pages"} onChange={(event) => setPageDraft({ ...pageDraft, mode: event.target.value })}><option value="pages">Pages</option><option value="pageless">Pageless</option></select></label><label>Paper size<select disabled={readOnly} value={pageDraft.size} onChange={(event) => setPageDraft({ ...pageDraft, size: event.target.value })}><option value="a4">A4 (21 × 29.7 cm)</option><option value="letter">Letter (8.5 × 11 in)</option></select></label><label>Orientation<select disabled={readOnly} value={pageDraft.orientation} onChange={(event) => setPageDraft({ ...pageDraft, orientation: event.target.value })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label><label>Margins<select disabled={readOnly} value={pageDraft.margin} onChange={(event) => setPageDraft({ ...pageDraft, margin: Number(event.target.value) })}><option value="48">Narrow (½ inch)</option><option value="72">Normal (¾ inch)</option><option value="96">Wide (1 inch)</option></select></label><div className="docs-modal-divider" /><label>Header<input disabled={readOnly} maxLength={200} value={pageDraft.header || ''} placeholder="Optional header text" onChange={(event) => setPageDraft({ ...pageDraft, header: event.target.value })} /></label><label>Footer<input disabled={readOnly} maxLength={200} value={pageDraft.footer || ''} placeholder="Optional footer text" onChange={(event) => setPageDraft({ ...pageDraft, footer: event.target.value })} /></label><label className="docs-modal-check"><input type="checkbox" disabled={readOnly} checked={Boolean(pageDraft.pageNumbers)} onChange={(event) => setPageDraft({ ...pageDraft, pageNumbers: event.target.checked })} />Show page numbers in print and Word export</label><div className="docs-modal-actions"><button type="button" onClick={() => setPageDialog(false)}>Cancel</button><button className="docs-primary" disabled={readOnly} type="submit">Apply</button></div></form></div>}
    {textDialog && <div className="docs-modal-backdrop"><form className="docs-modal" role="dialog" aria-modal="true" aria-labelledby="docs-text-title" onSubmit={saveTextDialog}><div className="docs-modal-heading"><h2 id="docs-text-title">{textDialog.title}</h2><ToolButton icon={X} label="Close dialog" onClick={() => setTextDialog(null)} /></div>{textDialog.type === 'delete-tab' ? <><p>Delete “{textDialog.value}” and its contents? Version history retains earlier saved versions.</p><div className="docs-modal-actions"><button type="button" onClick={() => setTextDialog(null)}>Cancel</button><button className="docs-primary" type="button" disabled={readOnly} onClick={() => { tabAction({ type: 'delete', id: textDialog.id }); setTextDialog(null); }}>Delete tab</button></div></> : <><label>{textDialog.type === 'rename' ? 'Tab name' : 'Footnote text'}<input autoFocus required disabled={readOnly} maxLength={textDialog.type === 'rename' ? 120 : 4000} value={textDialog.value} onChange={(event) => setTextDialog({ ...textDialog, value: event.target.value })} /></label><div className="docs-modal-actions"><button type="button" onClick={() => setTextDialog(null)}>Cancel</button><button className="docs-primary" disabled={readOnly || !textDialog.value.trim()} type="submit">Apply</button></div></>}</form></div>}
    <DocsTools open={writingTool} onClose={() => setWritingTool(null)} editor={editor} model={model} readOnly={readOnly} inform={inform} onTabAction={tabAction} painter={painter} setPainter={setPainter} />
    <input ref={imageInput} className="docs-hidden-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple onCancel={() => { replaceImageRef.current = null; }} onChange={(event) => { insertImages([...event.target.files]); event.target.value = ''; }} />
    <input ref={fileInput} className="docs-hidden-input" type="file" accept=".docx,.txt,.html,.htm,.md,text/plain,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { importFile(event.target.files[0]); event.target.value = ''; }} />
  </div>;
}
