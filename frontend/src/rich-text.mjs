// Small, deterministic Markdown subset for untrusted fictional business records.
// No HTML interpretation, external media, executable URLs, or raw DOM injection.
const normalize=value=>String(value??'').replace(/\r\n?/g,'\n');
const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(c=>c.trim().replace(/\\\|/g,'|'));
const separator=row=>row.length>=2&&row.every(c=>/^:?-{3,}:?$/.test(c));
const tableLine=line=>/^\s*\|.*\|\s*$/.test(line);
const heading=line=>/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
const list=line=>/^\s{0,3}([-+*•]|\d+[.)])\s+(.+)$/.exec(line);
const rule=line=>/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
// Some providers return a whole pipe table on one line. Recover only when an
// explicit header separator and consistent column counts prove it is a table.
function recoverFlatTables(value){
 return value.split('\n').map(line=>{
  if(!/\|\s*\|\s*:?-{3,}/.test(line))return line;
  const start=line.indexOf('|'),end=line.lastIndexOf('|');
  if(start===end)return line;
  const groups=line.slice(start,end+1).split(/\|\s*\|/).map((s,i,a)=>(i?'|':'')+s+(i<a.length-1?'|':''));
  if(groups.length<2)return line;
  const count=cells(groups[0]).length;
  if(!separator(cells(groups[1]))||cells(groups[1]).length!==count||!groups.every(g=>cells(g).length===count))return line;
  return [line.slice(0,start).trim(),...groups,line.slice(end+1).trim()].filter(Boolean).join('\n');
 }).join('\n');
}
export function parseRichText(value){
 const lines=recoverFlatTables(normalize(value)).split('\n'),blocks=[];
 let i=0;
 while(i<lines.length){
  const line=lines[i];
  if(!line.trim()){i++;continue;}
  const fence=/^\s*`{3,}\s*([\w+-]*)\s*$/.exec(line);
  if(fence){const content=[];i++;while(i<lines.length&&!/^\s*`{3,}\s*$/.test(lines[i]))content.push(lines[i++]);if(i<lines.length)i++;blocks.push({type:'code',text:content.join('\n')});continue;}
  const h=heading(line);if(h){blocks.push({type:'heading',level:h[1].length,text:h[2]});i++;continue;}
  if(rule(line)){blocks.push({type:'rule'});i++;continue;}
  if(line.includes('|')&&i+1<lines.length&&lines[i+1].includes('|')){
   const header=cells(line),sep=cells(lines[i+1]);
   if(separator(sep)&&header.length===sep.length){
    i+=2;const rows=[];
    while(i<lines.length&&lines[i].includes('|')&&(tableLine(lines[i])||cells(lines[i]).length===header.length)){
     const row=cells(lines[i]);if(row.length!==header.length)break;rows.push(row);i++;
    }
    blocks.push({type:'table',header,rows,align:sep.map(c=>c.endsWith(':')?(c.startsWith(':')?'center':'right'):'left')});continue;
   }
  }
  const marker=list(line);
  if(marker){const ordered=/^\d/.test(marker[1]),items=[];const start=ordered?parseInt(marker[1],10):1;
   while(i<lines.length){const item=list(lines[i]);if(!item||/^\d/.test(item[1])!==ordered)break;items.push(item[2]);i++;}
   blocks.push({type:'list',ordered,start,items});continue;
  }
  if(/^\s*>\s?/.test(line)){const content=[];while(i<lines.length&&/^\s*>\s?/.test(lines[i]))content.push(lines[i++].replace(/^\s*>\s?/,''));blocks.push({type:'quote',text:content.join('\n')});continue;}
  const content=[line];i++;
  while(i<lines.length&&lines[i].trim()&&!heading(lines[i])&&!list(lines[i])&&!rule(lines[i])&&!/^\s*(?:>|`{3,})/.test(lines[i])){
   if(lines[i].includes('|')&&i+1<lines.length&&separator(cells(lines[i+1])))break;
   content.push(lines[i++]);
  }
  blocks.push({type:'paragraph',text:content.join('\n')});
 }
 return blocks;
}
export function inlineTokens(value,depth=0){
 const input=normalize(value);
 if(depth>=5)return [{type:'text',text:input}];
 const pattern=/(`[^`\n]+`|\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|\*(?!\s)[^*\n]+?\*|(?<!\w)_(?!\s)[^_\n]+?_(?!\w)|\[[^\]\n]+\]\([^)\n]+\))/g;
 const out=[];let end=0;
 for(const m of input.matchAll(pattern)){
  if(m.index>end)out.push({type:'text',text:input.slice(end,m.index)});
  const s=m[0];let type,text,url;
  if(s.startsWith('`')){type='code';text=s.slice(1,-1);}
  else if(s.startsWith('[')){const link=/^\[([^\]]+)\]\(([^)]+)\)$/.exec(s);type='link';text=link[1];url=/^https?:\/\/[^\s<>"']+$/i.test(link[2])?link[2]:null;}
  else{const n=s.startsWith('**')||s.startsWith('__')||s.startsWith('~~')?2:1;type=s.startsWith('~~')?'strike':n===2?'strong':'em';text=s.slice(n,-n);}
  out.push({type,text,...(type==='link'?{url}:{}),...(['strong','em','strike'].includes(type)?{children:inlineTokens(text,depth+1)}:{})});end=m.index+s.length;
 }
 if(end<input.length)out.push({type:'text',text:input.slice(end)});
 return out;
}
export function previewText(value){
 return normalize(value).replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/^\s*#{1,6}\s+/gm,'').replace(/\*\*|__|~~|`/g,'').replace(/\|/g,' ').replace(/\s+/g,' ').trim();
}
