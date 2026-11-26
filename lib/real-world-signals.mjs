import {sql,one,transaction,uid} from '../backend/src/db.mjs';
import {weatherPlace,weatherReadings} from './weather-rules.mjs';
import {refreshRealWorldNews} from './real-world-news.mjs';
const FX_URL='https://open.er-api.com/v6/latest/USD';
const BANK_BASE='https://api.worldbank.org/v2/country';
const currencies=[['NGN','US dollar to Nigerian naira'],['EUR','US dollar to euro'],['GBP','US dollar to pound sterling'],['AED','US dollar to UAE dirham']];
const indicators=[
 ['NGA','FP.CPI.TOTL.ZG','Nigeria inflation','percent'],
 ['USA','FP.CPI.TOTL.ZG','United States inflation','percent'],
 ['GBR','FP.CPI.TOTL.ZG','United Kingdom inflation','percent'],
 ['ARE','FP.CPI.TOTL.ZG','United Arab Emirates inflation','percent']
];
async function getJson(url){
 const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(5000),cache:'no-store'});
 if(!response.ok)throw new Error('External data source returned '+response.status);
 return response.json();
}
async function saveSignal(q,world,key,type,label,value,unit,source,url,observedAt){
 if(!Number.isFinite(Number(value)))return;
 const prior=(await q('SELECT value,observed_at FROM real_world_signals WHERE user_id=$1 AND signal_key=$2 ORDER BY observed_at DESC LIMIT 1',[world.user_id,key]))[0];
 const row=(await q(`INSERT INTO real_world_signals(id,user_id,world_id,signal_key,signal_type,label,value,unit,source_name,source_url,observed_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
 ON CONFLICT(user_id,signal_key,observed_at) DO UPDATE SET value=excluded.value,unit=excluded.unit,source_url=excluded.source_url,fetched_at=now()
 RETURNING *`,[uid(),world.user_id,world.id,key,type,label,value,unit,source,url,observedAt]))[0];
 if(!prior||Number(prior.value)!==Number(value)){
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),world.user_id,world.id,'real-world-signal',label+' updated',Number(value).toLocaleString(undefined,{maximumFractionDigits:4})+' '+unit+' · Source: '+source+' · Observation: '+new Date(observedAt).toISOString().slice(0,10)]);
 }
 return row;
}
export async function refreshRealWorldSignals(userId){
 const world=await one('SELECT * FROM worlds WHERE user_id=$1',[userId]);if(!world)return false;
 await refreshRealWorldNews(userId,world);
 if(world.last_real_signal_at&&Date.now()-new Date(world.last_real_signal_at).getTime()<6*60*60*1000)return false;
 if(world.last_real_signal_attempt_at&&Date.now()-new Date(world.last_real_signal_attempt_at).getTime()<30*60*1000)return false;
 await sql('UPDATE worlds SET last_real_signal_attempt_at=now() WHERE id=$1',[world.id]);
 const tasks=[];
 const fxPromise=getJson(FX_URL).then(fx=>{
  if(fx?.result==='success'&&fx.rates){
   const observed=new Date((fx.time_last_update_unix||Math.floor(Date.now()/1000))*1000);
   for(const [code,label] of currencies)if(Number.isFinite(Number(fx.rates[code])))tasks.push({key:'USD/'+code,type:'fx-rate',label,value:fx.rates[code],unit:code,source:'ExchangeRate-API',url:FX_URL,observed});
  }
 }).catch(error=>console.warn('FX signal source unavailable',error.name||'error'));
 const place=weatherPlace(world.region);
 let weatherPromise=null;
 if(place){
  weatherPromise=(async()=>{
   try{
    const geoUrl='https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(place)+'&count=1&language=en&format=json';
    const geo=await getJson(geoUrl),location=geo?.results?.[0];
    if(!location||!Number.isFinite(Number(location.latitude))||!Number.isFinite(Number(location.longitude)))return;
    const params=new URLSearchParams({latitude:String(location.latitude),longitude:String(location.longitude),current:'temperature_2m,precipitation,wind_speed_10m,weather_code',daily:'precipitation_probability_max',timezone:'UTC'});
    const url='https://api.open-meteo.com/v1/forecast?'+params.toString();
    const forecast=await getJson(url);
    const observed=forecast?.current?.time?new Date(forecast.current.time+'Z'):new Date();
    for(const item of weatherReadings(forecast?.current,forecast?.daily,location.name||place,observed,url))tasks.push({...item,source:'Open-Meteo',url,observed});
   }catch(error){console.warn('Weather signal unavailable',error.name||'error');}
  })();
 }
 const bankPromises=indicators.map(async ([country,indicator,label,unit])=>{
  const url=BANK_BASE+'/'+country+'/indicator/'+indicator+'?format=json&per_page=8';
  try{
   const payload=await getJson(url),records=Array.isArray(payload?.[1])?payload[1]:[];
   const record=records.find(x=>x?.value!==null&&Number.isFinite(Number(x.value)));
   if(record)tasks.push({key:country+':'+indicator,type:'macro',label,value:record.value,unit,source:'World Bank',url,observed:new Date(record.date+'-01-01T00:00:00Z')});
  }catch(error){console.warn('World Bank signal unavailable',country,error.name||'error');}
 });
 await Promise.all([fxPromise,...bankPromises,...(weatherPromise?[weatherPromise]:[])]);
 await transaction(async q=>{
  const locked=(await q('SELECT id FROM worlds WHERE id=$1 AND user_id=$2 FOR UPDATE',[world.id,userId]))[0];if(!locked)return;
  for(const item of tasks)await saveSignal(q,world,item.key,item.type,item.label,item.value,item.unit,item.source,item.url,item.observed);
  if(tasks.length)await q('UPDATE worlds SET last_real_signal_at=now(),last_real_signal_attempt_at=now() WHERE id=$1',[world.id]);
 });
 return tasks.length>0;
}
export async function realWorldSignalSnapshot(userId){
 return sql('SELECT * FROM real_world_signals WHERE user_id=$1 ORDER BY observed_at DESC,signal_key LIMIT 100',[userId]);
}
