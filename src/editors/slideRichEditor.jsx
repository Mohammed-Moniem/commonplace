import React,{useEffect,useRef} from 'react';
import {EditorContent,useEditor} from '@tiptap/react';
import {Extension} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {TextStyle} from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import {plainRichText,richTextFromEditor,richTextToEditor} from './slideRichText.js';

const Layout=Extension.create({name:'slideParagraphLayout',addGlobalAttributes(){return [{types:['paragraph'],attributes:Object.fromEntries([['lineHeight',1.25],['spaceBefore',0],['spaceAfter',0],['indent',0]].map(([name,fallback])=>[name,{default:fallback,parseHTML:e=>name==='lineHeight'?parseFloat(e.style.lineHeight)||fallback:name==='indent'?Math.round(parseFloat(e.style.paddingLeft||0)/28):parseFloat(e.style[name==='spaceBefore'?'marginTop':'marginBottom']||0),renderHTML:a=>({style:(name==='lineHeight'?'line-height':name==='spaceBefore'?'margin-top':name==='spaceAfter'?'margin-bottom':'padding-left')+':'+(name==='indent'?a[name]*28:a[name])+(name==='lineHeight'?'':'px')})}]))},{types:['textStyle'],attributes:Object.fromEntries(['fontSize','fontFamily'].map(name=>[name,{default:null,parseHTML:e=>e.style[name]||null,renderHTML:a=>a[name]?{style:(name==='fontSize'?'font-size':'font-family')+':'+a[name]}:{}}]))}];}});
export default function SlideRichEditor({element,onChange,onReady,onBlur}){
 const change=useRef(onChange);change.current=onChange;
 const editor=useEditor({extensions:[StarterKit.configure({undoRedo:false,heading:false,blockquote:false,code:false,codeBlock:false,horizontalRule:false,link:false}),TextStyle,Color,TextAlign.configure({types:['paragraph']}),Layout],content:richTextToEditor(element),autofocus:'end',editorProps:{attributes:{role:'textbox','aria-label':'Slide text',class:'se-rich-editor-content'},handleKeyDown(view,event){if(event.key==='Escape'){event.preventDefault();view.dom.blur();onBlur?.();return true;}return false;}},onUpdate({editor}){const richText=richTextFromEditor(editor.getJSON());change.current({text:plainRichText(richText),richText});},onBlur({event}){if(!event.relatedTarget?.closest?.('.se-toolbar,.se-properties,.se-quick-actions'))onBlur?.();}},[element.id]);
 useEffect(()=>{onReady?.(editor);return()=>onReady?.(null);},[editor]);
 return <EditorContent className="se-rich-editor" editor={editor} onPointerDown={e=>e.stopPropagation()}/>;
}
