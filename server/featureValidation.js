const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=1000)=>typeof value==='string'&&value.length<=max;
const id=value=>text(value,128)&&value.length>0;
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const color=value=>text(value,1000)&&!/url\s*\(|expression\s*\(|@import|[<>]/i.test(value);
const range=value=>record(value)&&['row','endRow'].every(key=>Number.isInteger(value[key])&&finite(value[key],0,9999))&&['col','endCol'].every(key=>Number.isInteger(value[key])&&finite(value[key],0,199))&&value.row<=value.endRow&&value.col<=value.endCol;
const safeUrl=value=>text(value,2048)&&/^(https?:\/\/|mailto:)/i.test(value)&&!/[\x00-\x20<>]/.test(value);
const image=value=>text(value,15_000_000)&&/^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|svg\+xml)(?:;|,))/i.test(value);
const fail=message=>{throw new Error(message);};

export function validLinkedSheet(source){return record(source)&&id(source.fileId)&&id(source.sheetId)&&range(source.range)&&Number.isInteger(source.version)&&source.version>0&&text(source.fileTitle,240)&&text(source.sheetName,200)&&(!('chartId'in source)||id(source.chartId));}

function validFilter(filter){return record(filter)&&range(filter.range)&&typeof filter.header==='boolean'&&Array.isArray(filter.criteria)&&filter.criteria.length<=200&&filter.criteria.every(row=>record(row)&&Number.isInteger(row.col)&&row.col>=filter.range.col&&row.col<=filter.range.endCol&&['contains','equals','notEquals','greater','less','empty','notEmpty'].includes(row.operator)&&text(row.value,1000));}

export function validateFeatureContent(kind,content){
  if(kind==='docs'&&content.tabs){
    const tabs=new Map(content.tabs.map(tab=>[tab.id,tab]));
    for(const tab of content.tabs){let parent=tab.parentId,depth=0;const seen=new Set([tab.id]);while(parent!=null){if(!id(parent)||!tabs.has(parent)||seen.has(parent)||++depth>2)fail('Document tabs need an existing parent, no cycles, and at most three levels.');seen.add(parent);parent=tabs.get(parent).parentId;}}
  }
  if(kind==='sheets')for(const sheet of content.sheets){
    if('tabColor'in sheet&&sheet.tabColor!==null&&(!text(sheet.tabColor,7)||!/^#[0-9a-f]{6}$/i.test(sheet.tabColor)))fail('Worksheet tab color is invalid.');
    if('filterState'in sheet&&sheet.filterState!==null&&!validFilter(sheet.filterState))fail('Column filter configuration is invalid.');
    if('filterViews'in sheet){const views=sheet.filterViews;if(!Array.isArray(views)||views.length>50||new Set(views.map(view=>view?.id)).size!==views.length||views.some(view=>!record(view)||!id(view.id)||!text(view.name,200)||!view.name.trim()||!validFilter(view.filter)))fail('Saved filter views are invalid.');}
    for(const cell of Object.values(sheet.cells)){
      if('checkbox'in cell&&typeof cell.checkbox!=='boolean')fail('Cell checkbox is invalid.');
      if('note'in cell&&!text(cell.note,10000))fail('Cell note is too long.');
      if('link'in cell&&cell.link!==''&&!safeUrl(cell.link))fail('Cell links must use HTTP, HTTPS, or mailto.');
    }
    for(const rule of sheet.conditionalRules||[])if(rule.type==='formula'&&(!text(rule.value,1000)||!rule.value.startsWith('=')))fail('Conditional formula must begin with =.');
    for(const rule of sheet.validations||[])if(rule.type==='formula'&&(!text(rule.formula,1000)||!rule.formula.startsWith('=')))fail('Validation formula must begin with =.');
  }
  if(kind==='slides'){
    if('snapToGuides'in content&&typeof content.snapToGuides!=='boolean')fail('Snap to guides setting is invalid.');
    if('footer'in content){const f=content.footer;if(!record(f)||['enabled','showNumber'].some(key=>key in f&&typeof f[key]!=='boolean')||'text'in f&&!text(f.text,500)||'startAt'in f&&(!Number.isInteger(f.startAt)||!finite(f.startAt,0,10000))||'color'in f&&!color(f.color)||'fontSize'in f&&!finite(f.fontSize,6,100))fail('Presentation footer is invalid.');}
    const slideIds=new Set(content.slides.map(slide=>slide.id));
    for(const slide of content.slides){
      if('hidden'in slide&&typeof slide.hidden!=='boolean')fail('Hidden slide setting is invalid.');
      if('section'in slide&&!text(slide.section,200))fail('Slide section name is too long.');
      if('backgroundImage'in slide&&slide.backgroundImage!==null){const b=slide.backgroundImage;if(!record(b)||!image(b.src)||!['cover','contain'].includes(b.fit)||!finite(b.opacity,0,1))fail('Slide background image is invalid.');}
      const objects=new Map(slide.elements.map(element=>[element.id,element]));
      for(const element of slide.elements){
        if('locked'in element&&typeof element.locked!=='boolean')fail('Object lock is invalid.');
        if('linkedSheet'in element&&!validLinkedSheet(element.linkedSheet))fail('Linked spreadsheet source is invalid.');
        if('link'in element&&element.link!==null){const link=element.link;if(!record(link)||!['url','slide'].includes(link.type)||link.type==='url'&&!safeUrl(link.url)||link.type==='slide'&&!slideIds.has(link.slideId))fail('Object link is invalid.');}
        if('crop'in element&&element.crop!==null){const c=element.crop;if(!record(c)||!finite(c.x,0,1)||!finite(c.y,0,1)||!finite(c.width,0.001,1)||!finite(c.height,0.001,1)||c.x+c.width>1.000001||c.y+c.height>1.000001)fail('Image crop must stay inside the source image.');}
        if('mask'in element&&!['none','ellipse','rounded'].includes(element.mask))fail('Image mask is invalid.');
        if('imageFit'in element&&!['contain','cover'].includes(element.imageFit))fail('Image fit is invalid.');
        if(element.style&&'verticalAlign'in element.style&&!['top','middle','bottom'].includes(element.style.verticalAlign))fail('Vertical text alignment is invalid.');
        if(element.type==='connector'){for(const endpoint of [element.from,element.to])if(!record(endpoint)||!objects.has(endpoint.objectId)||endpoint.objectId===element.id||objects.get(endpoint.objectId).type==='connector'||!['auto','top','right','bottom','left'].includes(endpoint.side))fail('Connectors need two existing objects.');if('endArrow'in element&&typeof element.endArrow!=='boolean')fail('Connector arrow setting is invalid.');}
        if('richText'in element){const rich=element.richText;if(!record(rich)||!Array.isArray(rich.paragraphs)||!rich.paragraphs.length||rich.paragraphs.length>1000)fail('Rich text paragraphs are invalid.');let size=0,runs=0;for(const p of rich.paragraphs){if(!record(p)||!Array.isArray(p.runs)||p.runs.length>5000||!['none','bullet','number'].includes(p.list)||!Number.isInteger(p.level)||!finite(p.level,0,5)||!['left','center','right','justify'].includes(p.align)||!finite(p.lineHeight,0.5,3)||!finite(p.spaceBefore,0,100)||!finite(p.spaceAfter,0,100))fail('Rich text paragraph formatting is invalid.');for(const run of p.runs){if(!record(run)||!text(run.text,100000)||!record(run.style)||++runs>5000||(size+=run.text.length)>100000)fail('Rich text runs are invalid.');const style=run.style;if(['bold','italic','underline','strike'].some(key=>key in style&&typeof style[key]!=='boolean')||'color'in style&&!color(style.color)||'fontSize'in style&&!finite(style.fontSize,1,1000)||'fontFamily'in style&&(!text(style.fontFamily,200)||/[\x00-\x1f<>]/.test(style.fontFamily)))fail('Rich text run style is invalid.');}}}
      }
    }
  }
  return content;
}
