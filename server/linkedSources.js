// Backup imports append independent files. Remap links to the newly imported sources.
export function remapLinkedSources(kind,content,fileMap){
  const next=structuredClone(content);
  const remap=source=>source&&fileMap[source.fileId]?{...source,fileId:fileMap[source.fileId]}:source;
  const html=value=>typeof value!=='string'?value:value.replace(/data-linked-sheet-snapshot=(['"])(.*?)\1/g,(match,quote,encoded)=>{try{const snapshot=JSON.parse(decodeURIComponent(encoded));snapshot.source=remap(snapshot.source);return 'data-linked-sheet-snapshot="'+encodeURIComponent(JSON.stringify(snapshot))+'"';}catch{return match;}});
  if(kind==='slides')for(const slide of next.slides||[])for(const element of slide.elements||[])if(element.linkedSheet)element.linkedSheet=remap(element.linkedSheet);
  if(kind==='docs'){next.html=html(next.html);for(const tab of next.tabs||[])tab.html=html(tab.html);}
  return next;
}
