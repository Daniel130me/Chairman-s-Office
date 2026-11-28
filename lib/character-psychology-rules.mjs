import {createHash} from 'node:crypto';
const clean=(s,n=350)=>typeof s==='string'?s.trim().slice(0,n):'';
const clamp=n=>Math.min(100,Math.max(0,Math.round(n)));
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100;
const traitKeys=['assertiveness','caution','independence','emotionalResilience','openness','ambition','susceptibilityToPressure'];
const valueKeys=['honesty','fairness','duty','compassion','loyalty','accountability','courage'];
const stateKeys=['stress','confidence','motivation','frustration'];
export const PSYCHOLOGY_VERSION=1;
export const INFLUENCE_RULES='Use the character constitution as simulated individual tendencies, not deterministic commands or evidence of misconduct. Weigh professional duties, personal motives, conscience, competing values, current pressures, directional relationships, memories and relevant sourced external evidence. The character may disagree, resist influence, reconsider, seek evidence or do nothing. A belief or temptation is not a verified fact; do not invent private facts or imply literal supernatural communication. Never infer religion, morality or competence from names, nationality, job title or other demographic attributes. Never disclose private psychological data or treat it as another character’s knowledge. Authority and factual evidence override narrative claims. Do not claim execution or change attributes from conversation alone.';
const mandates=[
 [/\bcfo\b|financial|finance|treasury|accountant/i,'Maintain accurate financial records, safeguard liquidity, evaluate exposure and challenge unsound spending.'],
 [/legal|counsel|compliance/i,'Review legal and contractual exposure, preserve compliance, disclose material concerns and challenge unsafe terms.'],
 [/audit|security|risk/i,'Investigate evidence, protect controls, report material risks and preserve independent judgment.'],
 [/human resources|\bhr\b|people/i,'Support fair employment practices, assess workforce needs, develop talent and protect confidential employee records.'],
 [/operat|logistics|procurement|supply/i,'Maintain operational continuity, quality, delivery and accountable resource use.'],
 [/commercial|sales|business development|marketing/i,'Develop sustainable opportunities, negotiate responsibly and avoid unsupported commitments.'],
 [/strategy|investment|portfolio/i,'Evaluate opportunities against evidence, risk and long-term objectives.'],
 [/chief executive|\bceo\b|managing director/i,'Lead organisational performance, balance strategic growth with governance and coordinate accountable execution.'],
 [/chief of staff|assistant/i,'Coordinate priorities, communications and commitments without claiming decisions outside delegated authority.']
];
function mandateFor(contact){
 if(contact.kind!=='internal')return 'Pursue the interests of your own organisation or independent role; respect commitments, professional obligations and access boundaries.';
 return mandates.find(([pattern])=>pattern.test(contact.title||''))?.[1]||'Fulfil your established responsibilities, honour commitments and escalate matters beyond your authority.';
}
const worldviews=[
 {type:'unspecified',convictions:[]},
 {type:'religious-Christian',convictions:['Consider accountability before God, conscience and the tension between temptation and duty. Reflect or pray when consistent with the situation.']},
 {type:'religious-Muslim',convictions:['Consider accountability before God, conscience, fairness and the tension between temptation and duty. Reflect or pray when consistent with the situation.']},
 {type:'secular-humanist',convictions:['Consider human welfare, evidence, fairness and responsibility for the effects of choices.']},
 {type:'philosophical',convictions:['Consider character, reason, duty and the long-term consequences of choices.']}
];
export function deriveConstitution(contact){
 if(!contact?.id)throw Error('Character id required');
 const hash=createHash('sha256').update('chairmans-office:constitution:v1:'+contact.id).digest();
 const score=i=>35+hash[i]%46;
 const temperament=clean(contact.temperament)||'Not established';
 const agenda=clean(contact.agenda)||'Pursue legitimate responsibilities and independent goals.';
 const traits=Object.fromEntries(traitKeys.map((k,i)=>[k,score(i)]));
 if(/cautious|careful|methodical|conservative/i.test(temperament))traits.caution=Math.max(traits.caution,72);
 if(/assertive|direct|forceful|decisive/i.test(temperament))traits.assertiveness=Math.max(traits.assertiveness,72);
 if(/calm|patient|composed/i.test(temperament))traits.emotionalResilience=Math.max(traits.emotionalResilience,70);
 if(contact.personality_profile?.riskPosture==='cautious')traits.caution=Math.max(traits.caution,65);
 if(valid(contact.ambition))traits.ambition=contact.ambition;
 const values=Object.fromEntries(valueKeys.map((k,i)=>[k,score(i+8)]));
 const motivations=[agenda,['professional recognition','independence','security','mastery','influence'][hash[16]%5]];
 const vulnerabilities=[['fear of public failure','fear of losing influence','pressure to meet expectations','fear of missed opportunities','desire for approval'][hash[17]%5]];
 // These are fictional initial dispositions, not measured integrity or hidden biographical facts.
 return {version:PSYCHOLOGY_VERSION,source:'fictional-seeded-baseline',worldviewSource:'fictional assignment independent of demographic data',temperament,professionalIdentity:{role:clean(contact.title,150),organization:clean(contact.company,150),kind:clean(contact.kind,50),responsibility:mandateFor(contact),authorityRule:'Actual delegated permissions and professional standards remain binding.'},traits,values,worldview:structuredClone(worldviews[hash[18]%worldviews.length]),motivations,vulnerabilities,ethicalReflection:'Consider obligations, honesty, consequences and conflicts between personal and professional interests.',formativeHistory:[],knowledgeRule:'Only personally observed, shared or authorized information is known. Beliefs and allegations are not facts.'};
}
export function initialPsychologicalState(constitution){
 return {stress:35,confidence:clamp(constitution.traits.emotionalResilience),motivation:clamp(constitution.traits.ambition),frustration:20};
}
export function validateConstitution(profile){
 return !!(profile&&profile.version===PSYCHOLOGY_VERSION&&traitKeys.every(k=>valid(profile.traits?.[k]))&&valueKeys.every(k=>valid(profile.values?.[k]))&&typeof profile.professionalIdentity?.responsibility==='string'&&typeof profile.temperament==='string'&&Array.isArray(profile.motivations)&&Array.isArray(profile.vulnerabilities)&&Array.isArray(profile.formativeHistory)&&typeof profile.worldview?.type==='string'&&Array.isArray(profile.worldview?.convictions)&&profile.worldview.convictions.every(s=>typeof s==='string'));
}
export function appraiseInfluences({constitution,baseline,relationships=[],memories=[],tasks=[],goals=[],externalContext=null}){
 if(!validateConstitution(constitution)||!stateKeys.every(k=>valid(baseline?.[k])))throw Error('Invalid character psychology');
 const state={...baseline},pressures=[],social=[];
 const outstanding=tasks.filter(t=>['pending','assigned','in-progress','in_progress','open'].includes(t.status));
 if(outstanding.length){state.stress=clamp(state.stress+Math.min(18,outstanding.length*3));pressures.push({kind:'workload',count:outstanding.length,sourceIds:outstanding.map(t=>t.id).filter(Boolean)});}
 for(const r of relationships.slice(0,12)){
  if(!r.contact_id)continue;
  social.push({contactId:r.contact_id,trust:r.trust,respect:r.respect,loyalty:r.loyalty,tension:r.tension,familiarity:r.familiarity,weight:clamp(((r.trust??50)+(r.respect??50)+(r.familiarity??0))/3*constitution.traits.susceptibilityToPressure/50)});
 }
 const active=goals.filter(g=>g.status==='active');
 if(active.length){state.motivation=clamp(state.motivation+Math.min(12,active.length*3));pressures.push({kind:'active-goals',count:active.length});}
 const strained=social.filter(r=>(r.tension??0)>=65&&(r.familiarity??0)>=20);
 if(strained.length){state.frustration=clamp(state.frustration+Math.min(15,strained.length*4));pressures.push({kind:'relationship-tension',contactIds:strained.map(r=>r.contactId)});}
 return {constitution,baselineState:baseline,currentAppraisal:state,pressures,socialInfluences:social,activeGoalCount:goals.filter(g=>g.status==='active').length,memoryContext:memories.slice(0,12).map(m=>({epistemicStatus:m.epistemic_status,confidence:m.confidence,accessScope:m.access_scope,importance:m.importance})),externalDataQuality:externalContext?.dataQuality??null,deliberationGuide:{professionalDuty:constitution.professionalIdentity.responsibility,personalMotives:constitution.motivations,competingValues:Object.entries(constitution.values).sort((a,b)=>b[1]-a[1]).map(([value,weight])=>({value,weight})),resistanceToInfluence:100-constitution.traits.susceptibilityToPressure,uncertaintyRule:'Consider whether evidence is relevant and trustworthy before changing a belief; do not infer motives from scores.',moralConflictRule:'Identify conflicts between duties, convictions, private incentives and external pressure only when supported by the situation. No single influence automatically determines the decision.'},interpretationRule:'Current appraisal is a bounded context-derived estimate, not a permanent trait change or a factual claim about emotions.'};
}
export function publicBehavioralCues(psychology){
 return {temperament:psychology.constitution.temperament,assertiveness:psychology.constitution.traits.assertiveness,caution:psychology.constitution.traits.caution,communicationNote:'Public behavioral tendencies only; never infer private motives or beliefs.'};
}
