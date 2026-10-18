import {createCalculator,cellKey,parseCell} from './formulas.js';
import {formatCellValue,parseCellInput} from './cellValues.js';

const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&value.length<=max;
const chartLabel=(value,fallback)=>value===null||value===undefined||value===''?String(fallback):String(value);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function linkedRange(input){
  let range=input;
  if(typeof input==='string'){const parts=input.trim().split(':');if(parts.length>2)throw new Error('Choose a range such as A1:D10.');const a=parseCell(parts[0]),b=parseCell(parts[1]||parts[0]);if(!a||!b)throw new Error('Choose a range such as A1:D10.');range={row:a.row,col:a.col,endRow:b.row,endCol:b.col};}
  if(!record(range)||!['row','col','endRow','endCol'].every(key=>Number.isInteger(range[key])))throw new Error('The linked cell range is invalid.');
  const result={row:Math.min(range.row,range.endRow),col:Math.min(range.col,range.endCol),endRow:Math.max(range.row,range.endRow),endCol:Math.max(range.col,range.endCol)};
  if(result.row<0||result.col<0||result.endRow>=10000||result.endCol>=200||result.endRow-result.row>=100||result.endCol-result.col>=20)throw new Error('Link up to100 rows and20 columns at once.');
  return result;
}
export function validLinkedSource(source){try{if(!record(source)||!text(source.fileId,128)||!source.fileId||!text(source.sheetId,128)||!source.sheetId||!text(source.fileTitle,240)||!text(source.sheetName,200)||!Number.isInteger(source.version)||source.version<1||source.chartId!==undefined&&(!text(source.chartId,128)||!source.chartId))return false;linkedRange(source.range);return true;}catch{return false;}}
export function validateLinkedSnapshot(snapshot){
  if(!record(snapshot)||!['table','chart'].includes(snapshot.kind)||!validLinkedSource(snapshot.source)||!Array.isArray(snapshot.rows)||!snapshot.rows.length||snapshot.rows.length>100)throw new Error('Linked spreadsheet content is invalid.');
  const width=snapshot.rows[0]?.length;
  if(!width||width>20||snapshot.rows.some(row=>!Array.isArray(row)||row.length!==width||row.some(value=>!text(value,100000))))throw new Error('Linked spreadsheet cells are invalid.');
  if(snapshot.formats!==undefined&&(!Array.isArray(snapshot.formats)||snapshot.formats.length!==snapshot.rows.length||snapshot.formats.some(row=>!Array.isArray(row)||row.length!==width||row.some(value=>!record(value)))))throw new Error('Linked spreadsheet formatting is invalid.');
  if(snapshot.kind==='chart'){const c=snapshot.chart;if(!record(c)||!['bar','line','pie'].includes(c.type)||!text(c.title,500)||!Array.isArray(c.labels)||!c.labels.length||c.labels.length>100||!Array.isArray(c.values)||c.values.length!==c.labels.length||c.labels.some(value=>!text(value,10000))||c.values.some(value=>typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e15))throw new Error('Linked chart data is invalid.');if(snapshot.chartImage!==undefined&&(!text(snapshot.chartImage,4_000_000)||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(snapshot.chartImage)))throw new Error('Linked chart preview is invalid.');}
  if(JSON.stringify(snapshot).length>2_000_000)throw new Error('Choose a smaller range; linked content is limited to2 MB.');
  return snapshot;
}
export function buildLinkedSnapshot(file,{sheetId,range='A1:D10',chartId}={}){
  if(file?.kind!=='sheets'||file.trashed||!file.content?.sheets?.length)throw new Error('Choose an available local spreadsheet.');
  const sheet=file.content.sheets.find(item=>item.id===(sheetId||file.content.activeSheetId))||(!sheetId?file.content.sheets[0]:null);if(!sheet)throw new Error('The linked worksheet no longer exists.');
  const chart=chartId?sheet.charts?.find(item=>item.id===chartId):null;if(chartId&&!chart)throw new Error('The linked chart no longer exists.');
  const selected=linkedRange(chart?chart.range:range),calculate=createCalculator(file.content);
  const formats=[],rows=[];
  for(let r=selected.row;r<=selected.endRow;r++){const values=[],styles=[];for(let c=selected.col;c<=selected.endCol;c++){const key=cellKey(r,c),cell=sheet.cells[key]||{},format=parseCellInput(cell.value,cell.format).format||{};values.push(formatCellValue(calculate(sheet.id,key),format));styles.push(structuredClone(format));}rows.push(values);formats.push(styles);}
  const snapshot={kind:chart?'chart':'table',source:{fileId:file.id,sheetId:sheet.id,range:selected,...(chart?{chartId:chart.id}:{}),version:file.version,fileTitle:file.title,sheetName:sheet.name},rows,formats};
  if(chart){if(!['bar','line','pie'].includes(chart.type))throw new Error('Linked charts currently support column, line, and pie charts. Link this chart’s cell range as a table instead.');const labels=[],values=[];for(let r=selected.row;r<=selected.endRow;r++){const value=calculate(sheet.id,cellKey(r,selected.endCol));if(typeof value==='number'&&Number.isFinite(value)){labels.push(chartLabel(calculate(sheet.id,cellKey(r,selected.col)),r+1));values.push(value);}}if(!values.length)throw new Error('The chart needs at least one numeric value.');if(chart.type==='pie'&&(values.some(value=>value<0)||!values.some(value=>value>0)))throw new Error('Pie charts need nonnegative values with a positive total.');snapshot.chart={type:chart.type,title:chart.title||'Linked chart',labels,values};}
  return validateLinkedSnapshot(snapshot);
}
export function linkedChartSvg(chart){
  const {labels,values,type,title}=chart,w=600,h=340,palette=['#328563','#82b89a','#c7d9a8','#e0b47e','#937db5','#68a4b1'];let parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="600" height="340" fill="white"/><text x="24" y="28" font-family="Arial" font-size="18" fill="#243e30">${escape(title)}</text>`];
  if(type==='pie'){let angle=-Math.PI/2;const total=values.reduce((sum,value)=>sum+value,0);values.forEach((value,i)=>{if(value<=0)return;const sweep=value/total*Math.PI*2,start=angle;angle+=sweep;const x1=195+Math.cos(start)*120,y1=190+Math.sin(start)*120,x2=195+Math.cos(angle)*120,y2=190+Math.sin(angle)*120;parts.push(sweep>=Math.PI*2-0.00001?`<circle cx="195" cy="190" r="120" fill="${palette[i%6]}"/>`:`<path d="M195,190 L${x1},${y1} A120,120 0 ${sweep>Math.PI?1:0},1 ${x2},${y2} Z" fill="${palette[i%6]}"/>`);if(i<10)parts.push(`<rect x="355" y="${70+i*23}" width="12" height="12" fill="${palette[i%6]}"/><text x="375" y="${81+i*23}" font-family="Arial" font-size="12" fill="#35553e">${escape(labels[i].slice(0,24))}: ${value}</text>`);});}
  else{const max=Math.max(0,...values),min=Math.min(0,...values),span=max-min||1,y=value=>55+(max-value)/span*225,step=510/values.length;parts.push(`<line x1="65" x2="580" y1="${y(0)}" y2="${y(0)}" stroke="#a9b8ac"/>`);if(type==='line')parts.push(`<polyline fill="none" stroke="#328563" stroke-width="3" points="${values.map((value,i)=>`${70+i*510/Math.max(1,values.length-1)},${y(value)}`).join(' ')}"/>`);values.forEach((value,i)=>{if(type==='bar')parts.push(`<rect x="${65+i*step+2}" y="${Math.min(y(value),y(0))}" width="${Math.max(1,step-4)}" height="${Math.max(1,Math.abs(y(value)-y(0)))}" fill="${palette[i%6]}"/>`);if(i%Math.max(1,Math.ceil(values.length/8))===0)parts.push(`<text x="${65+i*step+step/2}" y="305" text-anchor="middle" font-family="Arial" font-size="11" fill="#526b56">${escape(labels[i].slice(0,10))}</text>`);});}
  return parts.join('')+'</svg>';
}
export async function withLinkedChartImage(snapshot){
  if(snapshot.kind!=='chart')return snapshot;
  const url=URL.createObjectURL(new Blob([linkedChartSvg(snapshot.chart)],{type:'image/svg+xml'}));
  try{const image=new Image();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Chart preview timed out.')),5000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('Unable to render this chart.'));};image.src=url;});const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=680;canvas.getContext('2d').drawImage(image,0,0,1200,680);return validateLinkedSnapshot({...snapshot,chartImage:canvas.toDataURL('image/png')});}finally{URL.revokeObjectURL(url);}
}
