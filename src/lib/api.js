const changes=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('commonplace-file-changes'):null;
export function subscribeChanges(listener){
  const received=event=>listener(event.data??event.detail);
  changes?.addEventListener('message',received);window.addEventListener('commonplace-change',received);
  return()=>{changes?.removeEventListener('message',received);window.removeEventListener('commonplace-change',received);};
}
export async function api(path, options={}) {
  const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...options.headers},body:options.body===undefined?undefined:JSON.stringify(options.body)});
  const result=await response.json();
  if(!response.ok){const error=new Error(result.error??'Something went wrong.');error.status=response.status;error.current=result.current;throw error;}
  if(options.method&&!['GET','HEAD'].includes(options.method)){
    const parts=path.split('/'),id=parts[1]==='files'?parts[2]:null;
    const update={type:parts.includes('comments')?'comments':id?'file':'library',id,version:result.version};
    changes?.postMessage(update);window.dispatchEvent(new CustomEvent('commonplace-change',{detail:update}));
  }
  return result;
}
export function download(name, value, type='application/json') {
  const blob=value instanceof Blob?value:new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type});
  const href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
}
export const appInfo={docs:{label:'Docs',singular:'document',description:'Give your thoughts a little room.',color:'#477ae0',light:'#edf2fd'},sheets:{label:'Sheets',singular:'spreadsheet',description:'Find the story in your numbers.',color:'#2c8b61',light:'#edf5ef'},slides:{label:'Slides',singular:'presentation',description:'Make your next idea stand out.',color:'#d79b2d',light:'#fcf5e8'}};
