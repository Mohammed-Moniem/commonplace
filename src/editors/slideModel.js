import {validateRichText,plainRichText} from './slideRichText.js';
export const SLIDE_TYPES = ['text','shape','image','table','chart','audio','video','connector'];
export const createId = () => globalThis.crypto.randomUUID();
export const clone = value => JSON.parse(JSON.stringify(value));
export const dimensions = content => ({width:960,height:content?.aspectRatio==='4:3'?720:540});
export const DEFAULT_MASTER = {background:'#ffffff',fontFamily:'Arial',titleSize:48,bodySize:28,color:'#202124',accent:'#f9ab00'};
export const THEMES = [{id:'paper',name:'Paper',bg:'#ffffff',ink:'#202124',accent:'#f9ab00',muted:'#5f6368'},{id:'midnight',name:'Midnight',bg:'#192c3c',ink:'#ffffff',accent:'#f9d871',muted:'#c8d7e3'},{id:'sage',name:'Sage',bg:'#eef2e8',ink:'#294a37',accent:'#84aa85',muted:'#617366'},{id:'rose',name:'Rose',bg:'#fcf0ea',ink:'#633c37',accent:'#d68070',muted:'#976f66'},{id:'cobalt',name:'Cobalt',bg:'#edf2ff',ink:'#183153',accent:'#4285f4',muted:'#65799a'},{id:'ink',name:'Ink',bg:'#faf8f3',ink:'#222222',accent:'#ef633d',muted:'#77736c'}];
export function makeText(text,x=100,y=100,width=700,height=100,style={}) {return {id:createId(),type:'text',text,x,y,width,height,style:{fontSize:32,fontFamily:'Arial',color:'#202124',align:'left',...style}};}
export function createSlide(content={},layout='title') {
 const t=THEMES.find(t=>t.id===content.theme)||THEMES[0], m={...DEFAULT_MASTER,background:t.bg,color:t.ink,accent:t.accent,...content.master}, {height}=dimensions(content);
 const title=(text,y=70)=>makeText(text,70,y,820,110,{fontSize:m.titleSize,fontFamily:m.fontFamily,color:m.color,bold:true});
 const body=(text,x=75,y=210,w=810,h=260)=>makeText(text,x,y,w,h,{fontSize:m.bodySize,fontFamily:m.fontFamily,color:m.color});
 let elements=[];
 if(layout==='title')elements=[title('Your next big idea',height*.28),body('A little context goes a long way.',75,height*.53,810,80),{id:createId(),type:'shape',x:75,y:height*.23,width:76,height:7,style:{fill:m.accent}}];
 if(layout==='body')elements=[title('Make your point',45),body('•  Start with the big picture\n\n•  Give your audience something useful\n\n•  Leave them with a clear next step',75,190,810,height-210)];
 if(layout==='section')elements=[{id:createId(),type:'shape',x:0,y:0,width:20,height,style:{fill:m.accent}},title('A new chapter',height*.35),body('Set the scene for what comes next.',75,height*.58,810,80)];
 if(layout==='two-column')elements=[title('Two sides of the story',45),body('The opportunity\n\nTell your audience what matters.',65,185,390,height-210),body('The possibility\n\nBring your perspective to life.',505,185,390,height-210)];
 if(layout==='quote')elements=[makeText('“',80,50,150,140,{fontSize:120,bold:true,color:m.accent}),title('Great things begin with a simple idea.',height*.32),body('— Your name',90,height*.75,780,70)];
 return {id:createId(),background:m.background,layout,elements,notes:'',transition:'none'};
}
export function normalizePresentation(value) {
 const doc=clone(value?.slides?.length?value:{slides:[createSlide()],theme:'paper',aspectRatio:'16:9'});
 const record=v=>v&&typeof v==='object'&&!Array.isArray(v),text=(v,max=100000)=>typeof v==='string'&&v.length<=max,finite=(v,min=-100000,max=100000)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max,fail=message=>{throw Error('Invalid presentation: '+message);};
 if(!Array.isArray(doc.slides)||!doc.slides.length||doc.slides.length>500)fail('use 1–500 slides.');
 const validPaint=v=>text(v,1000)&&!/url\s*\(|expression\s*\(|@import|[<>]/i.test(v);
 const slideIds=new Set();
 for(const slide of doc.slides){
  if(!record(slide)||!Array.isArray(slide.elements)||slide.elements.length>2000)fail('each slide needs a valid object list.');
  if(slide.id!==undefined&&(!text(slide.id,128)||slideIds.has(slide.id)))fail('slide identifiers must be unique text.');slideIds.add(slide.id);
  if(slide.notes!==undefined&&!text(slide.notes))fail('speaker notes must be text.');
  if(slide.background!==undefined&&!validPaint(slide.background))fail('background must be a valid CSS color.');
  if(slide.hidden!==undefined&&typeof slide.hidden!=='boolean'||slide.section!==undefined&&!text(slide.section,200))fail('slide visibility and section are invalid.');
  if(slide.backgroundImage!==undefined&&(!record(slide.backgroundImage)||!text(slide.backgroundImage.src,15000000)||!/^data:image\/(png|jpe?g|gif|webp|svg\+xml)(?:;|,)/i.test(slide.backgroundImage.src)||!['cover','contain'].includes(slide.backgroundImage.fit||'cover')||slide.backgroundImage.opacity!==undefined&&!finite(slide.backgroundImage.opacity,0,1)))fail('photo background is invalid.');
  const ids=new Set();for(const e of slide.elements){
   if(!record(e)||!SLIDE_TYPES.includes(e.type))fail('an object type is unsupported.');
   if(e.id!==undefined&&(!text(e.id,128)||ids.has(e.id)))fail('object identifiers must be unique text.');ids.add(e.id);
   if(!['x','y'].every(k=>finite(e[k]))||!['width','height'].every(k=>finite(e[k],.01,100000)))fail('object positions and sizes must be finite numbers.');
   if(e.rotation!==undefined&&!finite(e.rotation,-36000,36000))fail('rotation must be a finite angle.');
   if(e.groupId!==undefined&&e.groupId!==null&&!text(e.groupId,128))fail('group identifier must be text.');
   if(e.locked!==undefined&&typeof e.locked!=='boolean')fail('object lock must be boolean.');
   if(e.link!==undefined){if(!record(e.link)||!['url','slide'].includes(e.link.type)||e.link.type==='slide'&&!text(e.link.slideId,128))fail('object link is invalid.');if(e.link.type==='url'){try{if(!text(e.link.url,3000)||!['http:','https:','mailto:','tel:'].includes(new URL(e.link.url).protocol))fail('link protocol is unsafe.');}catch{fail('link protocol is unsafe.');}}}
   if(e.style!==undefined&&(!record(e.style)||Object.values(e.style).some(v=>v!==null&&typeof v==='object')))fail('object appearance is malformed.');
   const s=e.style||{};for(const key of ['color','fill','borderColor'])if(s[key]!==undefined&&!validPaint(s[key]))fail('object colors must be valid CSS colors.');
   for(const key of ['bold','italic','underline','wrap','shadow'])if(s[key]!==undefined&&typeof s[key]!=='boolean')fail('appearance flags must be boolean.');
   for(const key of ['fontSize','borderWidth','borderRadius'])if(s[key]!==undefined&&!finite(s[key],key==='fontSize'?1:0,key==='borderRadius'?10000:key==='borderWidth'?30:1000))fail('appearance sizes must be finite numbers.');
   if(s.opacity!==undefined&&!finite(s.opacity,0,1))fail('opacity must be between zero and one.');
   if(s.fontFamily!==undefined&&!text(s.fontFamily,200))fail('font family must be text.');
   if(s.verticalAlign!==undefined&&!['top','middle','bottom'].includes(s.verticalAlign))fail('vertical text alignment is invalid.');
   if(e.type==='text'&&!text(e.text))fail('text boxes must contain text.');
   if(e.richText!==undefined){if(e.type!=='text')fail('only text boxes can contain rich text.');validateRichText(e.richText);e.text=plainRichText(e.richText);}
   if(e.crop!==undefined&&(!record(e.crop)||!['x','y'].every(k=>finite(e.crop[k],0,1))||!['width','height'].every(k=>finite(e.crop[k],.01,1))||e.crop.x+e.crop.width>1.000001||e.crop.y+e.crop.height>1.000001))fail('image crop must stay inside the image.');
   if(e.mask!==undefined&&!['none','ellipse','rounded'].includes(e.mask)||e.imageFit!==undefined&&!['contain','cover'].includes(e.imageFit))fail('image mask or fit is invalid.');
   if(e.type==='connector'){for(const end of [e.from,e.to])if(!record(end)||!text(end.objectId,128)||!['auto','top','right','bottom','left'].includes(end.side||'auto'))fail('connector endpoints are invalid.');if(e.from.objectId===e.to.objectId||e.endArrow!==undefined&&typeof e.endArrow!=='boolean')fail('connector endpoints must be different objects.');}
   if(e.type==='table'){
    if(!Array.isArray(e.rows)||!e.rows.length||e.rows.length>100||e.rows.some(row=>!Array.isArray(row)||!row.length||row.length>50||row.some(cell=>!text(cell,10000))))fail('table cells must be a rectangular text grid with up to 100 rows and 50 columns.');
    const columns=Math.max(...e.rows.map(r=>r.length));e.rows=e.rows.map(r=>Array.from({length:columns},(_,i)=>r[i]||''));
    if(e.tableStyle!==undefined&&(!record(e.tableStyle)||e.tableStyle.header!==undefined&&typeof e.tableStyle.header!=='boolean'))fail('table appearance is malformed.');
    for(const key of ['headerFill','fill','borderColor','color'])if(e.tableStyle?.[key]!==undefined&&!validPaint(e.tableStyle[key]))fail('table colors are invalid.');
    if(e.tableStyle?.fontSize!==undefined&&!finite(e.tableStyle.fontSize,1,200))fail('table font size is invalid.');
   }
   if(e.type==='chart'&&(!['bar','line','pie'].includes(e.chartType)||!record(e.chartData)||!Array.isArray(e.chartData.labels)||!Array.isArray(e.chartData.values)||!e.chartData.labels.length||e.chartData.labels.length>1000||e.chartData.labels.length!==e.chartData.values.length||e.chartData.labels.some(v=>!text(v,1000))||e.chartData.values.some(v=>!finite(v,-1e15,1e15))))fail('chart labels and values must be matching text and numeric lists.');
   if(['image','audio','video'].includes(e.type)&&!text(e.src,15000000))fail('media source must be a data URL or supported image URL.');
   if(['audio','video'].includes(e.type)&&(!new RegExp('^data:'+e.type+'/(?:mpeg|mp3|wav|x-wav|ogg|mp4|webm);base64,','i').test(e.src)||e.name!==undefined&&!text(e.name,500)||e.playback!==undefined&&(!record(e.playback)||Object.values(e.playback).some(v=>typeof v!=='boolean'))))fail('local media or playback options are invalid.');
   if(e.animation!==undefined&&(!record(e.animation)||!['none','appear','fade','fly'].includes(e.animation.effect)||!Number.isInteger(e.animation.step)||e.animation.step<0||e.animation.step>100))fail('animation effect or step is invalid.');
  }
 }
 if(doc.master!==undefined&&!record(doc.master))fail('master defaults must be an object.');
 if(doc.snapToGuides!==undefined&&typeof doc.snapToGuides!=='boolean')fail('snapping must be boolean.');
 if(doc.footer!==undefined){const f=doc.footer;if(!record(f)||['enabled','showNumber'].some(k=>f[k]!==undefined&&typeof f[k]!=='boolean')||f.text!==undefined&&!text(f.text,2000)||f.color!==undefined&&!validPaint(f.color)||f.fontSize!==undefined&&!finite(f.fontSize,8,64)||f.startAt!==undefined&&(!Number.isInteger(f.startAt)||f.startAt<0||f.startAt>10000))fail('footer settings are invalid.');}
 if(doc.master){for(const key of ['background','color','accent'])if(doc.master[key]!==undefined&&!validPaint(doc.master[key]))fail('master color is invalid.');for(const key of ['titleSize','bodySize'])if(doc.master[key]!==undefined&&!finite(doc.master[key],1,300))fail('master font size is invalid.');if(doc.master.fontFamily!==undefined&&!text(doc.master.fontFamily,200))fail('master font family is invalid.');}
 doc.theme=doc.theme||'paper';doc.aspectRatio=doc.aspectRatio==='4:3'?'4:3':'16:9';
 doc.slides=doc.slides.map(s=>({...s,id:s.id||createId(),background:s.background||'#ffffff',notes:s.notes||'',elements:(s.elements||[]).map(e=>({...e,id:e.id||createId(),style:e.style||{}}))}));
 return doc;
}
export function selectionIds(elements,id,{toggle=false,existing=[],insideGroup=false}={}) {
 const el=elements.find(e=>e.id===id);if(!el)return [];
 const ids=el.groupId&&!insideGroup?elements.filter(e=>e.groupId===el.groupId).map(e=>e.id):[id];
 if(!toggle)return ids;
 const remove=ids.every(id=>existing.includes(id));return remove?existing.filter(id=>!ids.includes(id)):[...new Set([...existing,...ids])];
}
export function selectionBounds(elements,ids) {
 const chosen=elements.filter(e=>ids.includes(e.id));if(!chosen.length)return null;
 const left=Math.min(...chosen.map(e=>e.x)),top=Math.min(...chosen.map(e=>e.y));
 return {x:left,y:top,width:Math.max(...chosen.map(e=>e.x+e.width))-left,height:Math.max(...chosen.map(e=>e.y+e.height))-top};
}
export function moveSelection(elements,ids,dx,dy) {return elements.map(e=>ids.includes(e.id)&&!e.locked?{...e,x:e.x+dx,y:e.y+dy}:e);}
export function resizeSelection(elements,ids,target) {
 ids=ids.filter(id=>!elements.find(e=>e.id===id)?.locked);const box=selectionBounds(elements,ids);if(!box)return elements;
 const sx=Math.max(4,target.width)/Math.max(1,box.width),sy=Math.max(4,target.height)/Math.max(1,box.height);
 return elements.map(e=>ids.includes(e.id)?{...e,x:target.x+(e.x-box.x)*sx,y:target.y+(e.y-box.y)*sy,width:Math.max(1,e.width*sx),height:Math.max(1,e.height*sy),...(e.type==='text'?{style:{...e.style,fontSize:Math.max(4,(e.style?.fontSize||32)*Math.min(sx,sy))},...(e.richText?{richText:{paragraphs:e.richText.paragraphs.map(p=>({...p,runs:p.runs.map(r=>({...r,style:{...r.style,...(r.style?.fontSize?{fontSize:r.style.fontSize*Math.min(sx,sy)}:{})}}))}))}}:{})}:{})}:e);
}
export function rotateSelection(elements,ids,angle) {
 ids=ids.filter(id=>!elements.find(e=>e.id===id)?.locked);const box=selectionBounds(elements,ids);if(!box)return elements;const cx=box.x+box.width/2,cy=box.y+box.height/2,r=angle*Math.PI/180;
 return elements.map(e=>{if(!ids.includes(e.id))return e;const dx=e.x+e.width/2-cx,dy=e.y+e.height/2-cy;return {...e,x:cx+dx*Math.cos(r)-dy*Math.sin(r)-e.width/2,y:cy+dx*Math.sin(r)+dy*Math.cos(r)-e.height/2,rotation:((e.rotation||0)+angle)%360};});
}
export function groupSelection(elements,ids,id=createId()) {if(ids.length<2)return elements;return elements.map(e=>ids.includes(e.id)?{...e,groupId:id}:e);}
export function ungroupSelection(elements,ids) {const groups=new Set(elements.filter(e=>ids.includes(e.id)).map(e=>e.groupId).filter(Boolean));return elements.map(e=>groups.has(e.groupId)?Object.fromEntries(Object.entries(e).filter(([k])=>k!=='groupId')):e);}
export function animationSteps(slide) {return [...new Set(slide.elements.filter(e=>e.animation?.effect&&e.animation.effect!=='none').map(e=>Math.max(1,+e.animation.step||1)))].sort((a,b)=>a-b);}
export function objectVisible(element,step=Infinity) {return !element.animation||element.animation.effect==='none'||(+element.animation.step||1)<=step;}
export function nextFrame(content,frame,direction=1) {
 const slide=content.slides[frame.index];const steps=animationSteps(slide);const position=steps.filter(s=>s<=frame.step).length;
 if(direction>0){if(position<steps.length)return {...frame,step:steps[position]};const index=content.slides.findIndex((s,i)=>i>frame.index&&!s.hidden);if(index>=0)return {...frame,index,step:0};return frame;}
 if(position)return {...frame,step:position>1?steps[position-2]:0};
 for(let index=frame.index-1;index>=0;index--)if(!content.slides[index].hidden)return {...frame,index,step:animationSteps(content.slides[index]).at(-1)||0};return frame;
}
export function applyMaster(content,master,all=false) {
 const next={...content,master:{...DEFAULT_MASTER,...content.master,...master}};
 if(all)next.slides=content.slides.map(s=>({...s,background:next.master.background,elements:s.elements.map(e=>({...e,style:{...e.style,...(e.type==='text'?{fontFamily:next.master.fontFamily,color:next.master.color,fontSize:(e.style?.fontSize||32)>=38?next.master.titleSize:next.master.bodySize}:e.type==='shape'?{fill:next.master.accent}:{})}}))}));
 return next;
}
export function makeTable() {return {id:createId(),type:'table',x:140,y:170,width:680,height:240,rows:[['Item','Plan','Actual'],['First idea','120','98'],['Next step','80','64']],tableStyle:{header:true,headerFill:'#e7edf7',fill:'#ffffff',borderColor:'#b5bfcc',fontSize:23,color:'#202124'},style:{}};}
export function makeChart(chartType='bar') {return {id:createId(),type:'chart',chartType,x:170,y:140,width:620,height:330,chartData:{labels:['Jan','Feb','Mar','Apr'],values:[40,65,52,88]},style:{fill:'#4285f4',color:'#202124',fontSize:18}};}
export function updateTableCell(element,row,column,text) {return {...element,rows:element.rows.map((r,i)=>i===row?r.map((v,j)=>j===column?text:v):r)};}
export function resizeTable(element,rows,columns) {rows=Math.max(1,Math.min(100,rows));columns=Math.max(1,Math.min(50,columns));return {...element,rows:Array.from({length:rows},(_,r)=>Array.from({length:columns},(_,c)=>element.rows?.[r]?.[c]||''))};}
export function changeAspectRatio(content,aspectRatio) {const before=dimensions(content),after=dimensions({aspectRatio});return {...content,aspectRatio,slides:content.slides.map(s=>({...s,elements:s.elements.map(e=>({...e,y:e.y*after.height/before.height,height:e.height*after.height/before.height}))}))};}
export function pptxLimitations(content) {const notes=[];const colors=content.slides.flatMap(s=>[s.background,...s.elements.flatMap(e=>[e.style?.color,e.style?.fill,e.style?.borderColor,e.tableStyle?.color,e.tableStyle?.headerFill,e.tableStyle?.fill,e.tableStyle?.borderColor])]).filter(Boolean);if(colors.some(c=>!/^#[a-f\d]{6}$/i.test(c)))notes.push('Native PowerPoint uses RGB fallback colors for CSS color names and functions. Local JSON and HTML preserve the original colors.');if(content.slides.some(s=>s.elements.some(e=>e.type==='audio'||e.type==='video')))notes.push('PowerPoint uses named media placeholder cards. Playable media is retained in HTML and editable Commonplace data.');if(content.slides.some(s=>s.elements.some(e=>e.animation?.effect&&e.animation.effect!=='none')))notes.push('Object animation steps play in Commonplace and HTML; PowerPoint objects are initially visible.');return notes;}
