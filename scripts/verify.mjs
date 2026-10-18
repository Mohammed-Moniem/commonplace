import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {unzipSync} from 'fflate';
import {createHash}from'node:crypto';
import {sourceManifest}from'./source-manifest.mjs';
const results=[];
const verificationDigest=sourceManifest().sourceDigest;
function saveResults(){if(sourceManifest().sourceDigest!==verificationDigest)throw new Error('Source changed during verification; rerun against frozen source.');writeFileSync('evidence/check-results.json',JSON.stringify(results.map(result=>({...result,sourceDigest:verificationDigest})),null,2));}
mkdirSync('evidence',{recursive:true});
// Windows distributes npm as a .cmd shim, which requires cmd.exe. The
// arguments below are fixed literals; no user input is passed to the shell.
const npmCommand=process.platform==='win32'?'npm.cmd':'npm';
for(const [name,args] of [['test',['test']],['build',['run','build','--','--outDir','.bench-build']],['package',['run','package']]]){
  const result=spawnSync(npmCommand,args,{shell:process.platform==='win32',encoding:'utf8',env:{...process.env,COMMONPLACE_PACKAGE_DIST:'.bench-build'},maxBuffer:15_000_000});writeFileSync(`evidence/${name}-run.log`,(result.stdout??'')+(result.stderr??''));results.push({name,exitCode:result.status,result:result.status===0?'PASS':'FAIL'});if(result.status!==0){saveResults();console.error(`${name} failed; inspect evidence/${name}-run.log`);process.exit(1);}
  if(name==='build'){
    const files=readdirSync('.bench-build/assets').filter(p=>p.endsWith('.js')),failures=[];
    for(const file of files){const syntax=spawnSync(process.execPath,['--check','.bench-build/assets/'+file],{encoding:'utf8'});if(syntax.status!==0)failures.push({file,error:syntax.stderr});}
    writeFileSync('evidence/browser-syntax.json',JSON.stringify({files,failures},null,2));results.push({name:'browser-javascript-syntax',exitCode:failures.length?1:0,result:failures.length?'FAIL':'PASS'});
    if(failures.length){saveResults();console.error('Built browser JavaScript failed V8 syntax validation.');process.exit(1);}
  }
}
const folder=mkdtempSync(path.join(tmpdir(),'commonplace-package-')),archive=`commonplace-${JSON.parse(readFileSync('package.json','utf8')).version}.zip`,archiveBytes=readFileSync(archive),archiveHash=createHash('sha256').update(archiveBytes).digest('hex'),entries=unzipSync(new Uint8Array(archiveBytes));let child;
try{
  if(Object.keys(entries).some(p=>/node_modules|\.sqlite|\/data\//.test(p)))throw new Error('Package contains application data or installed dependencies.');
  for(const [name,bytes] of Object.entries(entries)){const target=path.resolve(folder,name);if(!target.startsWith(folder+path.sep))throw new Error('Package path escapes extraction directory.');mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,bytes);}
  const packagedRoot=path.join(folder,'commonplace');
  const boot=async()=>{const packageEnv={...process.env,PORT:'0'};delete packageEnv.COMMONPLACE_DIST;delete packageEnv.COMMONPLACE_DB;child=spawn(process.execPath,['server/index.js'],{cwd:packagedRoot,env:packageEnv,stdio:['ignore','pipe','pipe']});return await new Promise((resolve,reject)=>{let text='';const timeout=setTimeout(()=>{child.kill();reject(new Error('Packaged app startup timed out'));},10000);child.stdout.on('data',data=>{text+=data;const match=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});child.on('error',reject);});};
  const stop=async()=>{const current=child;if(current){await new Promise(resolve=>{current.once('exit',resolve);current.kill('SIGTERM');});child=null;}};
  let origin=await boot();const health=await(await fetch(origin+'/api/health')).json();if(!health.ok||health.storage!=='sqlite')throw new Error('Packaged health check failed.');
  const html=await(await fetch(origin+'/')).text();for(const name of [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(m=>m[1]))if(!(await fetch(origin+name)).ok)throw new Error('Missing packaged asset '+name);
  const file=await(await fetch(origin+'/api/files',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({kind:'docs',title:'Packaged restart proof',content:{html:'<p>Saved inside the extracted package.</p>'}})})).json();if(!file.id)throw new Error('Packaged browser-origin file create failed.');
  await stop();origin=await boot();const reopened=await(await fetch(origin+'/api/files/'+file.id)).json();if(reopened.content?.html!==file.content.html)throw new Error('Package restart lost content.');
  const launch={checkedAt:new Date().toISOString(),sourceDigest:verificationDigest,archive:{path:archive,sha256:archiveHash},mode:'Extracted distribution launched with Node, no node_modules',health,packageEntries:Object.keys(entries).length,staticAssets:'PASS',create:'PASS',processRestart:'PASS'};writeFileSync('evidence/launch-check.json',JSON.stringify(launch,null,2));writeFileSync('evidence/package-runtime.json',JSON.stringify(launch,null,2));await stop();results.push({name:'package-runtime',exitCode:0,result:'PASS'});
}catch(error){results.push({name:'package-runtime',exitCode:1,result:'FAIL',error:error.message});throw error;}
finally{if(child){await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});}rmSync(folder,{recursive:true,force:true});saveResults();}
console.log(JSON.stringify(results));
