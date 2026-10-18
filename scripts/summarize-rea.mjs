import {readFileSync,writeFileSync} from 'node:fs';
import {artifact} from './source-manifest.mjs';
const filename=process.argv[2];if(!filename)throw new Error('Pass a saved REA JSON evidence path.');
const envelope=JSON.parse(readFileSync(filename,'utf8'));
const data=envelope.data??{};
const small={ok:envelope.ok,evidenceId:data.evidence_id,kind:data.kind,subject:data.subject,producer:data.producer,provider:data.provider,coverage:data.coverage,limitations:data.limitations,dataKeys:Object.keys(data),artifact:artifact(filename)};
writeFileSync(filename.replace(/\.json$/,'.summary.json'),JSON.stringify(small,null,2));
console.log(JSON.stringify(small));
