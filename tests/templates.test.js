import test from'node:test';import assert from'node:assert/strict';
import {templates,templateContent}from'../src/lib/templates.js';
import {openStore}from'../server/store.js';
test('[H2-01] every template creates an editable persisted file with non-empty app content',()=>{
  const store=openStore(':memory:',{seed:false});try{assert.equal(templates.length,9);const counts={docs:0,sheets:0,slides:0};for(const template of templates){const created=store.create({kind:template.kind,title:template.name,content:templateContent(template.id)});assert.deepEqual(store.file(created.id).content,template.content);counts[template.kind]++;}assert.deepEqual(counts,{docs:3,sheets:3,slides:3});}finally{store.close();}
});
test('[H2-02] editing a created template never changes the reusable original',()=>{const first=templateContent('monthly-budget');first.sheets[0].cells.A1.value='Edited';assert.equal(templateContent('monthly-budget').sheets[0].cells.A1.value,'Category');assert.throws(()=>templateContent('unknown'),/not found/);});
