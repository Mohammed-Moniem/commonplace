const escape = (text = '') => String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
const safeUrl = (url) => /^(https?:|mailto:|tel:|#|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(url.trim()) ? url.trim() : '';
const tick = String.fromCharCode(96);

// Portable Markdown: raw HTML is text, and links never introduce executable URLs.
export function markdownToHtml(markdown) {
  const warnings = [];
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const notes = new Map();
  for (let i = 0; i < lines.length; i++) { const note = lines[i].match(/^\[\^([^\]]+)\]:\s*(.*)$/); if (note) { notes.set(note[1], note[2]); lines[i] = ''; } }
  const inline = (source) => {
    const protectedParts = [];
    const hold = (value) => { protectedParts.push(value); return '\u0000' + (protectedParts.length - 1) + '\u0000'; };
    let text = escape(source);
    text = text.replace(/\x60([^\x60]+)\x60/g, (_, code) => hold('<code>' + code + '</code>'));
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^"]*?)&quot;)?\)/g, (_, alt, url, title) => { const href = safeUrl(url.replace(/&amp;/g, '&')); return href ? hold('<img src="' + escape(href) + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : '') + '>') : alt; });
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^"]*?)&quot;)?\)/g, (_, label, url, title) => { const href = safeUrl(url.replace(/&amp;/g, '&')); const decoded = label.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); return href ? hold('<a href="' + escape(href) + '"' + (title ? ' title="' + title + '"' : '') + '>' + inline(decoded) + '</a>') : label; });
    text = text.replace(/\[\^([^\]]+)\]/g, (_, id) => notes.has(id) ? hold('<sup data-footnote-id="md-' + escape(id) + '" data-footnote-text="' + escape(notes.get(id)) + '" data-footnote-number="' + ([...notes.keys()].indexOf(id) + 1) + '">' + ([...notes.keys()].indexOf(id) + 1) + '</sup>') : _);
    text = text.replace(/\*\*\*(.+?)\*\*\*|___(.+?)___/g, (_, a, b) => hold('<strong><em>' + inline(a || b) + '</em></strong>'));
    text = text.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => '<strong>' + (a || b) + '</strong>');
    text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, '$1<em>$2</em>');
    text = text.replace(/\\([\\*_[\]#~|])/g, '$1');
    return text.replace(/\u0000(\d+)\u0000/g, (_, index) => protectedParts[Number(index)]);
  };
  const splitCells = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
  const listItem = (line) => line.match(/^(\s*)([-+*]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
  const parse = (source) => {
    let i = 0, html = '';
    const parseList = (indent) => {
      const first = listItem(source[i]), ordered = /^\d/.test(first[2]), task = first[3] !== undefined;
      const tag = ordered ? 'ol' : 'ul';
      let output = '<' + tag + (task ? ' data-type="taskList"' : '') + (ordered && parseInt(first[2]) !== 1 ? ' start="' + parseInt(first[2]) + '"' : '') + '>';
      while (i < source.length) {
        const item = listItem(source[i]);
        if (!item || item[1].length !== indent || /^\d/.test(item[2]) !== ordered || (item[3] !== undefined) !== task) break;
        i++;
        let body = '<p>' + inline(item[4]) + '</p>';
        while (i < source.length) {
          const child = listItem(source[i]);
          if (child && child[1].length > indent) body += parseList(child[1].length);
          else if (source[i].trim() && !child && source[i].match(/^\s*/)[0].length > indent) { body += '<p>' + inline(source[i].trim()) + '</p>'; i++; }
          else break;
        }
        output += '<li' + (task ? ' data-type="taskItem" data-checked="' + (item[3].toLowerCase() === 'x') + '"' : '') + '>' + body + '</li>';
      }
      return output + '</' + tag + '>';
    };
    while (i < source.length) {
      const line = source[i];
      if (!line.trim()) { i++; continue; }
      const fence = line.match(/^\s*(\x60{3,}|~{3,})(.*)$/);
      if (fence) { i++; const code = []; while (i < source.length && !source[i].trim().startsWith(fence[1])) code.push(source[i++]); if (i < source.length) i++; else warnings.push('An unclosed code fence was imported through the end of the file.'); html += '<pre><code' + (fence[2].trim() ? ' class="language-' + escape(fence[2].trim().split(/\s/)[0]) + '"' : '') + '>' + escape(code.join('\n')) + '</code></pre>'; continue; }
      const heading = line.match(/^(#{1,6})\s+(.*?)(?:\s+#+)?$/);
      if (heading) { html += '<h' + heading[1].length + '>' + inline(heading[2]) + '</h' + heading[1].length + '>'; i++; continue; }
      if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) { html += '<hr>'; i++; continue; }
      if (/^\s*>/.test(line)) { const quote = []; while (i < source.length && /^\s*>/.test(source[i])) quote.push(source[i++].replace(/^\s*>\s?/, '')); html += '<blockquote>' + parse(quote) + '</blockquote>'; continue; }
      if (listItem(line)) { html += parseList(listItem(line)[1].length); continue; }
      if (i + 1 < source.length && line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(source[i + 1])) {
        const head = splitCells(line); i += 2;
        html += '<table><tbody><tr>' + head.map(cell => '<th><p>' + inline(cell) + '</p></th>').join('') + '</tr>';
        while (i < source.length && source[i].includes('|') && source[i].trim()) { const cells = splitCells(source[i++]); html += '<tr>' + head.map((_, index) => '<td><p>' + inline(cells[index] || '') + '</p></td>').join('') + '</tr>'; }
        html += '</tbody></table>'; continue;
      }
      const paragraph = [line]; i++;
      while (i < source.length && source[i].trim() && !/^(#{1,6}\s|>|[-+*]\s|\d+[.)]\s|\x60{3}|~{3})/.test(source[i]) && !(i + 1 < source.length && /^\s*\|?\s*:?-{3}/.test(source[i + 1]))) paragraph.push(source[i++]);
      html += '<p>' + paragraph.map(part => inline(part.replace(/ {2}$/, '')) + (/ {2}$/.test(part) ? '<br>' : '')).join('\n') + '</p>';
    }
    return html;
  };
  return { html: parse(lines) || '<p></p>', warnings };
}

export function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html'), footnotes = new Map();
  const literal = (value) => value.replace(/([\\*_[\]\x60])/g, '\\$1');
  const children = (node, context = {}) => [...node.childNodes].map(child => render(child, context)).join('');
  const cellText = (cell) => children(cell).trim().replace(/\n+/g, '<br>').replace(/\|/g, '\\|');
  function render(node, context = {}) {
    if (node.nodeType === 3) return context.code ? node.textContent : literal(node.textContent);
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    if (node.dataset.footnoteId) { const index = String(footnotes.size + 1); footnotes.set(index, node.dataset.footnoteText || ''); return '[^' + index + ']'; }
    if (tag === 'br') return '  \n';
    if (tag === 'pre') return '\n' + tick.repeat(3) + (node.querySelector('code')?.className.replace('language-', '') || '') + '\n' + node.textContent.replace(/\n$/, '') + '\n' + tick.repeat(3) + '\n\n';
    if (tag === 'code') { const fence = node.textContent.includes(tick) ? tick.repeat(2) : tick; return fence + node.textContent + fence; }
    if (tag === 'strong' || tag === 'b') return '**' + children(node, context) + '**';
    if (tag === 'em' || tag === 'i') return '*' + children(node, context) + '*';
    if (['s', 'strike', 'del'].includes(tag)) return '~~' + children(node, context) + '~~';
    if (tag === 'ins') return children(node, context);
    if (tag === 'a') return '[' + children(node, context) + '](' + (safeUrl(node.getAttribute('href') || '') || '#') + ')';
    if (tag === 'img') return '![' + literal(node.getAttribute('alt') || '') + '](' + (safeUrl(node.getAttribute('src') || '') || '') + ')\n\n';
    if (/^h[1-6]$/.test(tag)) return '#'.repeat(Number(tag[1])) + ' ' + children(node).trim() + '\n\n';
    if (tag === 'hr') return '---\n\n';
    if (tag === 'blockquote') return children(node).trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    if (tag === 'ul' || tag === 'ol') {
      let start = Number(node.getAttribute('start')) || 1;
      return [...node.children].map((li, index) => {
        const task = li.dataset.type === 'taskItem', marker = task ? '- [' + (li.dataset.checked === 'true' ? 'x' : ' ') + '] ' : tag === 'ol' ? start + index + '. ' : '- ';
        const inner = children(li).trim().split('\n');
        return marker + inner[0] + (inner.length > 1 ? '\n' + inner.slice(1).filter(Boolean).map(line => '  ' + line).join('\n') : '') + '\n';
      }).join('') + '\n';
    }
    if (tag === 'table') { const rows = [...node.querySelectorAll('tr')]; if (!rows.length) return ''; const width = Math.max(...rows.map(row => row.children.length)); const row = (tr) => '| ' + Array.from({ length: width }, (_, index) => tr.children[index] ? cellText(tr.children[index]) : '').join(' | ') + ' |\n'; return row(rows[0]) + '| ' + Array(width).fill('---').join(' | ') + ' |\n' + rows.slice(1).map(row).join('') + '\n'; }
    if (tag === 'p') return children(node, context).trim() + '\n\n';
    if (node.dataset.type === 'page-break') return '\n---\n\n';
    return children(node, context);
  }
  let markdown = children(doc.body).trim();
  if (footnotes.size) markdown += '\n\n' + [...footnotes].map(([id, text]) => '[^' + id + ']: ' + text.replace(/\n/g, ' ')).join('\n');
  return markdown + '\n';
}
