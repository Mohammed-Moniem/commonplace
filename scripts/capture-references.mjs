import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory='evidence/references';await mkdir(directory,{recursive:true});
const results=await Promise.allSettled(['docs','sheets','slides'].map(async kind=>{
  const url=`https://workspace.google.com/products/${kind}/`,response=await fetch(url,{signal:AbortSignal.timeout(15000)});const html=await response.text();const path=`${directory}/${kind}.html`;await writeFile(path,html);return {kind,url,finalUrl:response.url,status:response.status,capturedAt:new Date().toISOString(),path,sha256:createHash('sha256').update(html).digest('hex'),basis:'Public product HTML; not a live editor runtime capture.'};
}));await writeFile(`${directory}/manifest.json`,JSON.stringify(results.map(r=>r.status==='fulfilled'?r.value:{error:r.reason.message}),null,2));console.log(JSON.stringify(results.map(r=>r.status==='fulfilled'?{kind:r.value.kind,status:r.value.status}:{error:r.reason.message})));
