import {sql,one,transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {localTime,isQuiet} from './schedule.mjs';
import {refreshRealWorldSignals,realWorldSignalSnapshot} from './real-world-signals.mjs';
export async function marketSnapshot(userId){
 // Older worlds created before the external-organization model are upgraded lazily
 // from their existing contact directory without inventing financial figures.
 const unlinked=await sql("SELECT id,world_id,name,company,kind,agenda FROM contacts WHERE user_id=$1 AND kind<>'internal' AND organization_id IS NULL",[userId]);
 for(const person of unlinked){
  const kind=['rival','competitor'].includes(person.kind)?'competitor':person.kind;
  await transaction(async q=>{
   const org=(await q("INSERT INTO external_organizations(id,user_id,world_id,name,sector,organization_type,strategy,market_position,reputation,competitive_pressure) SELECT $1,$2,$3,$4,coalesce((SELECT sector FROM companies WHERE user_id=$2 ORDER BY created_at LIMIT 1),'General'),$5,$6,'established',55,CASE WHEN $5='competitor' THEN 70 ELSE 25 END ON CONFLICT(user_id,world_id,name) DO UPDATE SET strategy=external_organizations.strategy RETURNING id",[uid(),userId,person.world_id,person.company||person.name,kind,person.agenda||'Maintain a commercial relationship']))[0];
   await q('UPDATE contacts SET organization_id=$1 WHERE id=$2 AND user_id=$3 AND organization_id IS NULL',[org.id,person.id,userId]);
  });
 }
 const organizations=await sql('SELECT * FROM external_organizations WHERE user_id=$1 AND status=$2 ORDER BY competitive_pressure DESC,name',[userId,'active']);
 const moves=await sql('SELECT m.*,o.name AS organization_name,c.name AS contact_name,co.name AS company_name FROM market_moves m JOIN external_organizations o ON o.id=m.organization_id AND o.user_id=m.user_id LEFT JOIN contacts c ON c.id=m.contact_id AND c.user_id=m.user_id LEFT JOIN companies co ON co.id=m.company_id AND co.user_id=m.user_id WHERE m.user_id=$1 ORDER BY m.created_at DESC LIMIT 100',[userId]);
 const realWorldSignals=await realWorldSignalSnapshot(userId);
 return {externalOrganizations:organizations,marketMoves:moves,realWorldSignals};
}
export async function processMarketMoves(userId){
 await refreshRealWorldSignals(userId);
 const reserved=await transaction(async q=>{
  const w=(await q('SELECT * FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]))[0];if(!w)return null;
  if(w.last_market_move_at&&Date.now()-new Date(w.last_market_move_at).getTime()<12*60*60*1000)return null;
  const s=(await q('SELECT * FROM settings WHERE user_id=$1',[userId]))[0];if(!s)return null;
  const now=localTime(w.timezone);if(s.quiet_enabled&&isQuiet(now.minute,s.quiet_start,s.quiet_end))return null;
  const rival=(await q(`SELECT o.*,c.id AS contact_id,c.name AS contact_name,c.title AS contact_title,c.temperament,c.agenda
   FROM external_organizations o JOIN contacts c ON c.organization_id=o.id AND c.user_id=o.user_id
   WHERE o.user_id=$1 AND o.world_id=$2 AND o.status='active' AND o.organization_type IN ('rival','competitor')
   ORDER BY o.last_move_at NULLS FIRST,o.competitive_pressure DESC LIMIT 1`,[userId,w.id]))[0];
  if(!rival)return null;
  const company=(await q('SELECT id,name,sector FROM companies WHERE user_id=$1 ORDER BY created_at LIMIT 1',[userId]))[0];
  await q('UPDATE worlds SET last_market_move_at=now() WHERE id=$1',[w.id]);
  return {world:w,settings:s,rival,company};
 });
 if(!reserved)return false;
 const {world,rival,company,settings}=reserved;
 const signals=await realWorldSignalSnapshot(userId);
 const raw=await ask(
  'Create one plausible fictional competitor market move. Return JSON only with moveType,title,description,impact,requiresAttention,callReason. Never use real-world claims, fake statistics, invented financial figures, or claim a deal was completed. Choose only from market-entry, product-launch, price-pressure, talent-competition, partnership, public-positioning, regulatory-response. A move must fit the rival agenda and the Chairman’s sector. Set requiresAttention only if a concrete Chairman decision or urgent response is needed. If no meaningful move is plausible, return empty title and description.',
  JSON.stringify({world:{name:world.name,region:world.region,sectors:world.sectors},rival:{name:rival.name,sector:rival.sector,strategy:rival.strategy,position:rival.market_position,reputation:rival.reputation,competitivePressure:rival.competitive_pressure,contact:rival.contact_name,temperament:rival.temperament,agenda:rival.agenda},company,realWorldSignals:signals}),
  {json:true,fallback:null}
 );
 if(!raw||typeof raw.title!=='string'||typeof raw.description!=='string'||!raw.title.trim()||!raw.description.trim())return false;
 const types=['market-entry','product-launch','price-pressure','talent-competition','partnership','public-positioning','regulatory-response'];
 const type=types.includes(raw.moveType)?raw.moveType:'public-positioning';
 const attention=raw.requiresAttention===true,reason=typeof raw.callReason==='string'?raw.callReason.trim().slice(0,180):'';
 await transaction(async q=>{
  const key='market-move:'+rival.id+':'+new Date().toISOString().slice(0,10);
  const prior=(await q('SELECT id FROM market_moves WHERE user_id=$1 AND operation_key=$2',[userId,key]))[0];if(prior)return;
  const move=(await q('INSERT INTO market_moves(id,user_id,world_id,organization_id,contact_id,company_id,move_type,title,description,impact,requires_attention,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',[uid(),userId,world.id,rival.id,rival.contact_id,company?.id||null,type,String(raw.title).trim().slice(0,160),String(raw.description).trim().slice(0,1800),String(raw.impact||'Monitor for relevance.').trim().slice(0,400),attention,key]))[0];
  await q('UPDATE external_organizations SET last_move_at=now(),competitive_pressure=least(100,greatest(0,competitive_pressure+CASE WHEN $2=\'price-pressure\' THEN 4 WHEN $2=\'talent-competition\' THEN 3 ELSE 1 END)) WHERE id=$1',[rival.id,type]);
  const thread=(await q(`INSERT INTO threads(id,user_id,world_id,company_id,contact_id,title,category,summary,priority)
   VALUES($1,$2,$3,$4,$5,$6,'competition',$7,$8) RETURNING id`,[uid(),userId,world.id,company?.id||null,rival.contact_id,move.title,move.description,attention?'high':'normal']))[0];
  await q('INSERT INTO events(id,user_id,world_id,thread_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),userId,world.id,thread.id,rival.contact_id,'competitor-move',move.title,move.description+' Impact assessment: '+move.impact]);
  if(attention&&reason){
   const count=(await q("SELECT count(*)::int n FROM invites WHERE user_id=$1 AND created_at>=now()-interval '24 hours'",[userId]))[0].n;
   if(count<settings.max_daily)await q('INSERT INTO invites(id,user_id,world_id,thread_id,contact_id,kind,subject,preview,due_at,schedule_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) ON CONFLICT(user_id,schedule_key) DO NOTHING',[uid(),userId,world.id,thread.id,rival.contact_id,'network','Incoming call · '+rival.contact_name,reason,key+':call']);
  }
 });
 return true;
}
