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
  if(b.type==='table')return <div className="rich-table-scroll" key={i} tabIndex={0} role="region" aria-label="Business report table"><table><thead><tr>{b.header.map((h,j)=><th key={j} scope="col" style={{textAlign:b.align[j]}}>{inline(h)}</th>)}</tr></thead><tbody>{b.rows.map((row,k)=><tr key={k}>{row.map((c,j)=><td key={j} style={{textAlign:b.align[j]}}>{inline(c)}</td>)}</tr>)}</tbody></table></div>;
  if(b.type==='heading'){const Tag='h'+Math.min(6,b.level+2);return <Tag key={i}>{inline(b.text)}</Tag>;}
  if(b.type==='list'){const Tag=b.ordered?'ol':'ul';return <Tag key={i} start={b.ordered?b.start:undefined}>{b.items.map((item,j)=><li key={j}>{inline(item)}</li>)}</Tag>;}
  if(b.type==='quote')return <blockquote key={i}>{inline(b.text)}</blockquote>;
  if(b.type==='code')return <pre key={i}><code>{b.text}</code></pre>;
  if(b.type==='rule')return <hr key={i}/>;
  return <p key={i}>{inline(b.text)}</p>;
 })}</div>;
}
