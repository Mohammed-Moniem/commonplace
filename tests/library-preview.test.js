import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../server/index.js';

test('[H2-05] home previews stay bounded while media and long cells remain intact in each file',async()=>{
  const app=createApplication({filename:':memory:',seed:false});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${app.server.address().port}`;
  try{
    const media='data:video/mp4;base64,'+'AAAA'.repeat(100000);
    const deck=app.store.create({kind:'slides',title:'Synthetic media',content:{slides:[{id:'s',background:'#ffffff',elements:[{id:'v',type:'video',x:0,y:0,width:500,height:200,src:media},{id:'t',type:'text',x:0,y:0,width:400,height:100,text:'Title',style:{fontSize:42}}]}]}});
    const book=app.store.create({kind:'sheets',title:'Long cells',content:{sheets:[{id:'s',name:'Sheet',cells:Object.fromEntries(Array.from({length:30},(_,i)=>['A'+(i+1),{value:'X'.repeat(10000)}]))}]}});
    const response=await fetch(origin+'/api/files'),text=await response.text(),files=JSON.parse(text);assert.ok(text.length<10000);assert.ok(!text.includes('data:video/'));assert.deepEqual(files.find(f=>f.id===deck.id).preview,{background:'#ffffff',elements:[{type:'text',text:'Title',style:{fontSize:42}}]});assert.equal(files.find(f=>f.id===book.id).preview[0].value.length,160);
    assert.equal((await(await fetch(origin+'/api/files/'+deck.id)).json()).content.slides[0].elements[0].src,media);assert.equal(app.store.file(book.id).content.sheets[0].cells.A1.value.length,10000);
  }finally{await app.close();}
});
