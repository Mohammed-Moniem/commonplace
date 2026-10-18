export default async function* reporter(events){
  for await(const event of events){
    if(!['test:pass','test:fail','test:summary','test:diagnostic'].includes(event.type))continue;
    const {name,file,line,column,nesting,details,message,counts,skip,todo}=event.data;
    const error=details?.error;
    yield JSON.stringify({type:event.type,name,file,line,column,nesting,message,counts,skip,todo,durationMs:details?.duration_ms,...(error?{error:{message:error.message,cause:error.cause?.message,expected:error.cause?.expected,actual:error.cause?.actual,stack:error.cause?.stack??error.stack}}:{})})+'\n';
  }
}
