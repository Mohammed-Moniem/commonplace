// Imported markup is constrained before it reaches the rich text schema.
export function sanitizeHtml(html) {
  const document = new DOMParser().parseFromString(String(html), 'text/html');
  document.querySelectorAll('script,style,iframe,object,embed,form,meta,link,base,svg,math').forEach(node=>node.remove());
  for (const node of document.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name)||['srcdoc','formaction'].includes(attr.name)) node.removeAttribute(attr.name);
      if (['href','src','xlink:href'].includes(attr.name)&& !/^(https?:|mailto:|tel:|#|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(attr.value)) node.removeAttribute(attr.name);
      if(attr.name==='style'&&/url\s*\(|expression\s*\(|@import/i.test(attr.value))node.removeAttribute('style');
    }
  }
  return document.body.innerHTML;
}
