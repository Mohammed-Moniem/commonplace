import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../server/index.js';
import { spawn } from 'node:child_process';

async function fixture(t,filename){const app=createApplication({filename:filename??':memory:',seed:false});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const address=`http://127.0.0.1:${app.server.address().port}`;t.after(()=>app.close());return {app,address,request:async(path,method='GET',body,headers={})=>{const response=await fetch(address+'/api'+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}};}
test('real HTTP create, save, conflict, named history and restoration preserve work',async t=>{
  const {request}=await fixture(t);const created=await request('/files','POST',{kind:'docs',title:'First draft'});assert.equal(created.status,201);const file=created.body;assert.equal(file.version,1);
  const saved=await request('/files/'+file.id,'PATCH',{version:1,title:'Final draft',content:{html:'<h1>Saved words</h1>'}});assert.equal(saved.status,200);assert.equal(saved.body.version,2);
  const conflict=await request('/files/'+file.id,'PATCH',{version:1,content:{html:'<p>Stale overwrite</p>'}});assert.equal(conflict.status,409);assert.match(conflict.body.current.content.html,/Saved words/);
  assert.equal((await request('/files/'+file.id+'/versions','POST',{name:'Approved copy'})).status,200);
  const history=(await request('/files/'+file.id+'/versions')).body;assert.equal(history.length,2);assert.equal(history[0].name,'Approved copy');
  const restored=await request('/files/'+file.id+'/versions','PATCH',{versionId:history[1].id,version:2});assert.equal(restored.body.version,3);assert.equal(restored.body.title,'First draft');assert.equal((await request('/files/'+file.id+'/versions')).body.length,3);
});
test('SQLite survives closing and reopening the actual HTTP server and database',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'commonplace-persistence-')),filename=join(directory,'saved.sqlite');let first,second;
  try{first=createApplication({filename,seed:false});await new Promise(r=>first.server.listen(0,'127.0.0.1',r));const response=await fetch(`http://127.0.0.1:${first.server.address().port}/api/files`,{method:'POST',body:JSON.stringify({kind:'sheets',title:'Persistent numbers',content:{sheets:[{id:'s1',name:'Main',cells:{A1:{value:'42'},A2:{value:'=A1*2'}}}],activeSheetId:'s1'}})});const file=await response.json();await first.close();first=null;second=createApplication({filename,seed:false});await new Promise(r=>second.server.listen(0,'127.0.0.1',r));const reloaded=await (await fetch(`http://127.0.0.1:${second.server.address().port}/api/files/${file.id}`)).json();assert.equal(reloaded.content.sheets[0].cells.A2.value,'=A1*2');assert.equal(reloaded.title,'Persistent numbers');assert.equal(reloaded.version,1);}finally{if(first)await first.close();if(second)await second.close();rmSync(directory,{recursive:true,force:true});}
});
test('folders, trash, starring and comments are real persistent relationships',async t=>{
  const {request}=await fixture(t);const folder=(await request('/folders','POST',{name:'Research'})).body;const file=(await request('/files','POST',{kind:'slides',title:'Story',folderId:folder.id})).body;
  await request('/files/'+file.id,'PATCH',{starred:true,trashed:true});let current=(await request('/files/'+file.id)).body;assert.equal(current.starred,true);assert.equal(current.trashed,true);
  const note=(await request('/files/'+file.id+'/comments','POST',{body:'Check the story arc'})).body;await request(`/files/${file.id}/comments/${note.id}`,'PATCH',{resolved:true});assert.equal((await request('/files/'+file.id+'/comments')).body[0].resolved,1);
  await request('/folders/'+folder.id,'DELETE');current=(await request('/files/'+file.id)).body;assert.equal(current.folder_id,null);assert.equal(current.content.slides.length,1);
  await request('/files/'+file.id,'PATCH',{trashed:false});assert.equal((await request('/files')).body[0].trashed,false);
});
test('backup restore appends distinct files and rolls back an invalid bundle atomically',async t=>{
  const {request}=await fixture(t);const folder=(await request('/folders','POST',{name:'Pack'})).body;const file=(await request('/files','POST',{kind:'docs',title:'Original',folderId:folder.id})).body;await request('/files/'+file.id+'/comments','POST',{body:'Keep this note'});
  const backup=(await request('/backup')).body;const restored=await request('/import-backup','POST',backup);assert.equal(restored.body.imported,1);const all=(await request('/files')).body;assert.equal(all.length,2);assert.notEqual(all[0].id,all[1].id);assert.notEqual(all[0].folder_id,all[1].folder_id);
  const copy=all.find(f=>f.id!==file.id);assert.equal((await request('/files/'+copy.id+'/comments')).body[0].body,'Keep this note');
  const bad=structuredClone(backup);bad.files.push({kind:'unknown',title:'Invalid'});assert.equal((await request('/import-backup','POST',bad)).status,400);assert.equal((await request('/files')).body.length,2);assert.equal((await request('/folders')).body.length,2);
});
test('validation and same-origin controls reject invalid writes without changing storage',async t=>{
  const {request,address}=await fixture(t);assert.equal((await request('/files','POST',{kind:'docs',title:''})).status,400);assert.equal((await request('/files','POST',{kind:'docs',title:'Bad content',content:{html:42}})).status,400);assert.equal((await request('/files','POST',{kind:'docs',title:'Cross origin'},{Origin:'https://external.example'})).status,403);assert.equal((await request('/files')).body.length,0);assert.equal((await request('/files','POST',{kind:'docs',title:'Allowed'},{Origin:address})).status,201);
});
test('named versions survive automatic pruning',async t=>{
  const {app}=await fixture(t);let file=app.store.create({kind:'docs',title:'History'});app.store.db.prepare('UPDATE versions SET name=? WHERE file_id=?').run('Keep forever',file.id);for(let i=0;i<105;i++)file=app.store.update(file.id,{version:file.version,content:{html:`<p>${i}</p>`}});const rows=app.store.db.prepare('SELECT * FROM versions WHERE file_id=?').all(file.id);assert.equal(rows.length,101);assert(rows.some(r=>r.name==='Keep forever'));assert(rows.some(r=>r.version===106));
});
test('a failed history snapshot rolls back both content changes and file creation',async t=>{
  const {app}=await fixture(t);const original=app.store.create({kind:'docs',title:'Keep me'});app.store.db.exec("CREATE TRIGGER fail_snapshot BEFORE INSERT ON versions BEGIN SELECT RAISE(ABORT,'simulated history failure'); END;");assert.throws(()=>app.store.update(original.id,{version:1,content:{html:'<p>Must roll back</p>'}}),/simulated history failure/);assert.equal(app.store.file(original.id).version,1);assert.equal(app.store.file(original.id).content.html,original.content.html);assert.throws(()=>app.store.create({kind:'docs',title:'Must not exist'}),/simulated history failure/);assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM files').get().n,1);
});
test('a maximum-length title can still be copied',async t=>{const {request}=await fixture(t);const original=(await request('/files','POST',{kind:'docs',title:'a'.repeat(240)})).body;const copy=await request(`/files/${original.id}/duplicate`,'POST',{});assert.equal(copy.status,201);assert.equal(copy.body.title.length,240);});
test('saved work survives an actual Node process restart',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'commonplace-process-')),filename=join(directory,'workspace.sqlite');let child;
  async function boot(){const process=spawn(globalThis.process.execPath,['server/index.js'],{cwd:new URL('..',import.meta.url),env:{...globalThis.process.env,PORT:'0',COMMONPLACE_DB:filename},stdio:['ignore','pipe','pipe']});child=process;return await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>{process.kill();reject(new Error('Server did not become ready.'));},10000);process.stdout.on('data',data=>{output+=data;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});process.on('error',reject);});}
  async function stop(){if(!child)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});child=null;}
  try{let origin=await boot();const file=await (await fetch(origin+'/api/files',{method:'POST',body:JSON.stringify({kind:'docs',title:'Across process restart',content:{html:'<p>Still here after restarting Node.</p>'}})})).json();await stop();origin=await boot();const result=await (await fetch(origin+'/api/files/'+file.id)).json();assert.equal(result.title,file.title);assert.equal(result.content.html,file.content.html);}finally{await stop();rmSync(directory,{recursive:true,force:true});}
});
