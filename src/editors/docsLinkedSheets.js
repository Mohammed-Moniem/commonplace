import {Node} from '@tiptap/core';
import {validateLinkedSnapshot} from '../lib/linkedSheets.js';

const safeSnapshot=value=>{try{return validateLinkedSnapshot(value);}catch{return null;}};
const cellStyle=format=>{const style=[];if(/^#[0-9a-f]{6}$/i.test(format?.bg||''))style.push('background:'+format.bg);if(/^#[0-9a-f]{6}$/i.test(format?.color||''))style.push('color:'+format.color);if(format?.bold)style.push('font-weight:700');if(format?.italic)style.push('font-style:italic');if(['left','center','right'].includes(format?.align))style.push('text-align:'+format.align);return style.join(';');};
export const LinkedSheetBlock=Node.create({
  name:'linkedSheetBlock',group:'block',atom:true,draggable:true,
  addAttributes:()=>({id:{default:null},snapshot:{default:null}}),
  parseHTML:()=>[{tag:'figure[data-type="linked-sheet"]',getAttrs:element=>{try{const encoded=element.getAttribute('data-linked-sheet-snapshot')||'';if(encoded.length>6_000_000)return false;const snapshot=safeSnapshot(JSON.parse(decodeURIComponent(encoded)));return snapshot?{id:element.getAttribute('data-linked-sheet-id')||crypto.randomUUID(),snapshot}:false;}catch{return false;}}}],
  renderHTML:({node})=>{const snapshot=safeSnapshot(node.attrs.snapshot);if(!snapshot)return['p',{},'Linked spreadsheet unavailable'];const caption=`${snapshot.source.fileTitle} · ${snapshot.source.sheetName} · source version${snapshot.source.version}`;const body=snapshot.kind==='chart'&&snapshot.chartImage?['img',{src:snapshot.chartImage,alt:snapshot.chart.title,width:'600',style:'max-width:100%;height:auto'}]:['table',{style:'border-collapse:collapse;width:100%'},['tbody',...snapshot.rows.map((row,r)=>['tr',...row.map((value,c)=>[r===0?'th':'td',{style:'border:1px solid #ccd9cc;padding:6px 9px;'+cellStyle(snapshot.formats?.[r]?.[c])},value])])]];return['figure',{'data-type':'linked-sheet','data-linked-sheet-id':node.attrs.id,'data-linked-sheet-snapshot':encodeURIComponent(JSON.stringify(snapshot)),class:'docs-linked-sheet',contenteditable:'false'},['figcaption',{style:'font:11px Arial;color:#6e816a;margin-bottom:8px'},caption],body];},
});
export function insertLinkedSheet(editor,snapshot){validateLinkedSnapshot(snapshot);return editor.chain().focus().insertContent({type:'linkedSheetBlock',attrs:{id:crypto.randomUUID(),snapshot:structuredClone(snapshot)}}).run();}
export async function refreshLinkedSheets(editor,resolve){
  if(editor.isDestroyed||!editor.isEditable)throw new Error('This document is not editable.');
  const originalDoc=editor.state.doc,before=[];originalDoc.descendants((node,pos)=>{if(node.type.name==='linkedSheetBlock')before.push({pos,id:node.attrs.id,snapshot:node.attrs.snapshot});});if(!before.length)throw new Error('This document has no linked spreadsheet content.');
  const updates=await Promise.all(before.map(async entry=>({...entry,next:validateLinkedSnapshot(await resolve(entry.snapshot.source))})));
  if(editor.isDestroyed||!editor.isEditable||editor.state.doc!==originalDoc)throw new Error('The document changed while refreshing. Try again.');
  const tr=editor.state.tr;let count=0;
  for(const update of updates){const node=originalDoc.nodeAt(update.pos);if(node?.type.name!=='linkedSheetBlock'||node.attrs.id!==update.id)throw new Error('A linked block changed while refreshing. Try again.');tr.setNodeMarkup(update.pos,undefined,{...node.attrs,snapshot:update.next});count++;}
  if(count)editor.view.dispatch(tr);return count;
}
