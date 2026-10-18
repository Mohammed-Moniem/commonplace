import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMULA_CATALOG,getFormulaHelp,getFormulaSuggestions,suggestFunctions,functionContext} from '../src/lib/formulaCatalog.js';
import {evaluateFormula} from '../src/lib/formulas.js';

const workbook={sheets:[{id:'s',name:'Sheet 1',cells:{A1:{value:'1'},A2:{value:'2'},A3:{value:'3'},B1:{value:'10'},B2:{value:'20'},B3:{value:'30'},C1:{value:'3'},C2:{value:'30'}}}]};
const calculate=formula=>evaluateFormula(formula,workbook,'s');

test('[C3-21] formula chooser catalogs only functions whose documented examples execute in the actual interpreter',()=>{
  assert.deepEqual(FORMULA_CATALOG.map(e=>e.name),[...new Set(FORMULA_CATALOG.map(e=>e.name))].sort());
  for(const entry of FORMULA_CATALOG) {
    assert.ok(entry.signature.startsWith(entry.name+'('));assert.ok(entry.category && entry.description && entry.example);
    const value=calculate(entry.example);
    assert.ok(!(typeof value==='string' && /^#(?:NAME\?|ERROR!|VALUE!|REF!|NUM!|DIV\/0!|N\/A)/.test(value)),entry.name+' example failed: '+value);
  }
  assert.equal(getFormulaHelp('GOOGLEFINANCE'),null);assert.equal(getFormulaHelp('filter'),null);
});

test('[C3-22] function prefixes produce bounded case-insensitive completion with exact replacement spans',()=>{
  const items=getFormulaSuggestions('=su');assert.deepEqual(items.map(e=>e.name),['SUBSTITUTE','SUM','SUMIF','SUMIFS']);
  const sum=items.find(e=>e.name==='SUM');assert.equal(sum.start,1);assert.equal(sum.end,3);assert.equal(sum.insertText,'SUM(');
  assert.equal(suggestFunctions('',3).length,3);assert.equal(getFormulaSuggestions('',{limit:100}).length,50);assert.equal(getFormulaSuggestions('',{limit:0}).length,0);
  assert.equal(getFormulaHelp(' =sum(A1:A3)').name,'SUM');
});

test('[C3-23] completion works after operators and at an interior cursor without duplicating an existing parenthesis',()=>{
  const formula='=SUM(A1)+average(B1)';const item=getFormulaSuggestions(formula,{cursor:11}).find(e=>e.name==='AVERAGE');
  assert.ok(item);assert.equal(item.start,9);assert.equal(item.end,16);assert.equal(item.insertText,'AVERAGE');assert.equal(formula.slice(0,item.start)+item.insertText+formula.slice(item.end),'=SUM(A1)+AVERAGE(B1)');
  assert.deepEqual(getFormulaSuggestions('=SUM(A1)+AV').map(e=>e.name),['AVERAGE','AVERAGEIF','AVERAGEIFS']);
  assert.equal(getFormulaSuggestions('xlook')[0].name,'XLOOKUP');
});

test('[C3-24] completion never rewrites quoted strings, sheet names, cell references or range endpoints',()=>{
  for(const text of ['="SU','=CONCAT("escaped "" SU',"='SU","='Sheet 1'!SU",'=Sheet!SU','=SUM(A1:SU','=A1','=SUM!A1','=SUM(A1)+$B$2'])assert.deepEqual(getFormulaSuggestions(text),[],text);
  assert.equal(getFormulaSuggestions('=CONCAT("SU",AV')[0].name,'AVERAGE');
  assert.deepEqual(getFormulaSuggestions('ordinary text'),[]);
});

test('[C3-25] formula help tracks nested active arguments while ignoring quoted commas and grouping',()=>{
  let context=functionContext('=IF(A1>0,SUM(B1,B2),"no, thanks"');assert.equal(context.name,'IF');assert.equal(context.activeArgument,2);assert.equal(context.function.signature,getFormulaHelp('IF').signature);
  context=functionContext('=IF(A1>0,SUM(B1,');assert.equal(context.name,'SUM');assert.equal(context.activeArgument,1);
  assert.equal(functionContext('=IF((A1+1)>0,').activeArgument,1);
  assert.equal(functionContext('=UNSUPPORTED('),null);assert.equal(functionContext('=SUM(1,2)'),null);assert.equal(functionContext('hello'),null);
});

test('[C3-26] guidance reflects real lookup date text array and conditional behavior without promising unsupported modes',()=>{
  assert.equal(calculate('=SUMIFS(B1:B3,A1:A3,">1")'),50);
  assert.equal(calculate('=VLOOKUP(2,A1:B3,2,FALSE)'),20);
  assert.equal(calculate('=TEXT(DATE(2026,10,18),"yyyy-mm-dd")'),'2026-10-18');
  assert.equal(calculate('=VALUE("2026-10-18")'),46313);
  assert.deepEqual(calculate('=SEQUENCE(2,2,1,1)'),[[1,2],[3,4]]);
  assert.match(getFormulaHelp('VLOOKUP').notes,/ascending/);assert.match(getFormulaHelp('DATEDIF').notes,/YM/);assert.match(getFormulaHelp('UNIQUE').notes,/not supported/);assert.match(getFormulaHelp('SEARCH').notes,/not supported/);
});
