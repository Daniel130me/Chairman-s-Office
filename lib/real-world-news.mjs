import {sql,transaction,uid} from '../backend/src/db.mjs';
import {buildGdeltQuery,normalizeGdeltArticle} from './real-world-news-rules.mjs';
const ENDPOINT='https://api.gdeltproject.org/api/v2/doc/doc';
export async function refreshRealWorldNews(userId,world){
 const [claim]=await sql(`UPDATE worlds SET last_real_news_attempt_at=now()
  WHERE id=$1 AND user_id=$2
  AND (last_real_news_at IS NULL OR last_real_news_at<now()-interval '6 hours')
  AND (last_real_news_attempt_at IS NULL OR last_real_news_attempt_at<now()-interval '30 minutes')
  RETURNING id`,[world.id,userId]);
 if(!claim)return 0;
 try{
  const sectors=await sql('SELECT DISTINCT sector FROM companies WHERE user_id=$1 AND sector IS NOT NULL ORDER BY sector LIMIT 4',[userId]);
  const query=buildGdeltQuery(world.region,sectors.map(x=>x.sector));
  const params=new URLSearchParams({query,mode:'ArtList',format:'json',timespan:'24h',maxrecords:'12',sort:'DateDesc'});
  const url=ENDPOINT+'?'+params.toString();
  const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(9000),cache:'no-store'});
  if(!response.ok)throw new Error('GDELT returned '+response.status);
  if(!(response.headers.get('content-type')||'').toLowerCase().includes('json'))throw new Error('GDELT did not return JSON');
  const payload=await response.json();
  const articles=Array.isArray(payload?.articles)?payload.articles.map(normalizeGdeltArticle).filter(Boolean):[];
  let inserted=0;
  await transaction(async q=>{
   const locked=(await q('SELECT id FROM worlds WHERE id=$1 AND user_id=$2 FOR UPDATE',[world.id,userId]))[0];if(!locked)return;
   for(const article of articles){
    const row=await q(`INSERT INTO real_world_news(id,user_id,world_id,title,url,domain,source_country,language,published_at,search_query)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,url) DO NOTHING RETURNING id`,
     [uid(),userId,world.id,article.title,article.url,article.domain,article.sourceCountry,article.language,article.publishedAt,query]);
    if(row.length)inserted++;
   }
   await q('UPDATE worlds SET last_real_news_at=now(),last_real_news_attempt_at=now() WHERE id=$1',[world.id]);
   if(inserted)await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),userId,world.id,'news-digest','External business news updated',inserted+' new sourced reports are available in the News app. Headlines are reported coverage, not verified company facts.']);
  });
  return inserted;
 }catch(error){
  console.warn('Real-world news unavailable',error.name||'error');
  return 0;
 }
}
export async function realWorldNewsSnapshot(userId,limit=50){
 const safeLimit=Math.max(1,Math.min(100,Number(limit)||50));
 return sql('SELECT id,title,url,domain,source_country,language,published_at,retrieved_at,search_query FROM real_world_news WHERE user_id=$1 ORDER BY published_at DESC NULLS LAST,retrieved_at DESC LIMIT $2',[userId,safeLimit]);
}
