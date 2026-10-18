import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApplication} from '../server/index.js';
import {validateContent,blankContent} from '../server/store.js';

const range={row:0,col:0,endRow:1,endCol:1};
const fixtures={
  docs:{html:'<p>Main text</p>',page:{mode:'pageless'},activeTabId:'notes',tabs:[{id:'main',name:'Main',html:'<p>Main text</p>',page:{mode:'pages'}},{id:'notes',name:'Notes',html:'<p><span data-suggestion-id="s1" data-suggestion-kind="insert">Proposal</span></p>',page:{mode:'pageless'}}]},
  sheets:{activeSheetId:'data',namedRanges:[{name:'Sales',sheetId:'data',range}],sheets:[{id:'data',name:'Data',cells:{A1:{value:'North',format:{fontSize:14,wrap:true,borders:{bottom:{color:'#123456',width:2,style:'dashed'}}}},B1:{value:'42'}},merges:[range],rowHeights:{0:38},frozenCols:1,hiddenRows:[5],hiddenCols:[4],protectedRanges:[{id:'p1',range}],charts:[{id:'c1',type:'pie',range,title:'Revenue',options:{showLabels:true,color:'#225533'}}],pivot:{sourceSheetId:'data',range,groupCol:0,groupCols:[0,1],columnCol:2,valueCol:3,aggregate:'SUM'}}]},
  slides:{aspectRatio:'4:3',master:{background:'#ffffff',fontFamily:'Georgia',titleSize:48,bodySize:24,color:'#123456',accent:'#445566'},slides:[{id:'s1',background:'#ffffff',transition:'slide',notes:'Presenter notes',elements:[{id:'t1',type:'table',x:10,y:20,width:400,height:200,rows:[['Team','Revenue'],['North','42']],tableStyle:{header:true,headerFill:'#ddeedd',fontSize:22},rotation:15,groupId:'g1',animation:{effect:'fly',step:1},style:{opacity:0.8,borderWidth:2,borderColor:'#225533',shadow:true}},{id:'c1',type:'chart',x:430,y:20,width:400,height:250,chartType:'pie',chartData:{labels:['North','South'],values:[42,28]}},{id:'audio1',type:'audio',x:10,y:400,width:120,height:50,src:'data:audio/wav;base64,UklGRg==',name:'Synthetic test fixture',mime:'audio/wav',playback:{autoplay:false,loop:false,muted:true}}]}]}
};

test('[V2-01] advanced content survives same-origin API save, history restore, backup import and SQLite database reopen',async()=>{
  const folder=mkdtempSync(path.join(tmpdir(),'commonplace-v2-'));const filename=path.join(folder,'suite.sqlite');let app;
  const boot=async()=>{app=createApplication({filename,seed:false});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${app.server.address().port}`;};
  const request=async(origin,url,method='GET',body)=>{const response=await fetch(origin+url,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
  try{
    let origin=await boot();const ids={};
    for(const [kind,content]of Object.entries(fixtures)){
      const created=await request(origin,'/api/files','POST',{kind,title:`V2 ${kind}`,content});ids[kind]=created.id;
      assert.deepEqual(created.content,content);
      const modified=await request(origin,`/api/files/${created.id}`,'PATCH',{version:created.version,title:`Renamed ${kind}`,content});assert.equal(modified.version,2);
      const versions=await request(origin,`/api/files/${created.id}/versions`);assert.equal(versions.length,2);
      const restored=await request(origin,`/api/files/${created.id}/versions`,'PATCH',{versionId:versions[1].id,version:modified.version});assert.deepEqual(restored.content,content);
    }
    const backup=await request(origin,'/api/backup');assert.equal(backup.files.length,3);
    assert.equal((await request(origin,'/api/import-backup','POST',backup)).imported,3);
    await app.close();app=null;origin=await boot();
    for(const [kind,id]of Object.entries(ids))assert.deepEqual((await request(origin,`/api/files/${id}`)).content,fixtures[kind]);
    const reopened=await request(origin,'/api/backup');assert.equal(reopened.files.length,6);assert.equal(reopened.versions.length,18);
  }finally{if(app)await app.close();rmSync(folder,{recursive:true,force:true});}
});

test('[V2-02] invalid advanced coordinates, tab references, media and chart data are rejected before save',()=>{
  const badDocs=[{...fixtures.docs,activeTabId:'missing'},{...fixtures.docs,tabs:[]},{...fixtures.docs,tabs:[fixtures.docs.tabs[0],fixtures.docs.tabs[0]]},{...fixtures.docs,page:{mode:'invalid'}}];
  for(const content of badDocs)assert.throws(()=>validateContent('docs',content));
  for(const patch of [{merges:[range,range]},{rowHeights:{0:-1}},{hiddenCols:[200]},{protectedRanges:[{id:'x',range:null}]},{charts:[{id:'c',type:'pie',title:'bad',range,options:{showLabels:'yes'}}]},{pivot:{...fixtures.sheets.sheets[0].pivot,groupCols:[0,0]}}])assert.throws(()=>validateContent('sheets',{...fixtures.sheets,sheets:[{...fixtures.sheets.sheets[0],...patch}]}));
  const base={id:'x',x:0,y:0,width:300,height:100};
  for(const element of [{...base,type:'table',rows:[[{bad:true}]]},{...base,type:'chart',chartType:'pie',chartData:{labels:['A'],values:[Infinity]}},{...base,type:'audio',src:'https://example.com/song.mp3'},{...base,type:'text',text:'x',animation:{effect:'fly',step:-1}},{...base,type:'text',text:{}}])assert.throws(()=>validateContent('slides',{slides:[{id:'s',elements:[element]}]}));
  for(const kind of ['docs','sheets','slides'])assert.doesNotThrow(()=>validateContent(kind,blankContent(kind)));
});

test('[V2-03] reversed spreadsheet ranges and mismatched media MIME types never reach persistent storage',()=>{
  const reversed={row:4,col:2,endRow:1,endCol:0};
  for(const patch of [{protectedRanges:[{id:'p',range:reversed}]},{charts:[{id:'c',range:reversed,title:'bad',type:'pie'}]},{pivot:{sourceSheetId:'sheet-1',range:reversed,groupCol:0,valueCol:1,aggregate:'SUM'}}]){const content=blankContent('sheets');Object.assign(content.sheets[0],patch);assert.throws(()=>validateContent('sheets',content));}
  const content=blankContent('sheets');content.namedRanges=[{name:'BadRange',sheetId:'sheet-1',range:reversed}];assert.throws(()=>validateContent('sheets',content));
  for(const [type,src]of [['audio','data:video/mp4;base64,AAAA'],['video','data:audio/wav;base64,UklGRg==']])assert.throws(()=>validateContent('slides',{slides:[{id:'s',elements:[{id:'media',type,src,x:0,y:0,width:100,height:100}]}]}));
});
