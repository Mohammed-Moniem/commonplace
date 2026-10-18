import http from 'node:http';
import { readFileSync,existsSync,statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openStore,validateContent } from './store.js';
import {remapLinkedSources} from './linkedSources.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const appVersion=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
export function createApplication({filename=process.env.COMMONPLACE_DB??path.join(root,'data/commonplace.sqlite'),publicRoot=path.resolve(process.env.COMMONPLACE_DIST??path.join(root,'dist')),seed=true}={}) {
  const store=openStore(filename,{seed}),{db}=store,clients=new Set();
  function emit(payload){for(const client of clients)client.write(`data: ${JSON.stringify(payload)}\n\n`);}
  const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  async function body(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>18_000_000){const e=new Error('Upload exceeds the 18 MB request limit.');e.status=413;throw e;}chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new Error('The request must contain valid JSON.');}}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    const url=new URL(req.url,'http://localhost'),segments=url.pathname.split('/').filter(Boolean),method=req.method;
    try {
      // Loopback only, with same-origin browser writes. No credentials or cloud service.
      if(req.headers.host&&!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host))return send(res,403,{error:'This workspace is available on localhost only.'});
      if(!['GET','HEAD','OPTIONS'].includes(method)&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(res,403,{error:'Cross-origin writes are not allowed.'});
      if(url.pathname==='/api/health')return send(res,200,{ok:true,storage:'sqlite',mode:'local',version:appVersion});
      if(url.pathname==='/api/events'&&method==='GET'){
        // Retire event streams from older tabs; browser BroadcastChannel carries local updates.
        res.writeHead(204);res.end();return;
      }
      if(url.pathname==='/api/templates'){
        if(method==='GET')return send(res,200,db.prepare('SELECT id,name,kind,created_at,updated_at FROM templates ORDER BY updated_at DESC').all());
        if(method==='POST'){const saved=store.createTemplate(await body(req));emit({type:'library'});return send(res,201,saved);}
      }
      if(segments[0]==='api'&&segments[1]==='templates'&&segments[2]&&method==='GET'){const saved=store.template(segments[2]);return saved?send(res,200,saved):send(res,404,{error:'This template could not be found.'});}
      if(url.pathname==='/api/folders'){
        if(method==='GET')return send(res,200,db.prepare('SELECT * FROM folders ORDER BY name COLLATE NOCASE').all());
        if(method==='POST'){const input=await body(req);if(typeof input.name!=='string'||!input.name.trim()||input.name.length>120)throw new Error('Enter a folder name (1–120 characters).');const folder={id:randomUUID(),name:input.name.trim(),created_at:new Date().toISOString()};db.prepare('INSERT INTO folders VALUES(?,?,?)').run(folder.id,folder.name,folder.created_at);emit({type:'library'});return send(res,201,folder);}
      }
      if(segments[0]==='api'&&segments[1]==='folders'&&segments[2]&&method==='DELETE'){db.prepare('DELETE FROM folders WHERE id=?').run(segments[2]);emit({type:'library'});return send(res,200,{ok:true});}
      if(url.pathname==='/api/backup'&&method==='GET')return send(res,200,{format:'commonplace-v1',exportedAt:new Date().toISOString(),templates:db.prepare('SELECT * FROM templates').all().map(row=>({...row,content:JSON.parse(row.content)})),folders:db.prepare('SELECT * FROM folders').all(),files:db.prepare('SELECT id FROM files').all().map(r=>store.file(r.id)),comments:db.prepare('SELECT * FROM comments').all(),versions:db.prepare('SELECT * FROM versions').all().map(v=>({...v,content:JSON.parse(v.content)}))});
      if(url.pathname==='/api/import-backup'&&method==='POST'){
        const input=await body(req);if(input.format!=='commonplace-v1'||!Array.isArray(input.files)||input.files.length>1000)throw new Error('Choose a valid Commonplace backup.');
        const folderMap=Object.create(null),fileMap=Object.create(null);db.exec('BEGIN');try{
          for(const folder of input.folders??[]){if(typeof folder.name!=='string'||folder.name.length>120)throw new Error('Invalid folder.');const id=randomUUID();folderMap[folder.id]=id;db.prepare('INSERT INTO folders VALUES(?,?,?)').run(id,folder.name,new Date().toISOString());}
          for(const original of input.files){const row=store.create({kind:original.kind,title:original.title,content:original.content,folderId:folderMap[original.folder_id]??null,starred:original.starred});fileMap[original.id]=row.id;if(original.trashed)store.update(row.id,{trashed:true});}
          for(const [originalId,newId]of Object.entries(fileMap)){const row=store.file(newId);const content=remapLinkedSources(row.kind,row.content,fileMap);validateContent(row.kind,content);db.prepare('UPDATE files SET content=? WHERE id=?').run(JSON.stringify(content),newId);db.prepare('UPDATE versions SET content=? WHERE file_id=?').run(JSON.stringify(content),newId);}
          if(input.templates!==undefined&&(!Array.isArray(input.templates)||input.templates.length>500))throw new Error('Backup template collection is invalid.');
          for(const original of input.templates||[])store.createTemplate({kind:original.kind,name:original.name,content:remapLinkedSources(original.kind,original.content,fileMap)});
          const historical=new Set();
          for(const version of input.versions??[]){const newId=fileMap[version.file_id];if(!newId)continue;const row=store.file(newId);const historicalContent=remapLinkedSources(row.kind,version.content,fileMap);validateContent(row.kind,historicalContent);if(!Number.isInteger(version.version)||version.version<1||typeof version.title!=='string'||version.title.length>240)throw new Error('Invalid version history in backup.');if(!historical.has(newId)){db.prepare('DELETE FROM versions WHERE file_id=?').run(newId);historical.add(newId);}db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?,?)').run(randomUUID(),newId,version.version,version.title,JSON.stringify(historicalContent),typeof version.name==='string'?version.name.slice(0,120):null,version.created_at||new Date().toISOString());}
          for(const newId of historical){const latest=db.prepare('SELECT MAX(version) AS v FROM versions WHERE file_id=?').get(newId);db.prepare('UPDATE files SET version=? WHERE id=?').run(latest.v,newId);}
          for(const c of input.comments??[]){if(fileMap[c.file_id]&&typeof c.body==='string'&&c.body.length<=10000)db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?)').run(randomUUID(),fileMap[c.file_id],c.body,'You',c.resolved?1:0,c.created_at||new Date().toISOString());}
          db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        emit({type:'library'});return send(res,201,{imported:input.files.length});
      }
      if(url.pathname==='/api/files'){
        if(method==='GET')return send(res,200,db.prepare('SELECT * FROM files ORDER BY updated_at DESC').all().map(r=>{const content=JSON.parse(r.content);const slide=content.slides?.[0];const preview=r.kind==='docs'?content.html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,400):r.kind==='sheets'?Object.entries(content.sheets?.[0]?.cells??{}).slice(0,30).map(([cell,c])=>({cell,value:c.value.slice(0,160)})):slide?{background:slide.background,elements:slide.elements.filter(e=>e.type==='text'&&e.style?.fontSize>30).slice(0,1).map(e=>({type:'text',text:e.text.slice(0,200),style:{fontSize:e.style.fontSize}}))}:null;const {content:unused,...meta}=r;return {...meta,starred:!!r.starred,trashed:!!r.trashed,preview};}));
        if(method==='POST'){const row=store.create(await body(req));emit({type:'library',id:row.id});return send(res,201,row);}
      }
      if(segments[0]==='api'&&segments[1]==='files'&&segments[2]){
        const id=segments[2],row=store.file(id);if(!row)return send(res,404,{error:'This file could not be found.'});
        if(segments.length===3){
          if(method==='GET')return send(res,200,row);
          if(method==='PATCH'){const next=store.update(id,await body(req));emit({type:'file',id,version:next.version});return send(res,200,next);}
        }
        if(segments[3]==='duplicate'&&method==='POST'){const input=await body(req);const copy=store.create({kind:row.kind,title:input.title??`${row.title.slice(0,233)} (copy)`,content:row.content,folderId:row.folder_id});emit({type:'library'});return send(res,201,copy);}
        if(segments[3]==='versions'){
          if(method==='GET')return send(res,200,db.prepare('SELECT id,version,title,name,created_at FROM versions WHERE file_id=? ORDER BY version DESC').all(id));
          if(method==='POST'){const input=await body(req);if(typeof input.name!=='string'||!input.name.trim()||input.name.length>120)throw new Error('Enter a version name.');db.prepare('UPDATE versions SET name=? WHERE file_id=? AND version=?').run(input.name.trim(),id,row.version);return send(res,200,{ok:true});}
          if(method==='PATCH'){const input=await body(req);const saved=db.prepare('SELECT * FROM versions WHERE id=? AND file_id=?').get(input.versionId,id);if(!saved)return send(res,404,{error:'Version not found.'});const next=store.update(id,{content:JSON.parse(saved.content),title:saved.title,version:input.version});emit({type:'file',id,version:next.version});return send(res,200,next);}
        }
        if(segments[3]==='comments'){
          if(method==='GET')return send(res,200,db.prepare('SELECT * FROM comments WHERE file_id=? ORDER BY created_at').all(id));
          if(method==='POST'){const input=await body(req);if(typeof input.body!=='string'||!input.body.trim()||input.body.length>10000)throw new Error('Write a note between 1 and 10,000 characters.');const note={id:randomUUID(),file_id:id,body:input.body.trim(),author:'You',resolved:0,created_at:new Date().toISOString()};db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?)').run(note.id,id,note.body,note.author,0,note.created_at);emit({type:'comments',id});return send(res,201,note);}
          if(segments[4]&&method==='PATCH'){const input=await body(req);db.prepare('UPDATE comments SET resolved=? WHERE id=? AND file_id=?').run(input.resolved?1:0,segments[4],id);emit({type:'comments',id});return send(res,200,{ok:true});}
          if(segments[4]&&method==='DELETE'){db.prepare('DELETE FROM comments WHERE id=? AND file_id=?').run(segments[4],id);emit({type:'comments',id});return send(res,200,{ok:true});}
        }
      }
      if(url.pathname.startsWith('/api/'))return send(res,404,{error:'Endpoint not found.'});
      let relative=decodeURIComponent(url.pathname);let target=path.resolve(publicRoot,'.'+relative);
      if(!target.startsWith(publicRoot+path.sep))target=path.join(publicRoot,'index.html');
      if(!existsSync(target)||statSync(target).isDirectory())target=path.join(publicRoot,'index.html');
      if(!existsSync(target)){res.writeHead(503,{'Content-Type':'text/plain'});return res.end('Run npm run build first, or use npm run dev.');}
      const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
      res.writeHead(200,{'Content-Type':mime[path.extname(target)]??'application/octet-stream','Cache-Control':path.extname(target)==='.html'?'no-cache':'public, max-age=3600'});res.end(readFileSync(target));
    }catch(error){send(res,error.status??400,{error:error.message,...(error.current?{current:error.current}:{})});}
  });
  return {server,store,close:async()=>{for(const client of clients)client.end();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));store.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createApplication();const port=Number(process.env.PORT??4174);app.server.listen(port,'127.0.0.1',()=>console.log(`Commonplace is ready at http://127.0.0.1:${app.server.address().port}`));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await app.close();process.exit(0);});
}
