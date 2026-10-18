import { strToU8, zipSync } from 'fflate';

const xml = (value = '') => String(value).replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]));

export function downloadDocument(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function documentHtml(body, page = {}) {
  const landscape = page.orientation === 'landscape';
  const margin = Number(page.margin) || 72;
  const parsed = new DOMParser().parseFromString(body, 'text/html');
  const notes = [...parsed.querySelectorAll('[data-footnote-id]')];
  const footnotes = notes.length ? '<section class="document-footnotes"><hr><ol>' + notes.map((note, index) => '<li id="fn-' + xml(note.dataset.footnoteId) + '"><a href="#fnref-' + xml(note.dataset.footnoteId) + '">' + (index + 1) + '</a> ' + xml(note.dataset.footnoteText) + '</li>').join('') + '</ol></section>' : '';
  const cssText = (text) => String(text || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ').replace(/</g, '\\3c ').replace(/>/g, '\\3e ');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Commonplace document</title><style>
    @page { size: ${page.size === 'letter' ? 'letter' : 'A4'} ${landscape ? 'landscape' : 'portrait'}; margin: ${margin}px;
      @top-left { content: "${cssText(page.header)}"; font: 9pt Arial, sans-serif; color: #68788e; }
      @bottom-left { content: "${cssText(page.footer)}"; font: 9pt Arial, sans-serif; color: #68788e; }
      ${page.pageNumbers ? '@bottom-right { content: "Page " counter(page); font: 9pt Arial, sans-serif; color: #68788e; }' : ''}
    }
    * { box-sizing: border-box; } body { font: 11pt Arial, sans-serif; line-height: 1.55; color: #202124; margin: 0; }
    h1 { font-size: 26pt; } h2 { font-size: 20pt; } h3 { font-size: 16pt; } h4 { font-size: 14pt; } h5,h6 { font-size: 12pt; }
    h1,h2,h3,h4,h5,h6 { line-height: 1.25; margin: 1.1em 0 .45em; } p { margin: 0 0 .8em; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; } td,th { border:1px solid #b8c1ce; padding:8px; vertical-align:top; } th { background:#eef2f8; }
    img { max-width:100%; height:auto; } blockquote { border-left:3px solid #aab8c8; margin-left:0; padding-left:18px; color:#536171; }
    pre { white-space:pre-wrap; background:#f3f5f8; padding:12px; } code { font-family:monospace; } a { color:#1764c0; }
    div[data-type="page-break"] { break-after:page; page-break-after:always; } hr { border:0; border-top:1px solid #bac4cf; }
    ul[data-type="taskList"] { list-style:none; padding-left:0; } li[data-type="taskItem"] { display:flex; gap:9px; } li[data-type="taskItem"]>div { flex:1; } li[data-type="taskItem"] p { margin:0 0 .4em; }
    .document-footnotes { margin-top:30px; font-size:9pt; clear:both; } .document-footnotes ol { list-style:none; padding-left:0; } .document-footnotes li { margin:8px 0; }
    ins[data-suggestion-id] { color:#16764d; background:#e0f4e8; } del[data-suggestion-id] { color:#a94545; background:#fce8e7; }
    nav[data-type="table-of-contents"] { border:1px solid #d6e1ed; padding:18px; } nav[data-type="table-of-contents"] ol { list-style:none; padding:0; }
    .docs-source-library,[data-type="citation-library"] { display:none; } .docs-equation { padding:18px 12px; font-size:22px; text-align:center; }
    [data-type="bibliography"] { border-top:1px solid #cdd9e8; padding-top:12px; margin-top:24px; } [data-type="bibliography"] p { padding-left:24px; text-indent:-24px; }
    [data-type="columns"] { column-gap:28px; } [data-type="columns"]>* { break-inside:avoid; } [data-bookmark-name] { font-size:0; }
    .document-header,.document-footer { color:#68788e; font:9pt Arial,sans-serif; white-space:pre-wrap; }
    .document-header { margin-bottom:30px; } .document-footer { margin-top:30px; }
    @media print { .document-header,.document-footer { display:none; } }
  </style></head><body>${page.header ? `<header class="document-header">${xml(page.header)}</header>` : ''}${body}${footnotes}${page.footer ? `<footer class="document-footer">${xml(page.footer)}</footer>` : ''}</body></html>`;
}

// A small OOXML writer keeps export local and produces ordinary, editable Word files.
export function createDocx(html, page = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const files = {};
  const relationships = [];
  const imageTypes = new Set();
  let nextRelationship = 2;
  let nextImage = 1;
  const footnotes = [];
  const bookmarkNames = new Map([...doc.querySelectorAll('[data-bookmark-name]')].map((element, index) => [element.id, { name: `Bookmark${index + 1}`, id: index + 1 }]));

  const imageRun = (element) => {
    const match = (element.getAttribute('src') || '').match(/^data:image\/(png|jpe?g|gif);base64,([\s\S]+)$/i);
    if (!match) return `<w:r><w:t>${xml(element.alt || '[Image]')}</w:t></w:r>`;
    const ext = /^jpe?g$/i.test(match[1]) ? 'jpeg' : match[1].toLowerCase();
    let bytes;
    try { bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0)); } catch { return ''; }
    const id = nextImage++;
    const relationship = `rId${nextRelationship++}`;
    const name = `image${id}.${ext}`;
    files[`word/media/${name}`] = bytes;
    imageTypes.add(ext);
    relationships.push(`<Relationship Id="${relationship}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
    const width = Math.min(Number(element.getAttribute('width')) || 480, 600);
    const height = Number(element.getAttribute('height')) || width * 0.625;
    const cx = Math.round(width * 9525);
    const cy = Math.round(height * 9525);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${xml(element.alt || name)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationship}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };

  const runs = (node, inherited = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.textContent) return '';
      const properties = [
        inherited.bold ? '<w:b/>' : '', inherited.italic ? '<w:i/>' : '',
        inherited.vertical ? '<w:vertAlign w:val="' + inherited.vertical + '"/>' : '',
        inherited.underline ? '<w:u w:val="single"/>' : '', inherited.strike ? '<w:strike/>' : '',
        inherited.color ? `<w:color w:val="${xml(inherited.color)}"/>` : '',
        inherited.background ? `<w:shd w:fill="${xml(inherited.background)}"/>` : '',
        inherited.size ? `<w:sz w:val="${Math.round(inherited.size * 2)}"/>` : '',
        inherited.font ? `<w:rFonts w:ascii="${xml(inherited.font)}" w:hAnsi="${xml(inherited.font)}"/>` : '',
      ].join('');
      return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(node.textContent)}</w:t></w:r>`;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return '<w:r><w:br/></w:r>';
    if (tag === 'img') return imageRun(node);
    if (node.hasAttribute('data-bookmark-name')) { const bookmark = bookmarkNames.get(node.id); return bookmark ? `<w:bookmarkStart w:id="${bookmark.id}" w:name="${bookmark.name}"/><w:bookmarkEnd w:id="${bookmark.id}"/>` : ''; }
    if (node.dataset.footnoteId) { const id = footnotes.length + 1; footnotes.push({ id, text: node.dataset.footnoteText || '' }); return '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="' + id + '"/></w:r>'; }
    const style = { ...inherited };
    if (['b', 'strong', 'th'].includes(tag)) style.bold = true;
    if (['i', 'em'].includes(tag)) style.italic = true;
    if (tag === 'u') style.underline = true;
    if (tag === 'sup' || tag === 'sub') style.vertical = tag === 'sup' ? 'superscript' : 'subscript';
    if (['s', 'strike', 'del'].includes(tag)) style.strike = true;
    if (tag === 'code') style.font = 'Courier New';
    const asHex = (color) => {
      if (/^#[a-f\d]{6}$/i.test(color)) return color.slice(1);
      const rgb = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return rgb ? rgb.slice(1).map((part) => Number(part).toString(16).padStart(2, '0')).join('') : undefined;
    };
    if (node.style.color) style.color = asHex(node.style.color);
    if (node.style.backgroundColor) style.background = asHex(node.style.backgroundColor);
    if (node.style.fontSize) style.size = parseFloat(node.style.fontSize) * (node.style.fontSize.endsWith('px') ? 0.75 : 1);
    if (node.style.fontFamily) style.font = node.style.fontFamily.split(',')[0].replace(/["']/g, '');
    if (tag === 'mark' && !style.background) style.background = 'FFF2A8';
    const children = [...node.childNodes].map((child) => runs(child, style)).join('');
    if (tag === 'a' && node.getAttribute('href')?.startsWith('#')) { const bookmark = bookmarkNames.get(node.getAttribute('href').slice(1)); if (bookmark) return `<w:hyperlink w:anchor="${bookmark.name}">${children}</w:hyperlink>`; }
    if (tag === 'a' && /^https?:|^mailto:/i.test(node.getAttribute('href') || '')) {
      const relationship = `rId${nextRelationship++}`;
      relationships.push(`<Relationship Id="${relationship}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(node.getAttribute('href'))}" TargetMode="External"/>`);
      return `<w:hyperlink r:id="${relationship}">${children}</w:hyperlink>`;
    }
    return children;
  };

  const paragraph = (element, options = {}) => {
    const tag = element.tagName?.toLowerCase() || 'p';
    const heading = tag.match(/^h([1-6])$/);
    const alignment = element.style?.textAlign;
    const props = [
      heading ? `<w:pStyle w:val="Heading${heading[1]}"/>` : '',
      alignment ? `<w:jc w:val="${alignment === 'justify' ? 'both' : alignment}"/>` : '',
      options.list ? `<w:numPr><w:ilvl w:val="${Math.min(options.level || 0, 8)}"/><w:numId w:val="${options.list === 'ol' ? 2 : 1}"/></w:numPr>` : '',
      element.style?.marginLeft ? '<w:ind w:left="' + Math.round(parseFloat(element.style.marginLeft) * 15) + '"/>' : '',
      element.style?.lineHeight || element.style?.marginTop || element.style?.marginBottom ? '<w:spacing' + (element.style.lineHeight && Number.isFinite(Number(element.style.lineHeight)) ? ' w:line="' + Math.round(Number(element.style.lineHeight) * 240) + '" w:lineRule="auto"' : '') + (element.style.marginTop ? ' w:before="' + Math.round(parseFloat(element.style.marginTop) * 15) + '"' : '') + (element.style.marginBottom ? ' w:after="' + Math.round(parseFloat(element.style.marginBottom) * 15) + '"' : '') + '/>' : '',
      element.dir === 'rtl' ? '<w:bidi/>' : '',
      /^#[0-9a-f]{6}$/i.test(element.dataset?.shadeColor || '') ? `<w:shd w:fill="${element.dataset.shadeColor.slice(1)}"/>` : '',
      /^#[0-9a-f]{6}$/i.test(element.dataset?.borderColor || '') ? '<w:pBdr>' + ['top','bottom','left','right'].map((side) => `<w:${side} w:val="single" w:sz="6" w:space="5" w:color="${element.dataset.borderColor.slice(1)}"/>`).join('') + '</w:pBdr>' : '',
      options.quote ? '<w:ind w:left="480"/><w:pBdr><w:left w:val="single" w:sz="16" w:color="B8C1CE"/></w:pBdr>' : '',
    ].join('');
    return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs(element)}</w:p>`;
  };
  const blocks = (parent, options = {}) => [...parent.childNodes].map((element) => {
    if (element.nodeType === Node.TEXT_NODE) return element.textContent.trim() ? `<w:p>${runs(element)}</w:p>` : '';
    if (element.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = element.tagName.toLowerCase();
    if (element.dataset.type === 'citation-library') return '';
    if (element.dataset.type === 'equation') { const fallback = document.createElement('p'); fallback.textContent = element.dataset.source || element.textContent; return paragraph(fallback); }
    if (element.dataset.type === 'columns') { const boundary = (count) => `<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:cols w:num="${count}" w:space="420"/></w:sectPr></w:pPr></w:p>`; return boundary(1) + blocks(element, options) + boundary(Number(element.dataset.columns) === 3 ? 3 : 2); }
    if (tag === 'ul' || tag === 'ol') return [...element.children].map((li) => {
      const content = document.createElement('p');
      [...li.childNodes].filter((node) => !['UL', 'OL'].includes(node.nodeName)).forEach((node) => content.appendChild(node.cloneNode(true)));
      const nested = [...li.children].filter((node) => ['UL', 'OL'].includes(node.nodeName));
      if (li.dataset.type === 'taskItem') content.insertBefore(document.createTextNode(li.dataset.checked === 'true' ? '☑ ' : '☐ '), content.firstChild);
      return paragraph(content, { list: li.dataset.type === 'taskItem' ? null : tag, level: options.level || 0 }) + nested.map((list) => blocks({ childNodes: [list] }, { level: (options.level || 0) + 1 })).join('');
    }).join('');
    if (element.dataset.type === 'table-of-contents') return [...element.querySelectorAll('li')].map(li => paragraph(li)).join('');
    if (tag === 'table') {
      const rows = [...element.querySelectorAll('tr')].map((row) => `<w:tr>${[...row.children].map((cell) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${cell.tagName === 'TH' ? '<w:shd w:fill="EEF2F8"/>' : ''}</w:tcPr>${blocks(cell) || '<w:p/>'}</w:tc>`).join('')}</w:tr>`).join('');
      return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} w:val="single" w:sz="4" w:color="B8C1CE"/>`).join('')}</w:tblBorders></w:tblPr>${rows}</w:tbl>`;
    }
    if (tag === 'blockquote') return [...element.children].map((child) => paragraph(child, { quote: true })).join('');
    if (element.dataset.type === 'page-break') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (tag === 'hr') return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:color="B8C1CE"/></w:pBdr></w:pPr></w:p>';
    if (['div', 'section', 'article', 'figure'].includes(tag)) return blocks(element, options);
    return paragraph(element, options);
  }).join('');
  const body = blocks(doc.body);
  if (footnotes.length) relationships.push('<Relationship Id="rIdFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>');
  const landscape = page.orientation === 'landscape';
  const a4 = page.size !== 'letter';
  const width = a4 ? 11906 : 12240;
  const height = a4 ? 16838 : 15840;
  const margin = Math.round((Number(page.margin) || 72) * 15);
  if (page.header) relationships.push('<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>');
  if (page.footer || page.pageNumbers) relationships.push('<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr>${page.header ? '<w:headerReference w:type="default" r:id="rIdHeader"/>' : ''}${page.footer || page.pageNumbers ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' : ''}<w:pgSz w:w="${landscape ? height : width}" w:h="${landscape ? width : height}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="360" w:footer="360"/></w:sectPr></w:body></w:document>`;
  const abstractNumbering = (id, ordered) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/>${Array.from({ length: 9 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${level + 1}.` : '•'}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${720 * (level + 1)}"/></w:tabs><w:ind w:left="${720 * (level + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('')}</w:abstractNum>`;
  const sourceFiles = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...imageTypes].map((ext) => `<Default Extension="${ext}" ContentType="image/${ext}"/>`).join('')}${footnotes.length ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>${page.header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}${page.footer || page.pageNumbers ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}</Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': documentXml,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${relationships.join('')}</Relationships>`,
    'word/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${[52, 40, 32, 28, 24, 22].map((size, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:name w:val="heading ${index + 1}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="140"/><w:outlineLvl w:val="${index}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`).join('')}</w:styles>`,
    'word/numbering.xml': `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${abstractNumbering(0, false)}${abstractNumbering(1, true)}<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
  };
  if (page.header) sourceFiles['word/header1.xml'] = `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:rPr><w:color w:val="68788E"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${xml(page.header)}</w:t></w:r></w:p></w:hdr>`;
  if (page.footer || page.pageNumbers) sourceFiles['word/footer1.xml'] = `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:rPr><w:color w:val="68788E"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${xml(page.footer || '')}</w:t></w:r>${page.pageNumbers ? '<w:r><w:tab/></w:r><w:r><w:t>Page </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>' : ''}</w:p></w:ftr>`;
  if (footnotes.length) sourceFiles['word/footnotes.xml'] = '<?xml version="1.0" encoding="UTF-8"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' + footnotes.map(note => '<w:footnote w:id="' + note.id + '"><w:p><w:r><w:footnoteRef/><w:t xml:space="preserve"> ' + xml(note.text) + '</w:t></w:r></w:p></w:footnote>').join('') + '</w:footnotes>';
  for (const [name, source] of Object.entries(sourceFiles)) files[name] = strToU8(source);
  return zipSync(files);
}
