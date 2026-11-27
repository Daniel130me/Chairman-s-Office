// Translate a small allowlist of HTML formatting into inert text/table records.
// All attributes are discarded except bounded numeric table spans. React renders
// these records as text and known elements; no arbitrary HTML is ever inserted.
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',ndash:'–',mdash:'—',bull:'•',hellip:'…',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',thinsp:'\u2009',ensp:'\u2002',emsp:'\u2003'};
export function decodeEntities(text){
 return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(whole,key)=>{
  if(key[0]==='#'){const n=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):whole;}
  return Object.hasOwn(entities,key.toLowerCase())?entities[key.toLowerCase()]:whole;
 });
}
const tagPattern=/<(\/?)([a-z][a-z0-9-]*)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
const recognized=/&lt;\/?(?:table|thead|tbody|tfoot|tr|th|td|caption|p|br|div|strong|b|em|i|ul|ol|li|h[1-6]|blockquote|span)\b/i;
function decodedMarkup(value){
 // Recover escaped formatting from providers, without recursively decoding.
 return recognized.test(value)?decodeEntities(value):value;
}
function withoutActiveMarkup(value){
 return value.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|iframe|object|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
}
export function htmlText(value){
 let text=withoutActiveMarkup(decodedMarkup(value)),ordered=[],next=[];
 text=text.replace(tagPattern,(tag,slash,name)=>{
  name=name.toLowerCase();
  if(name==='br')return '\n';
  if(['p','div','section','article','header','footer'].includes(name))return '\n\n';
  if(['b','strong'].includes(name))return '**';
  if(['em','i'].includes(name))return '*';
  if(['del','s','strike'].includes(name))return '~~';
  if(name==='hr')return '\n\n---\n\n';
  if(/^h[1-6]$/.test(name))return slash?'\n\n':'\n\n'+'#'.repeat(Number(name[1]))+' ';
  if(name==='ul'||name==='ol'){if(slash){ordered.pop();next.pop();}else{ordered.push(name==='ol');next.push(1);}return '\n';}
  if(name==='li'){if(slash)return '\n';const i=ordered.length-1;return '\n'+(ordered[i]?String(next[i]++)+'. ':'- ');}
  if(name==='blockquote')return slash?'\n\n':'\n> ';
  if(['a','span','font','u','mark','small','sup','sub','thead','tbody','tfoot','colgroup','col'].includes(name))return '';
  if(['img','video','audio','embed','input','button','form','link','meta','base','svg','math'].includes(name))return '';
  // Unknown markup is only text, never a DOM element.
  return tag;
 });
 return decodeEntities(text).replace(/\n[ \t]+\n/g,'\n\n').trim();
}
function span(tag,name){
 const match=new RegExp('\\b'+name+'\\s*=\\s*(?:"(\\d+)"|\\x27(\\d+)\\x27|(\\d+))','i').exec(tag);
 const n=Number(match?.[1]||match?.[2]||match?.[3]||1);
 return Number.isInteger(n)&&n>=1&&n<=20?n:1;
}
// Tolerate omitted end tags and partially received tables. Each cell retains
// line breaks, emphasis and list content. No arbitrary tag or attribute survives.
function tableRecord(raw){
 const rows=[];let row=[],cell=null,caption='',captionStart=-1,depth=0;
 const finishCell=end=>{if(cell){row.push({header:cell.header,text:htmlText(raw.slice(cell.start,end)),colSpan:cell.colSpan,rowSpan:cell.rowSpan});cell=null;}};
 const finishRow=end=>{finishCell(end);if(row.length){rows.push(row);row=[];}};
 for(const m of raw.matchAll(tagPattern)){
  const name=m[2].toLowerCase(),closing=!!m[1],index=m.index,end=index+m[0].length;
  if(name==='table'){if(!closing){depth++;continue;}if(depth===1){finishRow(index);depth--;break;}depth--;continue;}
  if(depth!==1)continue;
  if(name==='caption'){if(closing&&captionStart>=0){caption=htmlText(raw.slice(captionStart,index));captionStart=-1;}else if(!closing)captionStart=end;continue;}
  if(name==='tr'){finishRow(index);continue;}
  if(name==='td'||name==='th'){
   finishCell(index);
   if(!closing)cell={header:name==='th',start:end,colSpan:span(m[0],'colspan'),rowSpan:span(m[0],'rowspan')};
  }
 }
 finishRow(raw.length);
 return {type:'html-table',rows,caption};
}
export function htmlSegments(value){
 const source=withoutActiveMarkup(decodedMarkup(value)),out=[];
 let cursor=0,start=-1,depth=0;
 for(const m of source.matchAll(tagPattern)){
  if(m[2].toLowerCase()!=='table')continue;
  if(!m[1]){
   if(depth===0){if(m.index>cursor)out.push({type:'text',text:htmlText(source.slice(cursor,m.index))});start=m.index;}
   depth++;
  }else if(depth>0){
   depth--;
   if(depth===0){cursor=m.index+m[0].length;out.push(tableRecord(source.slice(start,cursor)));start=-1;}
  }
 }
 if(start>=0)out.push(tableRecord(source.slice(start)));
 else if(cursor<source.length)out.push({type:'text',text:htmlText(source.slice(cursor))});
 return out;
}
