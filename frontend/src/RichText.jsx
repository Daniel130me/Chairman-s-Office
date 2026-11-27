import React from 'react';
import {parseRichText,inlineTokens} from './rich-text.mjs';
function inline(text){return inlineTokens(text).map((t,i)=>renderToken(t,i));}
function renderToken(t,i){
 const children=t.children?.map((x,j)=>renderToken(x,j))??t.text;
 if(t.type==='strong')return <strong key={i}>{children}</strong>;
 if(t.type==='em')return <em key={i}>{children}</em>;
 if(t.type==='strike')return <del key={i}>{children}</del>;
 if(t.type==='code')return <code key={i}>{t.text}</code>;
 if(t.type==='link')return t.url?<a key={i} href={t.url} target="_blank" rel="noopener noreferrer">{t.text}</a>:<React.Fragment key={i}>{t.text}</React.Fragment>;
 return <React.Fragment key={i}>{t.text}</React.Fragment>;
}
export default function RichText({text,className='' }){
 return <div className={'rich-text '+className}>{parseRichText(text).map((b,i)=>{
  if(b.type==='html-table'){
   const hasHeader=b.rows[0]?.every(c=>c.header),renderRow=(row,k)=><tr key={k}>{row.map((c,j)=>{const Tag=c.header?'th':'td';return <Tag key={j} colSpan={c.colSpan} rowSpan={c.rowSpan} scope={c.header?(hasHeader&&k===0?'col':'row'):undefined}><RichText text={c.text} className="rich-cell-content"/></Tag>;})}</tr>;
   return <div className="rich-table-scroll" key={i} tabIndex={0} role="region" aria-label="Business report table"><table>{b.caption&&<caption>{inline(b.caption)}</caption>}{hasHeader&&<thead>{renderRow(b.rows[0],0)}</thead>}<tbody>{b.rows.slice(hasHeader?1:0).map((row,k)=>renderRow(row,k+(hasHeader?1:0)))}</tbody></table></div>;
  }
  if(b.type==='table')return <div className="rich-table-scroll" key={i} tabIndex={0} role="region" aria-label="Business report table"><table><thead><tr>{b.header.map((h,j)=><th key={j} scope="col" style={{textAlign:b.align[j]}}><RichText text={h} className="rich-cell-content"/></th>)}</tr></thead><tbody>{b.rows.map((row,k)=><tr key={k}>{row.map((c,j)=><td key={j} style={{textAlign:b.align[j]}}><RichText text={c} className="rich-cell-content"/></td>)}</tr>)}</tbody></table></div>;
  if(b.type==='heading'){const Tag='h'+Math.min(6,b.level+2);return <Tag key={i}>{inline(b.text)}</Tag>;}
  if(b.type==='list'){const Tag=b.ordered?'ol':'ul';return <Tag key={i} start={b.ordered?b.start:undefined}>{b.items.map((item,j)=><li key={j}>{inline(item)}</li>)}</Tag>;}
  if(b.type==='quote')return <blockquote key={i}>{inline(b.text)}</blockquote>;
  if(b.type==='code')return <pre key={i}><code>{b.text}</code></pre>;
  if(b.type==='rule')return <hr key={i}/>;
  return <p key={i}>{inline(b.text)}</p>;
 })}</div>;
}
