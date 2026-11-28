const ROLE_EXPERTISE=[
 [/chief of staff/i,['Executive coordination','Strategic planning','Stakeholder management','Crisis coordination','Calendar and communications']],
 [/group cfo|\bcfo\b/i,['Corporate finance','Treasury and liquidity','Financial planning and analysis','Capital allocation','Financial risk management']],
 [/chief operating officer|\bcoo\b/i,['Multi-company operations','Operational execution','Supply-chain management','Process improvement','Performance management']],
 [/general counsel|lawyer|legal/i,['Corporate law','Contract negotiation','Corporate governance','Regulatory compliance','Legal risk management']],
 [/group strategy director|strategy director/i,['Corporate strategy','Market entry','Mergers and acquisitions','Competitive intelligence','Growth planning']],
 [/board chair|chairman/i,['Board governance','Fiduciary oversight','Executive accountability','Shareholder interests','Strategic challenge']],
 [/human resources director|hr director/i,['People strategy','Talent acquisition','Employee relations','Workforce planning','Performance and compensation']],
 [/chief security officer|security officer/i,['Enterprise security','Cyber-risk management','Incident response','Physical security','Business continuity']],
 [/internal audit director|audit director/i,['Internal audit','Financial controls','Fraud risk','Forensic review','Compliance assurance']],
 [/chief commercial officer|commercial officer/i,['Commercial strategy','Sales leadership','Customer acquisition','Contract negotiation','Revenue growth']],
 [/private banker|banker/i,['Private banking','Corporate lending','Credit structuring','Treasury products','Wealth management']],
 [/managing partner/i,['Private equity','Capital raising','Deal structuring','Investment due diligence','Portfolio strategy']],
 [/general partner/i,['Venture capital','Growth equity','Investment diligence','Technology investments','Portfolio governance']],
 [/investigations editor|journalist|editor/i,['Investigative journalism','Source verification','Corporate accountability','Media relations','Public-interest reporting']],
 [/chief executive|founder and ceo|\bceo\b/i,['Corporate leadership','Business development','Competitive strategy','Market expansion','Strategic partnerships']],
 [/founder/i,['Venture building','Startup operations','Innovation strategy','Strategic partnerships','Early-stage growth']],
 [/market analyst|analyst/i,['Market research','Macroeconomic analysis','Competitive intelligence','Scenario planning','Investment research']],
 [/commissioner|regulator|director of autonomous vehicle safety regulation/i,['Regulatory policy','Compliance oversight','Regulatory enforcement','Public-sector governance','Risk assessment']],
 [/regional director/i,['Regional operations','Infrastructure delivery','Project management','Contract execution','Stakeholder coordination']],
 [/managing director/i,['Business management','Commercial negotiation','Supplier and customer relationships','Operational planning','Financial performance']]
];
const SECTOR_EXPERTISE=[
 [/technology|software|digital|autonomous|vehicle/i,['Technology strategy','Digital transformation','Product and engineering leadership','Technology risk']],
 [/industrial|manufactur|automation|infrastructure/i,['Industrial operations','Engineering delivery','Infrastructure projects','Operational resilience']],
 [/capital|venture|investment|bank/i,['Capital markets','Investment structuring','Financial analysis','Portfolio risk']],
 [/procurement|supply|logistic/i,['Strategic sourcing','Supplier management','Procurement negotiations','Logistics and cost control']],
 [/consumer|retail/i,['Consumer markets','Distribution strategy','Customer experience','Commercial procurement']],
 [/trade|authority|regulat/i,['Cross-border trade','Trade compliance','Public policy','Regulatory engagement']],
 [/media|ledger|journal/i,['Media strategy','Investigative research','Public communications','Reputation management']]
];
const unique=values=>[...new Set(values.map(x=>String(x||'').trim()).filter(Boolean))];
export function normaliseContactExpertise(existing,title='',company='',kind=''){
 let prior=Array.isArray(existing)?existing:[];
 if(typeof existing==='string'){try{const parsed=JSON.parse(existing);if(Array.isArray(parsed))prior=parsed;}catch{}}
 const role=String(title||''),sector=String(company||'');
 const roleSkills=ROLE_EXPERTISE.find(([pattern])=>pattern.test(role))?.[1]||[];
 const sectorSkills=SECTOR_EXPERTISE.find(([pattern])=>pattern.test(sector))?.[1]||[];
 const fallback=roleSkills.length?roleSkills:[String(title||'Professional specialism'),String(company||kind||'Business operations')];
 return unique([...roleSkills,...sectorSkills,...prior.filter(x=>!['',title,company].includes(String(x||''))),...fallback]).slice(0,8);
}
