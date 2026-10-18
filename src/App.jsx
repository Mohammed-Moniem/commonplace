import React from 'react';
import Library from './components/Library.jsx';
import Editor from './components/Editor.jsx';
class EditorBoundary extends React.Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<div className="editor-loading"><h2>This editor couldn’t open.</h2><p>Your saved file stays in the workspace.</p><button className="primary-button" onClick={()=>window.location.reload()}>Reload editor</button><a href="/">Back to workspace</a></div>:this.props.children;}
}
export default function App(){const match=window.location.pathname.match(/^\/(docs|sheets|slides)\/([a-zA-Z0-9-]+)\/?$/);return <EditorBoundary>{match?<Editor kind={match[1]} id={match[2]}/>:<Library/>}</EditorBoundary>;}
