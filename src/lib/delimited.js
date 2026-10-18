export function parseDelimited(input,separator=','){
  const rows=[[]];let field='',quoted=false;const text=String(input).replace(/^\uFEFF/,'');
  const pushField=()=>{if(rows.at(-1).length>=200)throw new Error('This file exceeds the 200-column local grid.');rows.at(-1).push(field);field='';};
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(quoted||field==='')quoted=!quoted;else field+=c;}
    else if(c===separator&&!quoted)pushField();else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;pushField();if(rows.length>=10000&&i<text.length-1)throw new Error('This file exceeds the 10,000-row local grid.');rows.push([]);}else field+=c;
  }
  if(quoted)throw new Error('The file contains an unclosed quoted field.');pushField();if(rows.length>1&&rows.at(-1).length===1&&rows.at(-1)[0]==='')rows.pop();return rows;
}
