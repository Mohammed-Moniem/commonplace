import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {artifact,sourceManifest} from './source-manifest.mjs';
import {unzipSync} from 'fflate';

const directory='evidence/benchmark-v2';mkdirSync(directory,{recursive:true});
const manifest=sourceManifest();
writeFileSync(`${directory}/results.json`,JSON.stringify({valid:false,status:'RUNNING',sourceDigest:manifest.sourceDigest,startedAt:new Date().toISOString()},null,2));
process.on('uncaughtException',error=>{writeFileSync(`${directory}/results.json`,JSON.stringify({valid:false,status:'ERROR',sourceDigest:manifest.sourceDigest,error:error.message,at:new Date().toISOString()},null,2));console.error(error.message);process.exitCode=1;});
const tests=readdirSync('tests').filter(name=>name.endsWith('.test.js')).sort().map(name=>'tests/'+name);
const run=(label,files,env={})=>{
  const startedAt=new Date().toISOString();
  const result=spawnSync(process.execPath,['--test','--test-reporter='+pathToFileURL(path.resolve('scripts/benchmark-reporter.mjs')).href,...files],{env:{...process.env,...env},encoding:'utf8',maxBuffer:20_000_000});
  const stdout=`${directory}/${label}-events.jsonl`,stderr=`${directory}/${label}-stderr.txt`;
  writeFileSync(stdout,result.stdout??'');writeFileSync(stderr,result.stderr??'');
  const events=(result.stdout??'').split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const leaves=events.filter(event=>['test:pass','test:fail'].includes(event.type)&&event.name?.match(/^\[(D2|S2|L2|H2|V2)-\d+\]/));
  const cases=leaves.map(event=>({id:event.name.match(/^\[([^\]]+)\]/)[1],testName:event.name,status:event.skip?'SKIP':event.todo?'TODO':event.type==='test:pass'?'PASS':'FAIL',...(event.error?{error:event.error}:{})}));
  const summary=events.filter(event=>event.type==='test:summary').at(-1)?.counts;
  return {label,startedAt,finishedAt:new Date().toISOString(),exitCode:result.status,counts:{...(summary??{tests:0,passed:0,failed:0,cancelled:0,skipped:0,todo:0}),scopedCases:cases.length},cases,evidence:[artifact(stdout),artifact(stderr)]};
};
// Always import the immutable archive bytes, never a possibly edited checkout.
mkdirSync('.bench-data',{recursive:true});const extracted=mkdtempSync(path.resolve('.bench-data/reference-'));
const baselineRoot=path.join(extracted,'commonplace');let baseline,baselineSlides,baselineDocs;
try{
  for(const [name,bytes]of Object.entries(unzipSync(new Uint8Array(readFileSync(`${directory}/baseline/commonplace-0.1.0.zip`))))){const target=path.resolve(extracted,name);if(!target.startsWith(extracted+path.sep))throw new Error('Invalid baseline archive path.');mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,bytes);}
  baseline=run('baseline-sheets',['tests/sheets-v2.test.js'],{SHEETS_BENCHMARK_ROOT:baselineRoot});
  baselineSlides=run('baseline-slides-comparable',['tests/slidesComparable.test.js'],{SLIDES_BENCHMARK_ROOT:baselineRoot});
  baselineDocs=run('baseline-docs-comparable',['tests/docs-v2-comparable.test.js'],{DOCS_BENCHMARK_ROOT:baselineRoot});
}finally{rmSync(extracted,{recursive:true,force:true});}
const current=run('current',tests,{SHEETS_BENCHMARK_ROOT:process.cwd(),SLIDES_BENCHMARK_ROOT:process.cwd(),DOCS_BENCHMARK_ROOT:process.cwd()});
const finalManifest=sourceManifest();
const validationErrors=[];
if(finalManifest.sourceDigest!==manifest.sourceDigest)validationErrors.push('Source changed while benchmark ran. Re-run against frozen source.');
if(baseline.cases.length!==19||baselineSlides.cases.length!==6||baselineDocs.cases.length!==5||!current.cases.length)validationErrors.push('Benchmark did not execute its complete declared baseline case set.');
for(const run of [baseline,baselineSlides,baselineDocs,current])if(!run.counts.tests||run.counts.cancelled||run.counts.skipped||run.counts.todo||run.cases.some(row=>['SKIP','TODO'].includes(row.status)))validationErrors.push(`${run.label} did not execute all tests without skips, TODOs or cancellations.`);
if(current.exitCode!==0||current.counts.failed||current.counts.passed!==current.counts.tests)validationErrors.push('The current suite did not fully pass.');
const ids=current.cases.map(c=>c.id);if(new Set(ids).size!==ids.length)validationErrors.push('Benchmark case identifiers are not unique.');
const comparisons=[...baseline.cases,...baselineSlides.cases,...baselineDocs.cases].map(before=>({id:before.id,baseline:before.status,current:current.cases.find(after=>after.id===before.id)?.status??'NOT_RUN',basis:'Same test and expected values, importing immutable 0.1.0 source versus current source. Missing capabilities are actual failed prerequisites, not simulated editor actions.'}));
const contracts=['sheets-cases.json','docs-cases.json','slides-cases.json'].filter(name=>existsSync(`${directory}/${name}`)).map(name=>artifact(`${directory}/${name}`));
const requiredIds=[...contracts.flatMap(contract=>JSON.parse(readFileSync(contract.path,'utf8')).cases.map(row=>row.id)),...['H2-01','H2-02','H2-03','H2-04','H2-05','V2-01','V2-02','V2-03']].sort();
if(JSON.stringify([...ids].sort())!==JSON.stringify(requiredIds))validationErrors.push('Current tagged cases do not exactly match the declared contracts.');
if(comparisons.length!==30||comparisons.some(row=>row.baseline!=='FAIL'||row.current!=='PASS'))validationErrors.push('The declared30 missing-capability comparisons did not all execute as baseline FAIL to current PASS.');
for(const run of [baseline,baselineSlides,baselineDocs])if(run.exitCode!==1||run.counts.failed!==run.cases.length||run.counts.tests!==run.cases.length)validationErrors.push(`${run.label} contains an unexpected startup/exit/summary result.`);
const report={schemaVersion:1,valid:validationErrors.length===0,status:validationErrors.length?'FAILED':'PASS',validationErrors,scope:'Commonplace local feature regression and 0.1 baseline comparison. This is not a full Google Workspace parity score.',node:process.version,sourceDigest:manifest.sourceDigest,sources:manifest.sources,baselineArchive:artifact(`${directory}/baseline/commonplace-0.1.0.zip`),baseline,baselineSlides,baselineDocs,current,comparisons,contracts,limits:['Original Google editor runtime remains unobserved behind account verification. Official public documentation provides selected expected behavior.','Selected Sheets, Slides and Docs cases use identical executable fixtures. Other baseline UI prerequisites and later browser journeys are separately retained.','Passing this finite case set does not imply complete function coverage, Office compatibility, accessibility or Google parity.']};
writeFileSync(`${directory}/results.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({sourceDigest:report.sourceDigest,current:current.counts,baseline:baseline.counts,compared:comparisons.length}));
if(!report.valid){console.error(validationErrors.join('\n'));process.exitCode=1;}
