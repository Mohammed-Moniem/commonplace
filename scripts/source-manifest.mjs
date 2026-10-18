import {readFileSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const artifact=filename=>({path:filename,sha256:sha256(readFileSync(filename))});
export function sourceManifest(root=process.cwd()){
  const names=[];
  const walk=dir=>{for(const name of readdirSync(path.join(root,dir))){const relative=path.posix.join(dir,name);if(statSync(path.join(root,relative)).isDirectory())walk(relative);else names.push(relative);}};
  for(const dir of ['src','server','public','scripts','tests'])walk(dir);
  names.push('package.json','package-lock.json','vite.config.js','index.html');names.sort();
  const sources=names.map(name=>({path:name,sha256:sha256(readFileSync(path.join(root,name)))}));
  return {sourceDigest:sha256(JSON.stringify(sources)),sources};
}
