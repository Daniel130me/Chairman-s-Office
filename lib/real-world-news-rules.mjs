export function canonicalArticleUrl(value){
 try{
  const url=new URL(String(value||''));
  if(!['http:','https:'].includes(url.protocol))return null;
  url.hash='';
  for(const key of [...url.searchParams.keys()])if(key.toLowerCase().startsWith('utm_')||['fbclid','gclid','mc_cid','mc_eid'].includes(key.toLowerCase()))url.searchParams.delete(key);
  return url.toString();
 }catch{return null;}
}
export function parseGdeltDate(value){
 const match=String(value||'').match(/^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/);
 if(!match)return null;
 const date=new Date(match[1]+'-'+match[2]+'-'+match[3]+'T'+match[4]+':'+match[5]+':'+match[6]+'Z');
 return Number.isFinite(date.getTime())?date:null;
}
function clean(value){return String(value||'').replaceAll('"','').split(String.fromCharCode(92)).join('').trim();}
export function buildGdeltQuery(region,sectors=[]){
 const place=clean(String(region||'').split(',')[0]);
 const terms=[...new Set((Array.isArray(sectors)?sectors:[]).map(clean).filter(Boolean))].slice(0,4);
 const focus=terms.length?terms.map(x=>'"'+x+'"').join(' OR '):'business OR economy OR markets OR investment';
 return place&&!/^(global|international|worldwide)$/i.test(place)?'"'+place+'" ('+focus+')':'('+focus+')';
}
export function normalizeGdeltArticle(article){
 const url=canonicalArticleUrl(article?.url),title=String(article?.title||'').trim().slice(0,500);
 if(!url||!title)return null;
 const domain=String(article?.domain||new URL(url).hostname).trim().toLowerCase().slice(0,180);
 if(!domain)return null;
 return {url,title,domain,sourceCountry:String(article?.sourcecountry||'').slice(0,80)||null,language:String(article?.language||'').slice(0,80)||null,publishedAt:parseGdeltDate(article?.seendate)};
}
