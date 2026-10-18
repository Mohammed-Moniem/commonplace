import {readFileSync,readdirSync,statSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {zipSync} from 'fflate';
const root=process.cwd(),entries={};
function add(relative,destination=relative){const absolute=path.join(root,relative);if(statSync(absolute).isDirectory()){for(const item of readdirSync(absolute))add(path.posix.join(relative,item),path.posix.join(destination,item));}else entries['commonplace/'+destination]=new Uint8Array(readFileSync(absolute));}
for(const relative of ['src','server','public','scripts','tests','package.json','package-lock.json','vite.config.js','index.html','README.md','.gitignore','.gitattributes'])add(relative);
add(process.env.COMMONPLACE_PACKAGE_DIST??'dist','dist');
// Deliberate allowlist: local captures, browser profiles, receipts and generated
// reports can contain machine paths. Distributions include reproducible inputs.
for(const relative of ['BENCHMARK.md','docs','evidence/benchmark-v2/docs-cases.json','evidence/benchmark-v2/sheets-cases.json','evidence/benchmark-v2/slides-cases.json','evidence/benchmark-v2/baseline/commonplace-0.1.0.zip'])if(existsSync(relative))add(relative);
const name=`commonplace-${JSON.parse(readFileSync('package.json','utf8')).version}.zip`;writeFileSync(name,zipSync(entries,{level:6}));console.log(`Packaged ${Object.keys(entries).length} files into ${name}. SQLite data and dependencies are excluded.`);
