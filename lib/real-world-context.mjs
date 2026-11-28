import {one} from '../backend/src/db.mjs';
import {realWorldSignalSnapshot} from './real-world-signals.mjs';
import {realWorldNewsSnapshot} from './real-world-news.mjs';
const ageHours=value=>{
 const time=new Date(value||0).getTime();
 return Number.isFinite(time)&&time>0?Math.max(0,Math.round((Date.now()-time)/3600000)):null;
};
function signalFreshness(signal,hours){
 if(signal.signal_type==='macro')return hours===null?'unknown':hours>24*450?'stale annual data':'latest available annual data';
 if(hours===null)return 'unknown';
 if(signal.signal_type==='weather')return hours<=6?'fresh':hours<=24?'recent':'stale';
 if(signal.signal_type==='fx-rate')return hours<=30?'fresh':hours<=72?'recent':'stale';
 return hours<=24?'fresh':hours<=72?'recent':'stale';
}
export const REAL_WORLD_DECISION_RULES=[
 'Use these external signals when they materially affect the question, not as decoration.',
 'Check source, observation/publication time, freshness and geographic relevance before relying on a signal.',
 'Weather can affect travel, logistics, events, staff safety and operational continuity; exchange rates can affect cross-border costs, contracts, treasury and financing; news can affect regulation, reputation, competitors, talent, supply chains and geopolitical risk.',
 'Proactively warn the Chairman and challenge or recommend against an action when credible current evidence materially increases risk or changes the expected outcome. Explain the mechanism, source, date and confidence.',
 'Distinguish verified data, reported allegations, analysis, forecasts and rumours. A headline is not proof. Do not attribute fictional actions to real companies or people.',
 'Reference FX rates are indicative, not bank quotes. Weather forecasts are probabilistic. Annual macroeconomic indicators are lagged and must not be described as live.',
 'If the relevant source is missing, stale, contradictory or geographically irrelevant, say so and request a fresh check before an irreversible decision.',
 'External data informs advice and scenario planning; it never silently changes fictional ledgers, balances, contracts or approvals.'
].join(' ');
export async function realWorldDecisionContext(userId,limit=12){
 const [world,signals,news]=await Promise.all([
  one('SELECT name,region FROM worlds WHERE user_id=$1',[userId]),
  realWorldSignalSnapshot(userId),
  realWorldNewsSnapshot(userId,Math.max(1,Math.min(20,limit)))
 ]);
 const signalRows=(signals||[]).map(signal=>{
  const hours=ageHours(signal.observed_at);
  return {label:signal.label,value:signal.value,unit:signal.unit,type:signal.signal_type,source:signal.source_name,sourceUrl:signal.source_url,observedAt:signal.observed_at,fetchedAt:signal.fetched_at,ageHours:hours,freshness:signalFreshness(signal,hours)};
 });
 const newsRows=(news||[]).map(item=>{
  const hours=ageHours(item.published_at||item.retrieved_at);
  return {headline:item.title,publisher:item.domain,publishedAt:item.published_at,retrievedAt:item.retrieved_at,ageHours:hours,freshness:hours===null?'unknown':hours<=12?'fresh':hours<=48?'recent':'older report',url:item.url};
 });
 return {asOf:new Date().toISOString(),region:world?.region||null,signals:signalRows,news:newsRows,rules:REAL_WORLD_DECISION_RULES};
}
