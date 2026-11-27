export const NETWORK_CONTACT_KINDS=Object.freeze(['investor','banker','regulator','journalist','friend','adviser','partner','supplier','vendor','client','competitor','rival','former-employee']);
const clean=(value,max=500)=>typeof value==='string'?value.trim().replace(/\s+/g,' ').slice(0,max):'';
const normalize=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const timeValue=value=>{if(!value)return 0;const n=value instanceof Date?value.getTime():Date.parse(value);return Number.isFinite(n)?n:0;};
export function networkIntroductionDue({lastNetworkIntroAt,lastNetworkIntroAttemptAt,now=Date.now()}={}){
 const current=now instanceof Date?now.getTime():Number(now);
 const introduced=timeValue(lastNetworkIntroAt),attempted=timeValue(lastNetworkIntroAttemptAt);
 return !(introduced&&current-introduced<24*60*60*1000)&&!(attempted&&current-attempted<30*60*1000);
}
export function parseNetworkIntroduction(raw,context={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const decision=raw.decision==='introduce'?'introduce':raw.decision==='defer'?'defer':null;
 const reason=clean(raw.reason,600);
 if(!decision||reason.length<20)return null;
 const availableTriggers=[...(context.marketMoves||[]).map(m=>clean(m.title,180)),...(context.openThreads||[]).map(t=>clean(t.title,180))].filter(Boolean);
 const requestedTrigger=clean(raw.trigger,180);
 const trigger=normalize(requestedTrigger)==='portfolio network gap'?'portfolio network gap':availableTriggers.find(t=>normalize(t)===normalize(requestedTrigger))||availableTriggers[0]||'portfolio network gap';
 if(decision==='defer')return {decision,reason,trigger};
 const name=clean(raw.name,100),title=clean(raw.title,120),organization=clean(raw.organization,120);
 const kind=raw.kind==='advisor'?'adviser':clean(raw.kind,40);
 const rawSector=clean(raw.sector,80);
 const sectors=Array.isArray(context.sectors)?context.sectors.map(s=>clean(s,80)).filter(Boolean):[];
 const sector=sectors.find(s=>normalize(s)===normalize(rawSector))||clean(context.primarySector,80)||rawSector;
 const temperament=clean(raw.temperament,300),agenda=clean(raw.agenda,900),message=clean(raw.message,650);
 const organizationStrategy=clean(raw.organizationStrategy,800)||reason;
 if(!name||!title||!organization||!NETWORK_CONTACT_KINDS.includes(kind)||!sector||reason.length<30||temperament.length<10||agenda.length<20||message.length<35)return null;
 if((context.existingContacts||[]).some(c=>normalize(c.name)===normalize(name)))return null;
 const placeholder=/\[(?:chairman(?:['’]s)?\s+name|your\s+(?:full\s+)?name|name)\]/i.test(message);
 const chairmanSpeaking=/\bI(?:['’]m|\s+am)\s+(?:the\s+)?Chairman\b/i.test(message);
 const greeting=message.match(/^(?:hi|hello|dear|good\s+(?:morning|afternoon|evening))\s+([^,.!?]+)/i);
 const greetingTokens=normalize(greeting?.[1]||'').split(' ').filter(token=>token.length>2);
 const contactTokens=normalize(name).split(' ').filter(token=>token.length>2);
 const greetsSelf=!!greeting&&contactTokens.some(token=>greetingTokens.includes(token));
 const impersonatesPublicBody=/\b(?:European Commission|Directorate[- ]General for Mobility and Transport|European Parliament|United Nations|World Bank|NATO)\b/i.test(organization);
 if(placeholder||chairmanSpeaking||greetsSelf||impersonatesPublicBody)return null;
 if(/\b(referred by|introduced by|asked me to contact you|your chief of staff asked me)\b/i.test(message))return null;
 return {decision,reason,trigger,name,title,organization,organizationStrategy,kind,sector,temperament,agenda,message};
}
