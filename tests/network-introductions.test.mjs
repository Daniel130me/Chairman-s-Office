import test from 'node:test';import assert from 'node:assert/strict';import {processNetworkIntroductions,persistNetworkIntroduction} from '../lib/network-introductions.mjs';
test('dynamic network introduction workflow and atomic persistence entrypoint are loadable',()=>{assert.equal(typeof processNetworkIntroductions,'function');assert.equal(typeof persistNetworkIntroduction,'function');});

test('network introduction persistence creates the contact, message, timeline event and memory job atomically',async()=>{
 const calls=[];
 const q=async(query,params=[])=>{
  calls.push({query,params});
  if(query.startsWith('SELECT contact_id,organization_id FROM network_introductions'))return [];
  if(query.startsWith('SELECT id FROM contacts WHERE user_id=$1 AND world_id=$2 AND lower(name)'))return [];
  if(query.startsWith('SELECT id,name,sector FROM external_organizations'))return [];
  if(query.startsWith('INSERT INTO external_organizations'))return [{id:params[0],name:params[3],sector:params[4]}];
  if(query.startsWith('SELECT id FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind=')&&query.includes('title=$3'))return [{id:'internal-liaison'}];
  if(query.startsWith('SELECT id FROM contacts WHERE id=$1'))return [{id:params[0]}];
  if(query.startsWith('INSERT INTO character_memory_jobs'))return [{id:'memory-job'}];
  return [];
 };
 const decision={name:'Mara Eze',title:'Managing Director',organization:'Northstar Logistics Group',organizationStrategy:'Expand enterprise logistics partnerships.',kind:'partner',sector:'logistics',temperament:'Direct, thoughtful and commercially pragmatic.',agenda:'Build a long-term logistics partnership.',message:'Good afternoon Chairman. I lead Northstar Logistics Group. Your expansion activity suggests there may be a useful conversation about regional logistics.',reason:'The group has an active expansion opportunity but no independent logistics partner in this market.',trigger:'Portfolio network gap'};
 const result=await persistNetworkIntroduction(q,{userId:'user-1',worldId:'world-1',company:{id:'company-1'},decision,context:{},operationKey:'network-intro:world-1:2026-11-27'});
 assert.equal(result.introduced,true);
 assert.ok(result.contactId);
 for(const prefix of ['INSERT INTO external_organizations','INSERT INTO contacts','INSERT INTO threads','INSERT INTO messages','INSERT INTO events','INSERT INTO character_relationships','INSERT INTO character_memory_jobs','INSERT INTO network_introductions','UPDATE worlds'])assert.ok(calls.some(x=>x.query.startsWith(prefix)),prefix);
});
test('network introduction persistence is idempotent for the same operation key',async()=>{
 let calls=0;
 const q=async(query)=>{calls++;if(query.startsWith('SELECT contact_id,organization_id FROM network_introductions'))return [{contact_id:'existing-contact',organization_id:'existing-organization'}];return [];};
 const result=await persistNetworkIntroduction(q,{userId:'user-1',worldId:'world-1',company:{id:'company-1'},decision:{},context:{},operationKey:'network-intro:world-1:2026-11-27'});
 assert.deepEqual(result,{introduced:true,contactId:'existing-contact',organizationId:'existing-organization'});
 assert.equal(calls,1);
});
