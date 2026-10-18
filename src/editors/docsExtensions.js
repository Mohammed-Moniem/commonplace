import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Mapping, ReplaceStep } from '@tiptap/pm/transform';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Image from '@tiptap/extension-image';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { pageBreakLayout } from './docsModel.js';

export { TaskList, TaskItem };
const uid = () => crypto.randomUUID();
export const suggestionKey = new PluginKey('docsSuggestions');
export const paginationKey = new PluginKey('docsPagination');

const scriptMark = (name, tag, shortcut) => Mark.create({ name, excludes: name === 'superscript' ? 'subscript' : 'superscript', parseHTML: () => [{ tag: tag === 'sup' ? 'sup:not([data-footnote-id])' : tag }], renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0], addCommands() { return { [`toggle${name[0].toUpperCase() + name.slice(1)}`]: () => ({ commands }) => commands.toggleMark(name) }; }, addKeyboardShortcuts() { return { [shortcut]: () => this.editor.commands.toggleMark(name) }; } });
export const Superscript = scriptMark('superscript', 'sup', 'Mod-.');
export const Subscript = scriptMark('subscript', 'sub', 'Mod-,');

export const ParagraphLayout = Extension.create({
  name: 'paragraphLayout',
  addGlobalAttributes() { return [{ types: ['paragraph', 'heading'], attributes: {
    indent: { default: 0, parseHTML: (el) => Math.max(0, Math.min(8, Number(el.dataset.indent) || Math.round(parseFloat(el.style.marginLeft || 0) / 24))), renderHTML: (attrs) => attrs.indent ? { 'data-indent': attrs.indent, style: `margin-left:${attrs.indent * 24}px` } : {} },
    lineHeight: { default: null, parseHTML: (el) => el.style.lineHeight || null, renderHTML: (attrs) => attrs.lineHeight ? { style: `line-height:${attrs.lineHeight}` } : {} },
    headingId: { default: null, parseHTML: (el) => el.id || null, renderHTML: (attrs) => attrs.headingId ? { id: attrs.headingId } : {} },
  } }]; },
  addCommands() {
    const apply = (attribute, value) => ({ state, dispatch, tr }) => { state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => { if (['paragraph', 'heading'].includes(node.type.name)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attribute]: typeof value === 'function' ? value(node.attrs[attribute]) : value }); }); if (dispatch) dispatch(tr); return true; };
    return { indentParagraph: () => apply('indent', (n) => Math.min(8, (n || 0) + 1)), outdentParagraph: () => apply('indent', (n) => Math.max(0, (n || 0) - 1)), setParagraphSpacing: (value) => apply('lineHeight', value) };
  },
  addKeyboardShortcuts() { return { 'Mod-]': () => this.editor.commands.indentParagraph(), 'Mod-[': () => this.editor.commands.outdentParagraph() }; },
});

export const RichImage = Image.extend({
  addAttributes() { return { ...this.parent?.(), wrap: { default: 'inline', parseHTML: (el) => el.dataset.wrap || (el.style.float === 'left' ? 'left' : el.style.float === 'right' ? 'right' : 'inline'), renderHTML: (attrs) => ({ 'data-wrap': attrs.wrap, ...(attrs.wrap === 'left' || attrs.wrap === 'right' ? { style: `float:${attrs.wrap};margin:${attrs.wrap === 'left' ? '0 20px 12px 0' : '0 0 12px 20px'}` } : {}) }) } }; },
});

export const Footnote = Node.create({
  name: 'footnote', group: 'inline', inline: true, atom: true, priority: 1000,
  addAttributes: () => ({ id: { default: null, parseHTML: (el) => el.dataset.footnoteId }, text: { default: '', parseHTML: (el) => el.dataset.footnoteText || '' }, number: { default: 1, parseHTML: (el) => Number(el.dataset.footnoteNumber) || 1 } }),
  parseHTML: () => [{ tag: 'sup[data-footnote-id]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['sup', mergeAttributes(HTMLAttributes, { 'data-footnote-id': node.attrs.id, 'data-footnote-text': node.attrs.text, 'data-footnote-number': node.attrs.number, class: 'docs-footnote-ref', title: node.attrs.text, id: `fnref-${node.attrs.id}` }), ['a', { href: `#fn-${node.attrs.id}`, tabindex: '-1' }, String(node.attrs.number)]],
  addCommands() { return { insertFootnote: (text) => ({ commands }) => commands.insertContent({ type: 'footnote', attrs: { id: uid(), text, number: 1 } }) }; },
});

export const TableOfContents = Node.create({
  name: 'tableOfContents', group: 'block', atom: true,
  addAttributes: () => ({ entries: { default: [], parseHTML: (el) => { try { return JSON.parse(el.dataset.entries || '[]'); } catch { return []; } } } }),
  parseHTML: () => [{ tag: 'nav[data-type="table-of-contents"]' }],
  renderHTML: ({ node }) => ['nav', { 'data-type': 'table-of-contents', 'data-entries': JSON.stringify(node.attrs.entries), class: 'docs-toc', 'aria-label': 'Table of contents' }, ['p', { class: 'docs-toc-title' }, 'Contents'], ['ol', ...node.attrs.entries.map((entry) => ['li', { style: `margin-left:${(entry.level - 1) * 16}px` }, ['a', { href: `#${entry.id}` }, entry.text]])]],
});

export function documentHeadings(doc) { const result = []; doc.descendants((node, pos) => { if (node.type.name === 'heading') result.push({ id: node.attrs.headingId, text: node.textContent || 'Untitled heading', level: node.attrs.level, pos }); }); return result; }
export function documentFootnotes(doc) { const result = []; doc.descendants((node, pos) => { if (node.type.name === 'footnote') result.push({ ...node.attrs, pos }); }); return result; }
export const DocumentStructure = Extension.create({
  name: 'documentStructure',
  addProseMirrorPlugins() { return [new Plugin({ key: new PluginKey('docsStructure'), appendTransaction(transactions, _old, state) {
    if (!transactions.some((tr) => tr.docChanged)) return null;
    const tr = state.tr; let number = 0; const headingIds = new Set(), footnoteIds = new Set();
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') { const id = node.attrs.headingId && !headingIds.has(node.attrs.headingId) ? node.attrs.headingId : `heading-${uid()}`; headingIds.add(id); if (id !== node.attrs.headingId) tr.setNodeMarkup(pos, undefined, { ...node.attrs, headingId: id }); }
      if (node.type.name === 'footnote') { number++; const id = node.attrs.id && !footnoteIds.has(node.attrs.id) ? node.attrs.id : uid(); footnoteIds.add(id); if (node.attrs.number !== number || node.attrs.id !== id) tr.setNodeMarkup(pos, undefined, { ...node.attrs, number, id }); }
    });
    const entries = documentHeadings(tr.doc).map(({ pos, ...entry }) => entry);
    tr.doc.descendants((node, pos) => { if (node.type.name === 'tableOfContents' && JSON.stringify(node.attrs.entries) !== JSON.stringify(entries)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, entries }); });
    return tr.docChanged ? tr.setMeta('docsStructure', true).setMeta('addToHistory', false) : null;
  } })]; },
});

const suggestionMark = (name, kind, tag) => Mark.create({
  name, priority: 1000, inclusive: false, excludes: name === 'suggestionInsert' ? 'suggestionDelete' : 'suggestionInsert',
  addAttributes: () => ({ id: { default: null, parseHTML: (el) => el.dataset.suggestionId }, author: { default: 'You', parseHTML: (el) => el.dataset.author || 'You' } }),
  parseHTML: () => [{ tag: `${tag}[data-suggestion-id]` }],
  renderHTML: ({ HTMLAttributes }) => { const { id, author, ...attributes } = HTMLAttributes; return [tag, mergeAttributes(attributes, { 'data-suggestion-id': id, 'data-suggestion-kind': kind, 'data-author': author, class: `docs-suggestion-${kind}` }), 0]; },
});
export const SuggestionInsert = suggestionMark('suggestionInsert', 'insert', 'ins');
export const SuggestionDelete = suggestionMark('suggestionDelete', 'delete', 'del');

function deletedSuggestionSlice(slice, mark) {
  function transform(fragment) { const children = []; fragment.forEach((node) => { if (node.isInline) { if (node.marks.some((m) => m.type.name === 'suggestionInsert')) return; children.push(node.marks.some((m) => m.type.name === 'suggestionDelete') ? node : node.mark(mark.addToSet(node.marks))); } else children.push(node.copy(transform(node.content))); }); return Fragment.fromArray(children); }
  return new Slice(transform(slice.content), slice.openStart, slice.openEnd);
}

export function collectSuggestions(doc) {
  const groups = new Map();
  doc.descendants((node, pos) => { if (!node.isInline) return; for (const mark of node.marks) if (['suggestionInsert', 'suggestionDelete'].includes(mark.type.name)) {
    const id = mark.attrs.id; if (!groups.has(id)) groups.set(id, { id, author: mark.attrs.author, inserted: '', deleted: '', ranges: [] });
    const group = groups.get(id), kind = mark.type.name === 'suggestionInsert' ? 'insert' : 'delete'; group[kind === 'insert' ? 'inserted' : 'deleted'] += node.isText ? node.text : '[object]'; group.ranges.push({ from: pos, to: pos + node.nodeSize, kind });
  } });
  return [...groups.values()];
}

export function reviewSuggestions(editor, accept, id = null) {
  const groups = collectSuggestions(editor.state.doc).filter((group) => !id || group.id === id);
  const ranges = groups.flatMap((group) => group.ranges).sort((a, b) => b.from - a.from);
  const tr = editor.state.tr.setMeta('docsSuggestionReview', true);
  for (const range of ranges) { if (accept && range.kind === 'delete' || !accept && range.kind === 'insert') tr.delete(range.from, range.to); else tr.removeMark(range.from, range.to, editor.schema.marks[range.kind === 'insert' ? 'suggestionInsert' : 'suggestionDelete']); }
  if (tr.docChanged) editor.view.dispatch(tr);
  return groups.length;
}

export function createSuggesting(getEnabled) {
  return Extension.create({
    name: 'suggesting',
    addProseMirrorPlugins() { return [new Plugin({ key: suggestionKey, appendTransaction(transactions, _oldState, state) {
      if (!getEnabled()) return null;
      if (transactions.some((tr) => tr.getMeta('docsStructure') || tr.getMeta('docsSuggestionReview') || tr.getMeta('docsSuggestAppend') || tr.getMeta('preventUpdate') || isHistoryTransaction(tr))) return null;
      const changes = [];
      transactions.forEach((transaction, transactionIndex) => transaction.steps.forEach((step, stepIndex) => {
        if (!(step instanceof ReplaceStep) || !transaction.docs[stepIndex] || step.from === step.to && !step.slice.size) return;
        const after = new Mapping(); transaction.mapping.maps.slice(stepIndex + 1).forEach((map) => after.appendMap(map)); transactions.slice(transactionIndex + 1).forEach((later) => later.mapping.maps.forEach((map) => after.appendMap(map)));
        const before = transaction.docs[stepIndex], next = step.apply(before).doc;
        if (!next) return;
        // Native input and IME reconciliation may replace an entire text node.
        // Compare ProseMirror fragments for that step so unchanged text retains its marks.
        const start = before.content.findDiffStart(next.content);
        if (start === null) return;
        const end = before.content.findDiffEnd(next.content);
        let removedTo = end?.a ?? start, insertedTo = end?.b ?? start;
        const overlap = start - Math.min(removedTo, insertedTo);
        if (overlap > 0) { removedTo += overlap; insertedTo += overlap; }
        const near = before.resolve(Math.min(start, before.content.size));
        const adjacent = [...(near.nodeBefore?.marks || []), ...(near.nodeAfter?.marks || [])].find((mark) => mark.type.name === 'suggestionInsert');
        changes.push({ from: after.map(start, -1), to: after.map(insertedTo, 1), deleted: before.slice(start, removedTo), id: adjacent?.attrs.id || uid(), insert: insertedTo > start });
      }));
      const tr = state.tr.setMeta('docsSuggestAppend', true);
      for (const change of changes.sort((a, b) => b.from - a.from)) {
        const from = Math.max(0, Math.min(tr.doc.content.size, change.from)), to = Math.max(from, Math.min(tr.doc.content.size, change.to));
        if (to > from) tr.removeMark(from, to, state.schema.marks.suggestionDelete).addMark(from, to, state.schema.marks.suggestionInsert.create({ id: change.id, author: 'You' }));
        if (change.deleted.size) {
          const slice = deletedSuggestionSlice(change.deleted, state.schema.marks.suggestionDelete.create({ id: change.id, author: 'You' }));
          if (slice.size) { tr.replaceRange(from, from, slice); if (!change.insert) tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size)))); }
        }
      }
      return tr.docChanged ? tr : null;
    }, props: { handleKeyDown(view, event) {
      if (!getEnabled() || !view.state.selection.empty || !['Delete', 'Backspace'].includes(event.key)) return false;
      const direction = event.key === 'Delete' ? 1 : -1, start = view.state.selection.from; let pos = start;
      while (pos > 0 && pos < view.state.doc.content.size) { const resolved = view.state.doc.resolve(pos), node = direction === 1 ? resolved.nodeAfter : resolved.nodeBefore; if (!node?.marks.some((mark) => mark.type.name === 'suggestionDelete')) break; pos += direction * node.nodeSize; }
      if (pos === start) return false;
      const resolved = view.state.doc.resolve(pos), node = direction === 1 ? resolved.nodeAfter : resolved.nodeBefore;
      if (!node?.isText) return true;
      const tr = view.state.tr.delete(direction === 1 ? pos : pos - 1, direction === 1 ? pos + 1 : pos); view.dispatch(tr); return true;
    } } })]; },
  });
}

export function createPagination(getPage) {
  return Extension.create({ name: 'docsPagination', addProseMirrorPlugins() { return [new Plugin({ key: paginationKey,
    state: { init: () => ({ breaks: [], pages: 1 }), apply(tr, previous) { return tr.getMeta(paginationKey) || previous; } },
    props: { decorations(state) { const layout = paginationKey.getState(state); if (!getPage().enabled) return DecorationSet.empty; return DecorationSet.create(state.doc, layout.breaks.filter((b) => b.pos <= state.doc.content.size).map((b) => b.explicit ? Decoration.node(b.pos, b.pos + state.doc.nodeAt(b.pos).nodeSize, { style: `height:${b.height}px;margin:0;border:0`, 'data-page-gap': 'true' }) : Decoration.widget(b.pos, () => { const gap = document.createElement('div'); gap.className = 'docs-pagination-gap'; gap.style.height = `${b.height}px`; gap.contentEditable = 'false'; gap.setAttribute('aria-hidden', 'true'); return gap; }, { side: -1, key: `page-gap-${b.pos}-${b.height}` }))); } },
    view(view) { let frame, last = ''; const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      if (!view.dom.isConnected) return;
      const options = getPage(); if (!options.enabled) { if (last !== 'off') { last = 'off'; view.dispatch(view.state.tr.setMeta(paginationKey, { breaks: [], pages: 1 }).setMeta('addToHistory', false)); } return; }
      const blocks = []; view.state.doc.forEach((node, pos) => { const dom = view.nodeDOM(pos); if (!(dom instanceof Element)) return; const style = getComputedStyle(dom); blocks.push({ pos, explicit: node.type.name === 'pageBreak', height: dom.getBoundingClientRect().height / (options.zoom || 1) + parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0) }); });
      const layout = pageBreakLayout(blocks, options.height - options.margin * 2, options.margin), signature = JSON.stringify(layout);
      if (signature !== last) { last = signature; view.dispatch(view.state.tr.setMeta(paginationKey, layout).setMeta('addToHistory', false)); }
    }); }; measure(); const resize = new ResizeObserver(measure); resize.observe(view.dom); return { update: measure, destroy() { cancelAnimationFrame(frame); resize.disconnect(); } }; },
  })]; } });
}
