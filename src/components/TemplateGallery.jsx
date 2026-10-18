import React,{useState,useEffect}from'react';
import {ArrowUpRight}from'lucide-react';
import {Modal,FileIcon}from'./ui.jsx';
import {templates,templateContent}from'../lib/templates.js';
import {appInfo,api}from'../lib/api.js';
import '../templates.css';
export default function TemplateGallery({onClose,onSelect}){
  const[filter,setFilter]=useState('all'),[saved,setSaved]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(null);
  useEffect(()=>{let cancelled=false;api('/templates').then(rows=>{if(!cancelled)setSaved(rows);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[]);
  const choose=async template=>{if(busy)return;setBusy(template.id);setError('');try{const value=template.custom?await api('/templates/'+template.id):{...template,content:templateContent(template.id)};await onSelect({...value,title:value.name});}catch(e){setError(e.message);}finally{setBusy(null);}};
  const cards=[...saved.map(t=>({...t,custom:true,description:'Your saved template · creates an independent copy.'})),...templates].filter(t=>filter==='all'||t.kind===filter);
  return <Modal title="A useful place to start" onClose={onClose} className="template-modal"><p className="template-intro">Choose a starting point. Save your own from any file’s More menu.</p><div className="filter-pills template-filters">{['all','docs','sheets','slides'].map(kind=><button key={kind} className={filter===kind?'selected':''} onClick={()=>setFilter(kind)}>{kind==='all'?'All templates':appInfo[kind].label}</button>)}</div>{error&&<p role="alert">{error}</p>}<div className="template-grid">{cards.map(t=><button className={'template-card template-'+t.kind} key={t.id} aria-label={`Use ${t.name} template`} disabled={!!busy} onClick={()=>choose(t)}><div className="template-card-top"><FileIcon kind={t.kind} size={27}/><ArrowUpRight size={18}/></div><strong>{busy===t.id?'Opening…':t.name}</strong><p>{t.description}</p><span>{t.custom?'Saved · ':''}{appInfo[t.kind].label}</span></button>)}</div></Modal>;
}
