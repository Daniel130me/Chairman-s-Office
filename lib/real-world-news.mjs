import {sql,transaction,uid} from '../backend/src/db.mjs';
import {buildGdeltQuery,normalizeGdeltArticle,canonicalArticleUrl} from './real-world-news-rules.mjs';
const ENDPOINT='https://api.gdeltproject.org/api/v2/doc/doc';
function decodeXml(value){
 return String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
  .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
  .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").trim();
}
function xmlTag(block,name){
 const match=block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+name+'>','i'));
 return match?decodeXml(match[1]):'';
}
export function parseGoogleNewsRss(xml){
 const items=[...String(xml||'').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
 return items.map(([_,block])=>{
  const title=xmlTag(block,'title').slice(0,500);
  const url=canonicalArticleUrl(xmlTag(block,'link'));
  const source=block.match(/<source\b[^>]*url=["']([^"']+)["'][^>]*>([\s\S]*?)<\/source>/i);
  const sourceUrl=source?canonicalArticleUrl(source[1]):null;
  const publisher=source?decodeXml(source[2]):'';
  let domain='';
  try{domain=new URL(sourceUrl||url).hostname.toLowerCase();}catch{}
  const published=new Date(xmlTag(block,'pubDate'));
  if(!title||!url||!domain)return null;
  return {title,url,domain,sourceCountry:null,language:'en',publishedAt:Number.isFinite(published.getTime())?published:null,publisher};
 }).filter(Boolean);
}
async function fetchGdelt(query){
 const params=new URLSearchParams({query,mode:'ArtList',format:'json',timespan:'24h',maxrecords:'12',sort:'DateDesc'});
 const response=await fetch(ENDPOINT+'?'+params.toString(),{headers:{accept:'application/json'},signal:AbortSignal.timeout(9000),cache:'no-store'});
 if(!response.ok)throw new Error('GDELT returned '+response.status);
 if(!(response.headers.get('content-type')||'').toLowerCase().includes('json'))throw new Error('GDELT did not return JSON');
 const payload=await response.json();
 return Array.isArray(payload?.articles)?payload.articles.map(normalizeGdeltArticle).filter(Boolean):[];
}
async function fetchGoogleNews(query){
 const rssQuery='"'+String(query||'business').replace(/["']/g,' ')+'" (business OR economy OR markets OR investment OR technology)';
 const params=new URLSearchParams({q:rssQuery,hl:'en',gl:'US',ceid:'US:en'});
 const response=await fetch('https://news.google.com/rss/search?'+params.toString(),{headers:{accept:'application/rss+xml, application/xml, text/xml'},signal:AbortSignal.timeout(9000),cache:'no-store'});
 if(!response.ok)throw new Error('Google News RSS returned '+response.status);
 const xml=await response.text();
 if(!/<rss\b|<feed\b/i.test(xml))throw new Error('Google News did not return an RSS feed');
 return parseGoogleNewsRss(xml);
}
export async function refreshRealWorldNews(userId,world){
 const [claim]=await sql(`UPDATE worlds SET last_real_news_attempt_at=now()
  WHERE id=$1 AND user_id=$2
  AND (last_real_news_at IS NULL OR last_real_news_at<now()-interval '1 hour')
  AND (last_real_news_attempt_at IS NULL OR last_real_news_attempt_at<now()-interval '30 minutes')
  RETURNING id`,[world.id,userId]);
 if(!claim)return 0;
 try{
  const sectors=await sql('SELECT DISTINCT sector FROM companies WHERE user_id=$1 AND sector IS NOT NULL ORDER BY sector LIMIT 4',[userId]);
  const query=buildGdeltQuery(world.region,sectors.map(x=>x.sector));
  let articles=[],provider='GDELT';
  try{articles=await fetchGdelt(query);}catch(error){console.warn('GDELT news unavailable; trying RSS fallback',error.name||'error');}
  if(!articles.length){
   const regionQuery=[String(world.region||'').split(',')[0],...sectors.map(x=>x.sector)].filter(Boolean).join(' ');
   articles=await fetchGoogleNews(regionQuery);
   provider='Google News RSS';
  }
  let inserted=0;
  await transaction(async q=>{
   const locked=(await q('SELECT id FROM worlds WHERE id=$1 AND user_id=$2 FOR UPDATE',[world.id,userId]))[0];if(!locked)return;
   for(const article of articles){
    const row=await q(`INSERT INTO real_world_news(id,user_id,world_id,title,url,domain,source_country,language,published_at,search_query)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,url) DO NOTHING RETURNING id`,
     [uid(),userId,world.id,article.title,article.url,article.domain,article.sourceCountry||null,article.language||'en',article.publishedAt,query+' ['+provider+']']);
    if(row.length)inserted++;
   }
   await q('UPDATE worlds SET last_real_news_at=now(),last_real_news_attempt_at=now() WHERE id=$1',[world.id]);
   if(inserted)await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),userId,world.id,'news-digest','External business news updated',inserted+' new sourced reports from '+provider+' are available in the News app. Headlines are reported coverage, not verified company facts.']);
  });
  return inserted;
 }catch(error){
  console.warn('Real-world news unavailable from all configured sources',error.name||'error');
  return 0;
 }
}
export async function realWorldNewsSnapshot(userId,limit=50){
 const safeLimit=Math.max(1,Math.min(100,Number(limit)||50));
 return sql('SELECT id,title,url,domain,source_country,language,published_at,retrieved_at,search_query FROM real_world_news WHERE user_id=$1 ORDER BY published_at DESC NULLS LAST,retrieved_at DESC LIMIT $2',[userId,safeLimit]);
}
