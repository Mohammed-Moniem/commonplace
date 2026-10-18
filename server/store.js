import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {validateFeatureContent} from './featureValidation.js';

export const kinds = ['docs','sheets','slides'];
export function blankContent(kind) {
  if(kind==='docs') return {html:'<p></p>',page:{size:'a4',orientation:'portrait',margin:72}};
  if(kind==='sheets') return {sheets:[{id:'sheet-1',name:'Sheet 1',cells:{}}],activeSheetId:'sheet-1'};
  return {slides:[{id:randomUUID(),background:'#ffffff',elements:[],notes:''}],theme:'paper',aspectRatio:'16:9'};
}
export function validateContent(kind, content) {
  const invalid = (message) => { throw new Error(message); };
  const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
  const text = (value, max = 1000) => typeof value === 'string' && value.length <= max;
  const id = (value) => text(value, 128) && value.length > 0;
  const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  const paint = (value) => text(value, 1000) && !/url\s*\(|expression\s*\(|@import|[<>]/i.test(value);
  const range = (value) => record(value) && ['row', 'endRow'].every((key) => Number.isInteger(value[key]) && finite(value[key], 0, 9999)) && ['col', 'endCol'].every((key) => Number.isInteger(value[key]) && finite(value[key], 0, 199)) && value.row<=value.endRow && value.col<=value.endCol;
  const format = (value, slide = false) => {
    if (!record(value)) return false;
    for (const key of ['bold', 'italic', 'underline', 'wrap', 'shadow']) if (key in value && typeof value[key] !== 'boolean') return false;
    for (const key of ['color', 'bg', 'fill', 'borderColor']) if (key in value && !paint(value[key])) return false;
    if ('fontSize' in value && !finite(value.fontSize, 1, 1000)) return false;
    if ('borders' in value && (!record(value.borders)||Object.entries(value.borders).some(([side,border])=>!['top','right','bottom','left'].includes(side)||!record(border)||!paint(border.color)||!finite(border.width,0,10)||!['solid','dashed','dotted','none'].includes(border.style))))return false;
    if ('align' in value && !['left', 'center', 'right', 'justify', 'general'].includes(value.align)) return false;
    if ('numberFormat' in value && !['auto', 'text', 'number', 'currency', 'percent', 'date', 'time', 'datetime', 'scientific'].includes(value.numberFormat)) return false;
    if ('fontFamily' in value && (!text(value.fontFamily, 200) || /[\x00-\x1f<>]/.test(value.fontFamily))) return false;
    if ('decimalPlaces' in value && (!Number.isInteger(value.decimalPlaces) || !finite(value.decimalPlaces, 0, 10))) return false;
    if ('dateFormat' in value && !['iso', 'short', 'long'].includes(value.dateFormat)) return false;
    if (slide) {
      if ('fontSize' in value && !finite(value.fontSize, 1, 1000)) return false;
      if ('fontFamily' in value && !text(value.fontFamily, 200)) return false;
      if ('opacity' in value && !finite(value.opacity, 0, 1)) return false;
      if ('borderRadius' in value && !finite(value.borderRadius, 0, 10000)) return false;
      if ('shape' in value && !text(value.shape, 100)) return false;
      if ('borderWidth' in value && !finite(value.borderWidth,0,30))return false;
      if ('borderStyle' in value && !['solid','dashed','dotted'].includes(value.borderStyle))return false;
    }
    return true;
  };
  if (!kinds.includes(kind)) invalid('Choose Docs, Sheets, or Slides.');
  if (!record(content)) invalid('File content must be an object.');
  if (JSON.stringify(content).length > 15_000_000) invalid('File is larger than the 15 MB local limit.');
  if (kind === 'docs') {
    if (!text(content.html, 15_000_000)) invalid('A document must contain HTML text.');
    const validPage=page=>record(page)&&(!('mode'in page)||['pages','pageless'].includes(page.mode))&&(!('size'in page)||['a4','letter'].includes(page.size))&&(!('orientation'in page)||['portrait','landscape'].includes(page.orientation))&&(!('margin'in page)||finite(page.margin,0,300))&&!['header','footer'].some(key=>key in page&&!text(page[key],2000))&&(!('pageNumbers'in page)||typeof page.pageNumbers==='boolean');
    if ('page' in content&&!validPage(content.page))invalid('Document page settings are invalid.');
    if('tabs'in content){
      if(!Array.isArray(content.tabs)||!content.tabs.length||content.tabs.length>100)invalid('A document needs 1–100 tabs.');
      const tabs=new Set();for(const tab of content.tabs){if(!record(tab)||!id(tab.id)||tabs.has(tab.id)||!text(tab.name,200)||!tab.name.trim()||!text(tab.html,15_000_000)||'page'in tab&&!validPage(tab.page))invalid('Document tabs are invalid.');tabs.add(tab.id);}
      if('activeTabId'in content&&!tabs.has(content.activeTabId))invalid('The active document tab does not exist.');
    }
  }
  if (kind === 'sheets') {
    if (!Array.isArray(content.sheets) || !content.sheets.length || content.sheets.length > 100) invalid('A workbook must contain 1–100 worksheets.');
    const ids = new Set(); let cellCount = 0;
    for (const sheet of content.sheets) {
      if (!record(sheet) || !id(sheet.id) || ids.has(sheet.id) || !text(sheet.name, 200) || !sheet.name.trim() || !record(sheet.cells)) invalid('A workbook must contain valid worksheets with unique identifiers.');
      ids.add(sheet.id);
      for (const [key, cell] of Object.entries(sheet.cells)) {
        if (++cellCount > 100000) invalid('A workbook can contain at most 100,000 populated cells.');
        const match = /^([A-Z]{1,3})([1-9]\d{0,4})$/.exec(key);
        const column = match ? [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) : 0;
        if (!match || Number(match[2]) > 10000 || column > 200 || !record(cell) || !text(cell.value, 100000) || 'format' in cell && !format(cell.format)) invalid(`Invalid spreadsheet cell: ${key}.`);
      }
      if ('columnWidths' in sheet && (!record(sheet.columnWidths) || Object.entries(sheet.columnWidths).some(([col, width]) => !/^(0|[1-9]\d{0,2})$/.test(col) || Number(col) > 199 || !finite(width, 20, 2000)))) invalid('Spreadsheet column widths are invalid.');
      if ('frozenRows' in sheet && (!Number.isInteger(sheet.frozenRows) || !finite(sheet.frozenRows, 0, 10000))) invalid('Spreadsheet frozen rows are invalid.');
      if ('frozenCols'in sheet&&(!Number.isInteger(sheet.frozenCols)||!finite(sheet.frozenCols,0,200)))invalid('Spreadsheet frozen columns are invalid.');
      if ('rowHeights'in sheet&&(!record(sheet.rowHeights)||Object.entries(sheet.rowHeights).some(([row,height])=>!/^\d{1,4}$/.test(row)||!finite(height,15,1000))))invalid('Spreadsheet row heights are invalid.');
      for(const [key,max]of [['hiddenRows',9999],['hiddenCols',199]])if(key in sheet&&(!Array.isArray(sheet[key])||sheet[key].length>max+1||sheet[key].some(n=>!Number.isInteger(n)||!finite(n,0,max))))invalid('Hidden spreadsheet coordinates are invalid.');
      if('merges'in sheet){if(!Array.isArray(sheet.merges)||sheet.merges.length>10000)invalid('Merged cell ranges are invalid.');for(let i=0;i<sheet.merges.length;i++){const a=sheet.merges[i];if(!range(a)||a.row>a.endRow||a.col>a.endCol)invalid('Merged cell ranges are invalid.');for(let j=0;j<i;j++){const b=sheet.merges[j];if(a.row<=b.endRow&&a.endRow>=b.row&&a.col<=b.endCol&&a.endCol>=b.col)invalid('Merged ranges cannot overlap.');}}}
      if('protected'in sheet&&typeof sheet.protected!=='boolean')invalid('Sheet editing protection is invalid.');
      if('protectedRanges'in sheet&&(!Array.isArray(sheet.protectedRanges)||sheet.protectedRanges.length>500||sheet.protectedRanges.some(r=>!record(r)||!id(r.id)||!range(r.range))))invalid('Protected ranges are invalid.');
      if ('charts' in sheet && (!Array.isArray(sheet.charts) || sheet.charts.length > 100 || sheet.charts.some((chart) => !record(chart) || !id(chart.id) || !['bar', 'line','pie','scatter','stacked','area','doughnut'].includes(chart.type) || !text(chart.title, 500) || !range(chart.range) || 'options'in chart&&(!record(chart.options)||'showLabels'in chart.options&&typeof chart.options.showLabels!=='boolean'||'color'in chart.options&&!paint(chart.options.color))))) invalid('Spreadsheet charts are invalid.');
      if ('conditionalRules' in sheet && (!Array.isArray(sheet.conditionalRules) || sheet.conditionalRules.length > 500 || sheet.conditionalRules.some((rule) => !record(rule) || !id(rule.id) || !range(rule.range) || !['greater', 'less', 'equal', 'contains', 'empty', 'notEmpty', 'formula'].includes(rule.type) || !text(rule.value, 1000) || !format(rule.style)))) invalid('Conditional formatting rules are invalid.');
      if ('validations' in sheet && (!Array.isArray(sheet.validations) || sheet.validations.length > 500 || sheet.validations.some((rule) => !record(rule) || !id(rule.id) || !range(rule.range) || typeof rule.strict !== 'boolean' || (rule.type === 'formula' ? !text(rule.formula,1000) : !Array.isArray(rule.options) || !rule.options.length || rule.options.length > 100 || rule.options.some((option) => !text(option, 1000)))))) invalid('Spreadsheet dropdown rules are invalid.');
      if ('pivot' in sheet && (!record(sheet.pivot) || !id(sheet.pivot.sourceSheetId) || !range(sheet.pivot.range) || !['groupCol', 'valueCol'].every((key) => Number.isInteger(sheet.pivot[key]) && finite(sheet.pivot[key], 0, 199)) || !['SUM', 'COUNT', 'AVERAGE', 'MIN', 'MAX'].includes(sheet.pivot.aggregate))) invalid('Pivot table settings are invalid.');
      if(sheet.pivot&&('groupCols'in sheet.pivot&&(!Array.isArray(sheet.pivot.groupCols)||!sheet.pivot.groupCols.length||sheet.pivot.groupCols.length>10||new Set(sheet.pivot.groupCols).size!==sheet.pivot.groupCols.length||sheet.pivot.groupCols.some(col=>!Number.isInteger(col)||!finite(col,0,199)))||'columnCol'in sheet.pivot&&sheet.pivot.columnCol!==null&&(!Number.isInteger(sheet.pivot.columnCol)||!finite(sheet.pivot.columnCol,0,199))))invalid('Pivot grouping columns are invalid.');
    }
    if ('activeSheetId' in content && !ids.has(content.activeSheetId)) invalid('The active worksheet does not exist.');
    if('namedRanges'in content){if(!Array.isArray(content.namedRanges)||content.namedRanges.length>1000)invalid('Named ranges are invalid.');const names=new Set();for(const named of content.namedRanges){if(!record(named)||!text(named.name,250)||!/^[_A-Za-z][_A-Za-z0-9]*$/.test(named.name)||/^([A-Za-z]+\d+|TRUE|FALSE|R\d+C\d+)$/i.test(named.name)||names.has(named.name.toLowerCase())||!ids.has(named.sheetId)||!range(named.range))invalid('Named ranges need unique names and valid sheet coordinates.');names.add(named.name.toLowerCase());}}
  }
  if (kind === 'slides') {
    if (!Array.isArray(content.slides) || !content.slides.length || content.slides.length > 500) invalid('A presentation must contain 1–500 slides.');
    const ids = new Set(); let total = 0;
    for (const slide of content.slides) {
      if (!record(slide) || !id(slide.id) || ids.has(slide.id) || !Array.isArray(slide.elements) || slide.elements.length > 2000 || 'background' in slide && !paint(slide.background) || 'notes' in slide && !text(slide.notes, 100000) || 'layout' in slide && !text(slide.layout, 100) || 'transition' in slide && !['none', 'fade','slide','zoom'].includes(slide.transition)) invalid('A presentation must contain valid slides with unique identifiers.');
      ids.add(slide.id); const elementIds = new Set();
      for (const element of slide.elements) {
        if (++total > 100000) invalid('A presentation contains too many objects.');
        if (!record(element) || !id(element.id) || elementIds.has(element.id) || !['text', 'shape', 'image','table','chart','audio','video','connector'].includes(element.type) || !['x', 'y'].every((key) => finite(element[key], -100000, 100000)) || !['width', 'height'].every((key) => finite(element[key], 0.01, 100000)) || 'style' in element && !format(element.style, true)) invalid('Slide objects must have valid identifiers, types, positions, and sizes.');
        elementIds.add(element.id);
        if (element.type === 'text' && !text(element.text, 100000)) invalid('Slide text is invalid.');
        if (element.type === 'image' && (!text(element.src, 15_000_000) || !/^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|svg\+xml)(?:;|,))/i.test(element.src) || 'alt' in element && !text(element.alt, 10000))) invalid('Slide images must use an image data URL or an HTTP URL.');
        if('rotation'in element&&!finite(element.rotation,-360,360))invalid('Object rotation is invalid.');
        if('groupId'in element&&element.groupId!==null&&!id(element.groupId))invalid('Object group is invalid.');
        if('animation'in element&&(!record(element.animation)||!['none','appear','fade','fly'].includes(element.animation.effect)||!Number.isInteger(element.animation.step)||!finite(element.animation.step,0,100)))invalid('Object animation is invalid.');
        if(element.type==='table'){if(!Array.isArray(element.rows)||!element.rows.length||element.rows.length>100||element.rows.some(row=>!Array.isArray(row)||!row.length||row.length>50||row.some(cell=>!text(cell,10000))))invalid('Slide table data is invalid.');if('tableStyle'in element&&(!record(element.tableStyle)||'header'in element.tableStyle&&typeof element.tableStyle.header!=='boolean'||['headerFill','fill','borderColor','color'].some(key=>key in element.tableStyle&&!paint(element.tableStyle[key]))||'fontSize'in element.tableStyle&&!finite(element.tableStyle.fontSize,1,200)))invalid('Slide table style is invalid.');}
        if(element.type==='chart'&&(!['bar','line','pie'].includes(element.chartType)||!record(element.chartData)||!Array.isArray(element.chartData.labels)||!Array.isArray(element.chartData.values)||!element.chartData.labels.length||element.chartData.labels.length>1000||element.chartData.values.length!==element.chartData.labels.length||element.chartData.labels.some(v=>!text(v,1000))||element.chartData.values.some(v=>!finite(v,-1e15,1e15))))invalid('Slide chart data is invalid.');
        if(['audio','video'].includes(element.type)){const mediaPattern=element.type==='audio'?/^data:audio\/(mpeg|mp3|wav|x-wav|ogg|mp4|webm);base64,/i:/^data:video\/(mp4|webm|ogg);base64,/i;if(!text(element.src,15_000_000)||!mediaPattern.test(element.src)||'mime'in element&&!text(element.mime,100)||'name'in element&&!text(element.name,500)||'playback'in element&&(!record(element.playback)||['autoplay','loop','muted'].some(key=>key in element.playback&&typeof element.playback[key]!=='boolean')))invalid('Local presentation media is invalid.');}
      }
    }
    if ('theme' in content && !text(content.theme, 100)) invalid('Presentation theme is invalid.');
    if ('aspectRatio' in content && !['16:9', '4:3'].includes(content.aspectRatio)) invalid('Presentation aspect ratio is invalid.');
    if('master'in content&&(!record(content.master)||['background','color','accent'].some(key=>key in content.master&&!paint(content.master[key]))||'fontFamily'in content.master&&!text(content.master.fontFamily,200)||['titleSize','bodySize'].some(key=>key in content.master&&!finite(content.master[key],1,300))))invalid('Presentation master settings are invalid.');
  }
  return validateFeatureContent(kind,content);
}
export function openStore(filename, {seed=true}={}) {
  if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true});
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('docs','sheets','slides')),title TEXT NOT NULL,content TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,starred INTEGER NOT NULL DEFAULT 0,trashed INTEGER NOT NULL DEFAULT 0,folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,version INTEGER NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,name TEXT,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS versions_file ON versions(file_id,version DESC);
    CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,body TEXT NOT NULL,author TEXT NOT NULL DEFAULT 'You',resolved INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS comments_file ON comments(file_id);`);
  db.exec(`CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('docs','sheets','slides')),content TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  function file(id) { const row=db.prepare('SELECT * FROM files WHERE id=?').get(id); return row?{...row,content:JSON.parse(row.content),starred:!!row.starred,trashed:!!row.trashed}:null; }
  function snapshot(row,name=null) {
    db.prepare('INSERT INTO versions(id,file_id,version,title,content,name,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),row.id,row.version,row.title,JSON.stringify(row.content),name,row.updated_at);
    db.prepare('DELETE FROM versions WHERE file_id=? AND name IS NULL AND id NOT IN (SELECT id FROM versions WHERE file_id=? ORDER BY version DESC LIMIT 100)').run(row.id,row.id);
  }
  function atomic(operation) {
    if(db.isTransaction)return operation();
    db.exec('BEGIN IMMEDIATE');
    try{const result=operation();db.exec('COMMIT');return result;}
    catch(error){db.exec('ROLLBACK');throw error;}
  }
  function create({kind,title,content,folderId=null,starred=false}) {
    return atomic(()=>{
    if(!kinds.includes(kind)) throw new Error('Choose Docs, Sheets, or Slides.');
    if(typeof title!=='string'||!title.trim()||title.length>240)throw new Error('Enter a file name between 1 and 240 characters.');
    content=validateContent(kind,content??blankContent(kind));
    if(folderId&&!db.prepare('SELECT id FROM folders WHERE id=?').get(folderId))throw new Error('Folder not found.');
    const id=randomUUID(),now=new Date().toISOString();
    db.prepare('INSERT INTO files(id,kind,title,content,starred,folder_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,kind,title.trim(),JSON.stringify(content),starred?1:0,folderId,now,now);
    const row=file(id);snapshot(row);return row;
    });
  }
  function update(id,patch) {
    return atomic(()=>{
    const row=file(id);if(!row)return null;
    if(('content' in patch||'title' in patch)&&patch.version!==row.version){const error=new Error('This file changed in another tab. Your draft is safe; choose which version to keep.');error.status=409;error.current=row;throw error;}
    if('title' in patch&&(typeof patch.title!=='string'||!patch.title.trim()||patch.title.length>240))throw new Error('Enter a file name between 1 and 240 characters.');
    if('content' in patch)validateContent(row.kind,patch.content);
    if(patch.folderId&&!db.prepare('SELECT id FROM folders WHERE id=?').get(patch.folderId))throw new Error('Folder not found.');
    const changed=('content' in patch||'title' in patch),next={...row,title:patch.title?.trim()??row.title,content:patch.content??row.content,starred:'starred' in patch?!!patch.starred:row.starred,trashed:'trashed' in patch?!!patch.trashed:row.trashed,folder_id:'folderId' in patch?patch.folderId:row.folder_id,version:row.version+(changed?1:0),updated_at:changed?new Date().toISOString():row.updated_at};
    db.prepare('UPDATE files SET title=?,content=?,version=?,starred=?,trashed=?,folder_id=?,updated_at=? WHERE id=?').run(next.title,JSON.stringify(next.content),next.version,next.starred?1:0,next.trashed?1:0,next.folder_id,next.updated_at,id);
    if(changed)snapshot(next);
    return next;
    });
  }
  function template(id){const row=db.prepare('SELECT * FROM templates WHERE id=?').get(id);return row?{...row,content:JSON.parse(row.content)}:null;}
  function createTemplate({kind,name,content}){return atomic(()=>{
    if(!kinds.includes(kind)||typeof name!=='string'||!name.trim()||name.length>120)throw new Error('Enter a template name between1 and120 characters and a valid app.');
    validateContent(kind,content);if(db.prepare('SELECT COUNT(*) AS count FROM templates').get().count>=500)throw new Error('This workspace supports up to500 saved templates.');
    const id=randomUUID(),now=new Date().toISOString();db.prepare('INSERT INTO templates VALUES(?,?,?,?,?,?)').run(id,name.trim(),kind,JSON.stringify(content),now,now);return template(id);
  });}
  if(seed&&!db.prepare('SELECT id FROM files LIMIT 1').get()) {
    const folderId=randomUUID();db.prepare('INSERT INTO folders VALUES(?,?,?)').run(folderId,'Getting started',new Date().toISOString());
    create({kind:'docs',title:'A little room for big ideas',starred:true,folderId,content:{html:'<p>COMMONPLACE / A FRESH START</p><h1>A little room for<br>big ideas.</h1><p>Every good thing starts somewhere. A half-formed thought. A question in the margin. A plan that needs a little space to grow.</p><h2>Make yourself at home</h2><p>This is your place to think, write, calculate, and present. Your documents, spreadsheets, and slides live together, ready whenever inspiration arrives.</p><ul><li><strong>Write it down.</strong> Shape an idea in Docs.</li><li><strong>Work it out.</strong> Find the story in your numbers with Sheets.</li><li><strong>Bring it to life.</strong> Give your next idea a stage in Slides.</li></ul><blockquote><p>Start small. Make something that matters.</p></blockquote><h2>Everything stays with you</h2><p>Your work saves automatically on this computer. Find earlier saves in Version history. Export a backup from the home screen to keep a portable copy.</p>',page:{size:'a4',margin:72}}});
    const cells={A1:{value:'THE STUDIO / MONTHLY BUDGET',format:{bold:true,color:'#23734b'}},A3:{value:'Category',format:{bold:true,bg:'#edf4ef'}},B3:{value:'Planned',format:{bold:true,bg:'#edf4ef'}},C3:{value:'Actual',format:{bold:true,bg:'#edf4ef'}},D3:{value:'Remaining',format:{bold:true,bg:'#edf4ef'}}};
    [['Workspace',1200,1200],['Tools & software',250,189],['Marketing',500,325],['Travel',300,175],['Coffee & good ideas',100,84]].forEach((r,i)=>{['A','B','C'].forEach((c,j)=>cells[c+(i+4)]={value:String(r[j]),format:j?{numberFormat:'currency'}:{}});cells['D'+(i+4)]={value:`=B${i+4}-C${i+4}`,format:{numberFormat:'currency'}};});
    cells.A10={value:'Total',format:{bold:true}};['B','C','D'].forEach(c=>cells[c+'10']={value:`=SUM(${c}4:${c}8)`,format:{bold:true,numberFormat:'currency',bg:'#edf4ef'}});
    create({kind:'sheets',title:'Studio budget',folderId,content:{sheets:[{id:'budget',name:'Monthly budget',cells,columnWidths:{0:250,1:140,2:140,3:140}}],activeSheetId:'budget'}});
    create({kind:'slides',title:'Made to make a difference',folderId,content:{theme:'paper',aspectRatio:'16:9',slides:[{id:'welcome',background:'#e9efe5',notes:'Welcome. Introduce the idea and the opportunity.',elements:[{id:'label',type:'text',x:80,y:65,width:600,height:40,text:'COMMONPLACE  /  YOUR NEXT BIG IDEA',style:{fontSize:17,color:'#41644a'}},{id:'title',type:'text',x:80,y:170,width:780,height:180,text:'Made to make\na difference.',style:{fontSize:66,color:'#233c2a',bold:true}},{id:'subtitle',type:'text',x:80,y:415,width:750,height:50,text:'A new idea. A shared purpose. A place to begin.',style:{fontSize:22,color:'#41644a'}}]},{id:'opportunity',background:'#ffffff',notes:'Describe the challenge your idea addresses.',elements:[{id:'heading',type:'text',x:80,y:70,width:800,height:100,text:'Every idea starts with a question.',style:{fontSize:44,color:'#233c2a',bold:true}},{id:'body',type:'text',x:80,y:225,width:750,height:170,text:'What could be better?\nWho could we help?\nWhat if we started today?',style:{fontSize:32,color:'#64746a'}}]}]}});
  }
  return {db,file,create,update,template,createTemplate,close:()=>db.close()};
}
