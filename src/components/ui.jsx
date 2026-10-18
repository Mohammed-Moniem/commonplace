import React,{useEffect,useRef} from 'react';
import {FileText,Table2,Presentation,X} from 'lucide-react';
export function FileIcon({kind,size=32,plain=false}){const Icon=kind==='sheets'?Table2:kind==='slides'?Presentation:FileText;return <span className={`file-icon ${kind} ${plain?'plain':''}`}><Icon size={size} strokeWidth={1.65}/></span>;}
export function Logo({compact=false}){return <span className={`brand ${compact?'compact':''}`}><span className="brand-mark"><i/><i/><i/><i/></span>{!compact&&<span>commonplace<span className="brand-period">.</span></span>}</span>;}
export function Modal({title,children,onClose,className=''}){
  const dialog=useRef();
  useEffect(()=>{const previous=document.activeElement;dialog.current?.showModal();return()=>{dialog.current?.close();previous?.focus();};},[]);
  return <dialog className={`modal ${className}`} ref={dialog} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===dialog.current)onClose();}}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
export function FieldDialog({title,label,initial='',confirm='Save',onConfirm,onClose,maxLength=240}){const ref=useRef();useEffect(()=>{ref.current?.focus();ref.current?.select();},[]);return <Modal title={title} onClose={onClose}><form onSubmit={e=>{e.preventDefault();const value=ref.current.value.trim();if(value)onConfirm(value);}}><label className="field-label">{label}<input ref={ref} defaultValue={initial} required maxLength={maxLength}/></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">{confirm}</button></div></form></Modal>;}
export function Spinner(){return <span className="spinner" aria-label="Loading"/>;}
