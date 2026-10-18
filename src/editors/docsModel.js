export const defaultPage = { size: 'a4', orientation: 'portrait', margin: 72, mode: 'pages', header: '', footer: '', pageNumbers: false };
const uid = () => crypto.randomUUID();

export function normalizeDocument(content = {}) {
  const source = Array.isArray(content.tabs) && content.tabs.length ? content.tabs : [{ id: 'main', name: 'Tab 1', html: content.html || '<p></p>', page: content.page }];
  const tabs = source.map((tab, index) => ({ ...tab, id: tab.id || `tab-${index + 1}`, parentId: tab.parentId || null, name: tab.name || `Tab ${index + 1}`, html: typeof tab.html === 'string' ? tab.html : '<p></p>', page: { ...defaultPage, ...content.page, ...tab.page } }));
  const activeTabId = tabs.some((tab) => tab.id === content.activeTabId) ? content.activeTabId : tabs[0].id;
  const active = tabs.find((tab) => tab.id === activeTabId);
  return { ...content, tabs, activeTabId, html: active.html, page: active.page };
}

export function updateActiveDocument(content, patch) {
  const document = normalizeDocument(content);
  const tabs = document.tabs.map((tab) => tab.id === document.activeTabId ? { ...tab, ...patch, page: { ...tab.page, ...patch.page } } : tab);
  const active = tabs.find((tab) => tab.id === document.activeTabId);
  return { ...document, tabs, html: active.html, page: active.page };
}

export function changeDocumentTab(content, operation) {
  const document = normalizeDocument(content);
  let tabs = [...document.tabs], activeTabId = document.activeTabId;
  if (operation.type === 'add' && tabs.length < 100) { const tab = { id: operation.id || uid(), name: operation.name?.trim() || `Tab ${tabs.length + 1}`, html: '<p></p>', page: { ...document.page } }; tabs.push(tab); activeTabId = tab.id; }
  if (operation.type === 'select' && tabs.some((tab) => tab.id === operation.id)) activeTabId = operation.id;
  if (operation.type === 'rename' && operation.name?.trim()) tabs = tabs.map((tab) => tab.id === operation.id ? { ...tab, name: operation.name.trim().slice(0, 120) } : tab);
  if (operation.type === 'duplicate' && tabs.length < 100) { const original = tabs.find((tab) => tab.id === operation.id); if (original) { const copy = { ...original, page: { ...original.page }, id: operation.newId || uid(), name: (original.name + ' copy').slice(0, 120) }; const index = tabs.findIndex((tab) => tab.id === operation.id); tabs.splice(index + tabSubtree(tabs, original.id).length, 0, copy); activeTabId = copy.id; } }
  if (operation.type === 'delete' && tabs.length > 1) { const index = tabs.findIndex((tab) => tab.id === operation.id), removed = tabs[index]; if (removed) { tabs = tabs.filter((tab) => tab.id !== operation.id).map((tab) => tab.parentId === removed.id ? { ...tab, parentId: removed.parentId } : tab); if (activeTabId === operation.id) activeTabId = tabs[Math.max(0, Math.min(index - 1, tabs.length - 1))].id; } }
  if (operation.type === 'move') { const current = tabs.find((tab) => tab.id === operation.id); if (current) { const siblings = tabs.filter((tab) => tab.parentId === current.parentId), siblingIndex = siblings.findIndex((tab) => tab.id === current.id), target = siblings[siblingIndex + operation.direction]; if (target) { const moving = tabSubtree(tabs, current.id), ids = new Set(moving.map((tab) => tab.id)); tabs = tabs.filter((tab) => !ids.has(tab.id)); const destination = tabs.findIndex((tab) => tab.id === target.id) + (operation.direction > 0 ? tabSubtree(tabs, target.id).length : 0); tabs.splice(destination, 0, ...moving); } } }
  if (operation.type === 'indent' || operation.type === 'outdent') {
    const current = tabs.find((tab) => tab.id === operation.id);
    if (current) { const siblings = tabs.filter((tab) => tab.parentId === current.parentId), index = siblings.findIndex((tab) => tab.id === current.id), parent = tabs.find((tab) => tab.id === current.parentId), newParent = operation.type === 'indent' ? siblings[index - 1] : parent && tabs.find((tab) => tab.id === parent.parentId), moving = tabSubtree(tabs, current.id);
      const newParentId = operation.type === 'indent' ? newParent?.id : parent?.parentId || null;
      const height = Math.max(...moving.map((tab) => tabDepth(tabs, tab.id))) - tabDepth(tabs, current.id);
      if ((operation.type === 'indent' ? !!newParent : !!parent) && (newParentId ? tabDepth(tabs, newParentId) + 1 : 0) + height < 3) { const ids = new Set(moving.map((tab) => tab.id)); tabs = tabs.filter((tab) => !ids.has(tab.id)); moving[0] = { ...moving[0], parentId: newParentId }; const anchor = operation.type === 'indent' ? newParent : parent; const destination = tabs.findIndex((tab) => tab.id === anchor.id) + tabSubtree(tabs, anchor.id).length; tabs.splice(destination, 0, ...moving); }
    }
  }
  const active = tabs.find((tab) => tab.id === activeTabId);
  return { ...document, tabs, activeTabId, html: active.html, page: active.page };
}

export function tabDepth(tabs, id) { let depth = 0, current = tabs.find((tab) => tab.id === id); const seen = new Set([id]); while (current?.parentId && depth < 3 && !seen.has(current.parentId)) { seen.add(current.parentId); current = tabs.find((tab) => tab.id === current.parentId); if (current) depth++; } return depth; }
export function tabSubtree(tabs, id) { const result = [], visit = (parentId) => { const tab = tabs.find((entry) => entry.id === parentId); if (!tab || result.some((entry) => entry.id === parentId)) return; result.push(tab); tabs.filter((entry) => entry.parentId === parentId).forEach((child) => visit(child.id)); }; visit(id); return result; }

export function pageBreakLayout(blocks, contentHeight, margin = 72, gap = 24) {
  let used = 0, pages = 1;
  const breaks = [];
  for (const block of blocks) {
    if (block.explicit) { breaks.push({ pos: block.pos, height: Math.max(0, contentHeight - used) + margin * 2 + gap, explicit: true }); used = 0; pages++; continue; }
    const height = Math.max(0, block.height);
    if (used > 0 && height <= contentHeight && used + height > contentHeight) { breaks.push({ pos: block.pos, height: contentHeight - used + margin * 2 + gap }); used = 0; pages++; }
    used += height;
    // Oversized blocks retain their contents; native print pagination handles their internal lines.
    if (used > contentHeight) { const overflow = Math.floor(used / contentHeight); pages += overflow; used %= contentHeight; }
  }
  return { breaks, pages };
}

export function allDocumentTabsHtml(content) {
  const model = normalizeDocument(content);
  const escape = (value) => String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  return model.tabs.map((tab, index) => (index ? '<div data-type="page-break"></div>' : '') + '<section data-document-tab="' + escape(tab.id) + '"><h1>' + escape(tab.name) + '</h1>' + namespaceDocumentHtml(tab.html, 'tab-' + index + '-') + '</section>').join('');
}

export function namespaceDocumentHtml(html, prefix) {
  const document = new DOMParser().parseFromString(html, 'text/html'), ids = new Map();
  document.querySelectorAll('[id]').forEach((node) => ids.set(node.id, prefix + node.id));
  document.querySelectorAll('[data-footnote-id]').forEach((node) => { const original = node.dataset.footnoteId, next = prefix + original; ids.set('fnref-' + original, 'fnref-' + next); ids.set('fn-' + original, 'fn-' + next); node.dataset.footnoteId = next; });
  document.querySelectorAll('[id]').forEach((node) => { node.id = ids.get(node.id); });
  document.querySelectorAll('a[href^="#"]').forEach((node) => { const id = node.getAttribute('href').slice(1); if (ids.has(id)) node.setAttribute('href', '#' + ids.get(id)); });
  document.querySelectorAll('[data-type="table-of-contents"]').forEach((node) => { try { const entries = JSON.parse(node.dataset.entries); if (Array.isArray(entries)) node.dataset.entries = JSON.stringify(entries.map((entry) => ({ ...entry, id: ids.get(entry.id) || entry.id }))); } catch { /* Malformed imported metadata does not change visible text. */ } });
  return document.body.innerHTML;
}
