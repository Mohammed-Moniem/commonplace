import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Fragment, DOMParser as PMDOMParser } from '@tiptap/pm/model';

const uid = () => crypto.randomUUID();
const json = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };
const sourceArray = (value) => (Array.isArray(value) ? value : []).filter((source) => source && typeof source === 'object' && typeof source.id === 'string').slice(0, 100).map((source) => Object.fromEntries(['id','author','title','year','publisher','url'].map((key) => [key, String(source[key] || '').slice(0, key === 'url' ? 1500 : 500)])));
const color = (value, fallback = null) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
const paragraphSelected = (node, pos, selection) => selection.empty || pos + 1 < selection.to && pos + node.nodeSize - 1 > selection.from;
export const paragraphKeys = ['indent', 'lineHeight', 'textAlign', 'spaceBefore', 'spaceAfter', 'borderColor', 'shadeColor', 'direction'];
export const ParagraphDesign = Extension.create({
  name: 'paragraphDesign',
  addGlobalAttributes() { return [{ types: ['paragraph', 'heading'], attributes: {
    spaceBefore: { default: null, parseHTML: (el) => el.style.marginTop ? parseFloat(el.style.marginTop) : null, renderHTML: (a) => a.spaceBefore !== null ? { style: `margin-top:${Math.max(0, Math.min(96, Number(a.spaceBefore) || 0))}px` } : {} },
    spaceAfter: { default: null, parseHTML: (el) => el.style.marginBottom ? parseFloat(el.style.marginBottom) : null, renderHTML: (a) => a.spaceAfter !== null ? { style: `margin-bottom:${Math.max(0, Math.min(96, Number(a.spaceAfter) || 0))}px` } : {} },
    borderColor: { default: null, parseHTML: (el) => el.dataset.borderColor || null, renderHTML: (a) => color(a.borderColor) ? { 'data-border-color': a.borderColor, style: `border:1px solid ${a.borderColor};padding:10px` } : {} },
    shadeColor: { default: null, parseHTML: (el) => el.dataset.shadeColor || null, renderHTML: (a) => color(a.shadeColor) ? { 'data-shade-color': a.shadeColor, style: `background-color:${a.shadeColor};padding:10px` } : {} },
    direction: { default: null, parseHTML: (el) => ['rtl', 'ltr'].includes(el.dir) ? el.dir : null, renderHTML: (a) => ['rtl', 'ltr'].includes(a.direction) ? { dir: a.direction } : {} },
  } }]; },
  addCommands() { return { setParagraphDesign: (attrs) => ({ state, tr, dispatch }) => { const safe = Object.fromEntries(Object.entries(attrs).filter(([key]) => paragraphKeys.includes(key))); state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => { if (['paragraph', 'heading'].includes(node.type.name) && paragraphSelected(node, pos, state.selection)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...safe }); }); if (dispatch) dispatch(tr); return true; } }; },
});

export const ColumnSection = Node.create({
  name: 'columnSection', group: 'block', content: 'block+', defining: true, isolating: true,
  addAttributes: () => ({ columns: { default: 2, parseHTML: (el) => Number(el.dataset.columns) === 3 ? 3 : 2 } }),
  parseHTML: () => [{ tag: 'section[data-type="columns"]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['section', mergeAttributes(HTMLAttributes, { 'data-type': 'columns', 'data-columns': node.attrs.columns, class: 'docs-columns', style: `column-count:${node.attrs.columns};column-gap:28px` }), 0],
});
export function unwrapColumnSection(editor) { const { $from } = editor.state.selection; for (let depth = $from.depth; depth > 0; depth--) { const node = $from.node(depth); if (node.type.name === 'columnSection') { editor.view.dispatch(editor.state.tr.replaceWith($from.before(depth), $from.after(depth), node.content)); return true; } } throw new Error('Place the cursor inside a column section.'); }
export function setColumnSection(editor, columns = 2) {
  if (editor.isActive('columnSection')) return editor.chain().focus().updateAttributes('columnSection', { columns }).run();
  const { $from, $to, empty } = editor.state.selection; let from = $from.pos, to = $to.pos;
  if (!empty && $from.parent.isTextblock && $from.parentOffset === $from.parent.content.size) from = TextSelection.near(editor.state.doc.resolve($from.after()), 1).from;
  if (!empty && $to.parent.isTextblock && $to.parentOffset === 0) to = TextSelection.near(editor.state.doc.resolve($to.before()), -1).to;
  if (from > to || !editor.chain().focus().setTextSelection({ from, to }).wrapIn('columnSection', { columns: columns === 3 ? 3 : 2 }).run()) throw new Error('Select paragraphs that can form a section.');
  return true;
}

export const Bookmark = Node.create({
  name: 'bookmark', group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ id: { default: null, parseHTML: (el) => el.id }, name: { default: '', parseHTML: (el) => el.dataset.bookmarkName || '' } }),
  parseHTML: () => [{ tag: 'span[data-bookmark-name]' }],
  renderHTML: ({ node }) => ['span', { id: node.attrs.id, 'data-bookmark-name': node.attrs.name, class: 'docs-bookmark', title: `Bookmark: ${node.attrs.name}`, 'aria-label': `Bookmark: ${node.attrs.name}` }, '⚑'],
});
export function documentBookmarks(doc) { const result = []; doc.descendants((node, pos) => { if (node.type.name === 'bookmark') result.push({ ...node.attrs, pos }); }); return result; }

export function citationText(source, style = 'apa', full = false) {
  const author = String(source.author || 'Anonymous').trim(), title = String(source.title || 'Untitled').trim(), year = String(source.year || 'n.d.').trim();
  if (!full) return style === 'mla' ? `(${author})` : style === 'chicago' ? `(${author} ${year})` : `(${author}, ${year})`;
  const tail = [source.publisher, source.url].filter(Boolean).join('. ');
  return style === 'mla' ? `${author}. “${title}.” ${source.publisher || ''}${source.publisher ? ', ' : ''}${year}.${source.url ? ' ' + source.url : ''}` : style === 'chicago' ? `${author}. ${title}. ${tail ? tail + ', ' : ''}${year}.` : `${author}. (${year}). ${title}.${tail ? ' ' + tail + '.' : ''}`;
}
export const CitationLibrary = Node.create({
  name: 'citationLibrary', group: 'block', atom: true,
  addAttributes: () => ({ sources: { default: [], parseHTML: (el) => sourceArray(json(el.dataset.sources, [])) }, style: { default: 'apa', parseHTML: (el) => ['apa', 'mla', 'chicago'].includes(el.dataset.style) ? el.dataset.style : 'apa' } }),
  parseHTML: () => [{ tag: 'div[data-type="citation-library"]' }],
  renderHTML: ({ node }) => ['div', { 'data-type': 'citation-library', 'data-sources': JSON.stringify(node.attrs.sources), 'data-style': node.attrs.style, class: 'docs-source-library', hidden: 'hidden' }],
});
export const Citation = Node.create({
  name: 'citation', group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ sourceId: { default: null, parseHTML: (el) => el.dataset.sourceId }, text: { default: '(Source)', parseHTML: (el) => el.textContent } }),
  parseHTML: () => [{ tag: 'span[data-type="citation"]' }],
  renderHTML: ({ node }) => ['span', { 'data-type': 'citation', 'data-source-id': node.attrs.sourceId, class: 'docs-citation' }, node.attrs.text],
  renderText: ({ node }) => node.attrs.text,
});
export const Bibliography = Node.create({
  name: 'bibliography', group: 'block', atom: true,
  addAttributes: () => ({ entries: { default: [], parseHTML: (el) => { const entries = json(el.dataset.entries, []); return (Array.isArray(entries) ? entries : []).filter((entry) => typeof entry === 'string').slice(0, 100); } } }),
  parseHTML: () => [{ tag: 'section[data-type="bibliography"]' }],
  renderHTML: ({ node }) => ['section', { 'data-type': 'bibliography', 'data-entries': JSON.stringify(node.attrs.entries), class: 'docs-bibliography' }, ['h2', 'Bibliography'], ...(node.attrs.entries.length ? node.attrs.entries.map((text) => ['p', text]) : [['p', 'Insert a citation to populate this bibliography.']])],
  renderText: ({ node }) => 'Bibliography\n' + (node.attrs.entries.length ? node.attrs.entries.join('\n') : 'Insert a citation to populate this bibliography.'),
});
export function citationLibrary(doc) { let result = { sources: [], style: 'apa', pos: null }; doc.descendants((node, pos) => { if (node.type.name === 'citationLibrary') result = { ...node.attrs, pos }; }); return result; }
export function setCitationLibrary(editor, sources, style = 'apa') {
  if (!Array.isArray(sources) || sources.length > 100) throw new Error('This tab can hold up to 100 sources.');
  const current = citationLibrary(editor.state.doc), attrs = { sources: sources.map((source) => ({ id: source.id || uid(), author: String(source.author || '').slice(0, 300), title: String(source.title || '').slice(0, 500), year: String(source.year || '').slice(0, 30), publisher: String(source.publisher || '').slice(0, 300), url: /^https?:\/\//i.test(source.url || '') ? source.url.slice(0, 1500) : '' })), style: ['apa', 'mla', 'chicago'].includes(style) ? style : 'apa' };
  const tr = editor.state.tr;
  if (current.pos !== null) tr.setNodeMarkup(current.pos, undefined, attrs); else tr.insert(editor.state.doc.content.size, editor.schema.nodes.citationLibrary.create(attrs));
  editor.view.dispatch(tr);
}
export const CitationStructure = Extension.create({ name: 'citationStructure', addProseMirrorPlugins() { return [new Plugin({ key: new PluginKey('citationStructure'), appendTransaction(transactions, _old, state) { if (!transactions.some((tr) => tr.docChanged)) return null; const library = citationLibrary(state.doc), cited = new Set(), tr = state.tr; state.doc.descendants((node, pos) => { if (node.type.name === 'citation') { const source = library.sources.find((entry) => entry.id === node.attrs.sourceId); if (source) cited.add(source.id); const text = source ? citationText(source, library.style) : '[Missing source]'; if (text !== node.attrs.text) tr.setNodeMarkup(pos, undefined, { ...node.attrs, text }); } }); const entries = library.sources.filter((source) => cited.has(source.id)).sort((a, b) => a.author.localeCompare(b.author)).map((source) => citationText(source, library.style, true)); tr.doc.descendants((node, pos) => { if (node.type.name === 'bibliography' && JSON.stringify(entries) !== JSON.stringify(node.attrs.entries)) tr.setNodeMarkup(pos, undefined, { entries }); }); return tr.docChanged ? tr.setMeta('docsStructure', true).setMeta('addToHistory', false) : null; } })]; } });

// A deliberately bounded expression grammar. It renders native MathML, never evaluates code.
export function equationTree(input) {
  const source = String(input || '').trim(); if (!source || source.length > 1000) throw new Error('Enter an equation of 1–1000 characters.');
  let index = 0, count = 0;
  const greek = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', times: '×', div: '÷', pm: '±', le: '≤', ge: '≥', ne: '≠', infty: '∞', sum: '∑', int: '∫' };
  const token = (tag, text) => [tag, text];
  function group(required = false) { while (/\s/.test(source[index] || '') && index < source.length) index++; if (source[index] === '{') { index++; const result = sequence('}'); if (source[index++] !== '}') throw new Error('Close each { group with }.'); return ['mrow', ...result]; } if (required) throw new Error('Use {braces} after fraction or root commands.'); return atom(); }
  function atom() { if (++count > 500) throw new Error('Equation is too complex.'); let char = source[index++]; if (!char || char === '}') throw new Error('Missing equation value.'); if (char === '\\') { const match = source.slice(index).match(/^[a-zA-Z]+/); if (!match) throw new Error('Use a supported equation command.'); index += match[0].length; const command = match[0]; if (command === 'frac') return ['mfrac', group(true), group(true)]; if (command === 'sqrt') return ['msqrt', group(true)]; if (!(command in greek)) throw new Error(`Unsupported command: \\${command}`); return token(/[a-z]/.test(command[0]) && !['times', 'div', 'pm', 'le', 'ge', 'ne', 'infty', 'sum', 'int'].includes(command) ? 'mi' : 'mo', greek[command]); } if (char === '{') { index--; return group(); } if (/[0-9.]/.test(char)) { const rest = source.slice(index).match(/^[0-9.]*/)[0]; index += rest.length; return token('mn', char + rest); } if (/[\p{L}]/u.test(char)) return token('mi', char); if ('+-=()/[]|,<>:!'.includes(char)) return token('mo', char); throw new Error(`Unsupported equation character: ${char}`); }
  function sequence(end) { const children = []; while (index < source.length && source[index] !== end) { if (/\s/.test(source[index])) { index++; continue; } let base = atom(), sup = null, sub = null; while (source[index] === '^' || source[index] === '_') { const symbol = source[index++], value = group(); if (symbol === '^') { if (sup) throw new Error('Duplicate exponent.'); sup = value; } else { if (sub) throw new Error('Duplicate subscript.'); sub = value; } } if (sup && sub) base = ['msubsup', base, sub, sup]; else if (sup || sub) base = [sup ? 'msup' : 'msub', base, sup || sub]; children.push(base); } return children; }
  return ['mrow', ...sequence(null)];
}
export function equationDom(source) { const host = document.createElement('div'); host.dataset.type = 'equation'; host.dataset.source = source; host.className = 'docs-equation'; const math = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math'); math.setAttribute('display', 'block'); math.setAttribute('aria-label', source); const build = (tree) => { const element = document.createElementNS('http://www.w3.org/1998/Math/MathML', tree[0]); tree.slice(1).forEach((child) => element.append(typeof child === 'string' ? document.createTextNode(child) : build(child))); return element; }; try { math.append(build(equationTree(source))); host.append(math); } catch { host.textContent = source; } return host; }
export const Equation = Node.create({ name: 'equation', group: 'block', atom: true, addAttributes: () => ({ source: { default: 'x^2', parseHTML: (el) => el.dataset.source || el.textContent } }), parseHTML: () => [{ tag: 'div[data-type="equation"]' }], renderHTML: ({ node }) => equationDom(node.attrs.source), renderText: ({ node }) => node.attrs.source, addNodeView() { return ({ node }) => ({ dom: equationDom(node.attrs.source) }); } });

const formattingMarks = ['bold', 'italic', 'underline', 'strike', 'textStyle', 'highlight', 'superscript', 'subscript'];
export function captureFormatting(editor) { const { from, to, $from } = editor.state.selection; let marks = editor.state.storedMarks || $from.marks(), paragraph = $from.parent; if (from !== to) { let found = false, foundParagraph = false; editor.state.doc.nodesBetween(from, to, (node, pos) => { if (!found && node.isText && pos < to && pos + node.nodeSize > from) { marks = node.marks; found = true; } if (!foundParagraph && ['paragraph', 'heading'].includes(node.type.name) && paragraphSelected(node, pos, editor.state.selection)) { paragraph = node; foundParagraph = true; } }); } return { marks: marks.filter((mark) => formattingMarks.includes(mark.type.name)).map((mark) => mark.toJSON()), paragraph: Object.fromEntries(paragraphKeys.filter((key) => key in paragraph.attrs).map((key) => [key, paragraph.attrs[key]])) }; }
export function applyFormatting(editor, saved) { if (!saved) throw new Error('Copy formatting first.'); const { from, to } = editor.state.selection, tr = editor.state.tr; for (const name of formattingMarks) if (editor.schema.marks[name]) tr.removeMark(from, to, editor.schema.marks[name]); const marks = saved.marks.filter((mark) => editor.schema.marks[mark.type]).map((mark) => editor.schema.markFromJSON(mark)); if (from === to) tr.setStoredMarks(marks); else marks.forEach((mark) => tr.addMark(from, to, mark)); editor.state.doc.nodesBetween(from, to, (node, pos) => { if (['paragraph', 'heading'].includes(node.type.name) && paragraphSelected(node, pos, editor.state.selection)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...saved.paragraph }); }); editor.view.dispatch(tr); }

export function changeTextCase(editor, mode) { const { from, to } = editor.state.selection; if (from === to) throw new Error('Select text to change its case.'); const all = editor.state.doc.textBetween(from, to, '\n'), transformed = mode === 'upper' ? all.toLocaleUpperCase() : mode === 'lower' ? all.toLocaleLowerCase() : mode === 'title' ? all.toLocaleLowerCase().replace(/(^|[^\p{L}\p{N}])\p{L}/gu, (value) => value.toLocaleUpperCase()) : all.toLocaleLowerCase().replace(/(^|[.!?]\s+)\p{L}/gu, (value) => value.toLocaleUpperCase()); const pieces = []; editor.state.doc.nodesBetween(from, to, (node, pos) => { if (!node.isText) return; const start = Math.max(from, pos), end = Math.min(to, pos + node.nodeSize); if (start < end) pieces.push({ start, end, text: node.text.slice(start - pos, end - pos), marks: node.marks }); });
  // Transform each marked segment using its position in the full selection. Unicode expansion stays local.
  const tr = editor.state.tr; let search = 0; pieces.forEach((piece) => { const position = all.indexOf(piece.text, search); const prefix = all.slice(0, Math.max(0, position)); let text = mode === 'upper' ? piece.text.toLocaleUpperCase() : piece.text.toLocaleLowerCase(); if (mode === 'title') text = text.replace(/\p{L}/gu, (letter, index) => { const preceding = index ? text[index - 1] : prefix.at(-1); return !preceding || !/[\p{L}\p{N}]/u.test(preceding) ? letter.toLocaleUpperCase() : letter; }); if (mode === 'sentence') text = text.replace(/\p{L}/gu, (letter, index) => { const preceding = prefix + text.slice(0, index); return !preceding.trim() || /[.!?]\s*$/.test(preceding) ? letter.toLocaleUpperCase() : letter; }); piece.next = text; search = Math.max(search, position) + piece.text.length; }); for (const piece of pieces.reverse()) tr.replaceWith(piece.start, piece.end, editor.schema.text(piece.next, piece.marks)); editor.view.dispatch(tr); return transformed; }

export function sortParagraphs(editor, descending = false) { const { from, to, empty } = editor.state.selection; const selected = []; editor.state.doc.forEach((node, pos) => { if (!empty && pos + 1 < to && pos + node.nodeSize - 1 > from) selected.push({ node, pos }); }); if (selected.length < 2 || selected.some(({ node }) => node.type.name !== 'paragraph')) throw new Error('Select at least two ordinary top-level paragraphs.'); const sorted = selected.map(({ node }) => node).sort((a, b) => a.textContent.localeCompare(b.textContent, undefined, { numeric: true, sensitivity: 'base' }) * (descending ? -1 : 1)); editor.view.dispatch(editor.state.tr.replaceWith(selected[0].pos, selected.at(-1).pos + selected.at(-1).node.nodeSize, Fragment.fromArray(sorted))); }

export function validateSearchRegex(pattern) {
  const invalid = () => { throw new Error('Use a simpler expression without backreferences, lookarounds, or repeated complex groups.'); };
  const stack = [{ complex: false }]; let escaped = false, characterClass = false, previousGroup = null;
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (escaped) { if (/[1-9]/.test(char)) invalid(); escaped = false; previousGroup = null; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (characterClass) { if (char === ']') characterClass = false; continue; }
    if (char === '[') { characterClass = true; previousGroup = null; continue; }
    if (char === '(') { if (pattern[index + 1] === '?' && pattern[index + 2] !== ':') invalid(); if (pattern.slice(index + 1, index + 3) === '?:') index += 2; stack.push({ complex: false }); previousGroup = null; continue; }
    if (char === ')') { if (stack.length <= 1) { previousGroup = null; continue; } const closed = stack.pop(); if (closed.complex) stack.at(-1).complex = true; previousGroup = closed; continue; }
    const quantified = '*+?'.includes(char) || char === '{' && /^\{\d+(?:,\d*)?\}/.test(pattern.slice(index));
    if (quantified) { if (previousGroup?.complex) invalid(); stack.at(-1).complex = true; previousGroup = null; continue; }
    if (char === '|') stack.at(-1).complex = true;
    previousGroup = null;
  }
}

export function searchDocument(doc, query, { matchCase = false, wholeWord = false, regex = false } = {}) {
  if (!query) return [];
  if (query.length > 250) throw new Error('Search patterns are limited to 250 characters.');
  if (regex) validateSearchRegex(query);
  const pattern = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu'), result = [];
  doc.descendants((block, pos) => {
    if (!block.isTextblock) return;
    let text = ''; const positions = [];
    block.descendants((node, offset) => {
      if (node.isText) for (let index = 0; index < node.text.length; index++) { text += node.text[index]; positions.push(pos + 1 + offset + index); }
      else if (node.type.name === 'hardBreak') { text += '\n'; positions.push(pos + 1 + offset); }
    });
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (!match[0].length) continue;
      const start = match.index, end = start + match[0].length;
      if (wholeWord && (/[\p{L}\p{N}_]/u.test(text[start - 1] || '') || /[\p{L}\p{N}_]/u.test(text[end] || ''))) continue;
      result.push({ from: positions[start], to: positions[end - 1] + 1, match: match[0], groups: [...match], namedGroups: match.groups || {} });
      if (result.length >= 10000) break;
    }
    return false;
  });
  return result;
}
export function searchDocumentTabs(schema, tabs, query) { const found = []; for (const tab of tabs) { const parsed = new DOMParser().parseFromString(tab.html, 'text/html'), doc = PMDOMParser.fromSchema(schema).parse(parsed.body); for (const match of searchDocument(doc, query)) found.push({ ...match, tabId: tab.id, name: tab.name, excerpt: doc.textBetween(Math.max(0, match.from - 24), Math.min(doc.content.size, match.to + 40), ' ') }); } return found.slice(0, 200); }
export function expandReplacement(replacement, match) { return String(replacement).replace(/\$(\$|&|[1-9][0-9]?|<[^>]+>)/g, (token, key) => key === '$' ? '$' : key === '&' ? match.match : key.startsWith('<') ? match.namedGroups?.[key.slice(1, -1)] ?? '' : match.groups?.[Number(key)] ?? token); }

export function imageGeometry(width, height, operation) { if (!(width > 0 && height > 0)) throw new Error('Image has invalid dimensions.'); if (operation.type === 'rotate') return { sx: 0, sy: 0, sw: width, sh: height, width: height, height: width, rotate: true }; const left = Number(operation.left || 0), top = Number(operation.top || 0), right = Number(operation.right || 0), bottom = Number(operation.bottom || 0); if ([left, top, right, bottom].some((value) => !Number.isFinite(value) || value < 0 || value >= 100) || left + right >= 95 || top + bottom >= 95) throw new Error('Crop must leave at least 5% of the image.'); const sx = Math.round(width * left / 100), sy = Math.round(height * top / 100), sw = Math.max(1, Math.round(width * (100 - left - right) / 100)), sh = Math.max(1, Math.round(height * (100 - top - bottom) / 100)); return { sx, sy, sw, sh, width: sw, height: sh, rotate: false }; }
export async function transformImage(source, operation) { if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(source)) throw new Error('Crop and rotate require an uploaded local image.'); const image = await new Promise((resolve, reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = () => reject(new Error('This image could not be decoded.')); value.src = source; }); const size = imageGeometry(image.naturalWidth, image.naturalHeight, operation); if (size.width * size.height > 40000000) throw new Error('Image is too large to transform.'); const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height; const context = canvas.getContext('2d'); if (!context) throw new Error('Image editing is unavailable in this browser.'); if (size.rotate) { context.translate(size.width / 2, size.height / 2); context.rotate(Math.PI / 2); context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2); } else context.drawImage(image, size.sx, size.sy, size.sw, size.sh, 0, 0, size.width, size.height); return { src: canvas.toDataURL('image/png'), width: size.width, height: size.height }; }
export function replacementImageAttributes(previous, image, src, alt = '') { const width = Number(previous.width) || 480; if (!(image.width > 0 && image.height > 0)) throw new Error('Replacement image has invalid dimensions.'); return { ...previous, src, alt, width, height: Math.round(width * image.height / image.width) }; }

export const productivityExtensions = [ParagraphDesign, ColumnSection, Bookmark, CitationLibrary, Citation, Bibliography, CitationStructure, Equation];
