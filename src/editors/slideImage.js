// Native image fitting follows DrawingML fillRect percentage insets:
// https://learn.microsoft.com/dotnet/api/documentformat.openxml.drawing.fillrectangle
export function rasterSize(bytes){
 const u16=i=>bytes[i]*256+bytes[i+1],u32=i=>((bytes[i]*0x1000000)+(bytes[i+1]<<16)+(bytes[i+2]<<8)+bytes[i+3]);
 if(bytes.length>=24&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return {width:u32(16),height:u32(20)};
 if(bytes.length>=10&&bytes[0]===71&&bytes[1]===73&&bytes[2]===70)return {width:bytes[6]+bytes[7]*256,height:bytes[8]+bytes[9]*256};
 if(bytes.length>4&&bytes[0]===255&&bytes[1]===216){let i=2;while(i+8<bytes.length){if(bytes[i++]!==255)continue;let marker=bytes[i++];while(marker===255)marker=bytes[i++];if(marker===217||marker===218)break;if(marker===216||marker===1||marker>=208&&marker<=215)continue;const length=u16(i);if(length<2||i+length>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {width:u16(i+5),height:u16(i+3)};i+=length;}}
 return null;
}
export function nativeImagePlacement(element,bytes){
 let crop=element.crop,fill={l:0,t:0,r:0,b:0};const size=rasterSize(bytes);
 if(!crop&&size?.width&&size?.height){const source=size.width/size.height,target=element.width/element.height;
  if(element.imageFit==='cover'){if(source>target){const width=target/source;crop={x:(1-width)/2,y:0,width,height:1};}else{const height=source/target;crop={x:0,y:(1-height)/2,width:1,height};}}
  else if(source>target){const inset=(1-target/source)/2;fill.t=fill.b=inset;}else{const inset=(1-source/target)/2;fill.l=fill.r=inset;}
 }
 const attrs=rect=>Object.entries(rect).map(([k,v])=>' '+k+'="'+Math.round(v*100000)+'"').join('');
 return {sourceRect:crop?'<a:srcRect'+attrs({l:crop.x,t:crop.y,r:1-crop.x-crop.width,b:1-crop.y-crop.height})+'/>':'',fillRect:'<a:stretch><a:fillRect'+attrs(fill)+'/></a:stretch>'};
}
