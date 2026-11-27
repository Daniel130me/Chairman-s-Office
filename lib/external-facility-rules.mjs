import {cents,money} from './corporate-finance-rules.mjs';
import {EconomyError} from './economy-rules.mjs';
export function externalFacilityTerms(rows,companyIds,submitted){
 const fail=m=>{throw new EconomyError(m,409);};
 const ids=new Set(companyIds),terms=Array.isArray(submitted)?submitted:[];
 if(terms.length>50||terms.length!==rows.length)fail('External intercompany facilities require a confirmed agreement for every outstanding balance.');
 const results=[];
 for(const f of rows){
  if(f.transferred_at)fail('Settle previously externalized facilities before a further subsidiary transfer.');
  const matches=terms.filter(t=>t?.facilityId===f.id);
  const term=matches[0],evidence=typeof term?.evidence==='string'?term.evidence.trim().slice(0,1800):'';
  if(matches.length!==1||evidence.length<30||term.confirmed!==true||cents(term.outstanding)!==cents(f.outstanding))fail('External facility balance or transfer consent changed; refresh and confirm the written agreement.');
  const leavingLender=ids.has(f.lender_company_id);
  results.push({facilityId:f.id,outstanding:money(cents(f.outstanding)),activeCompanyId:leavingLender?f.borrower_company_id:f.lender_company_id,direction:leavingLender?'payable':'receivable',evidence});
 }
 return results.sort((a,b)=>a.facilityId.localeCompare(b.facilityId));
}
export function externalTermsMatch(saved,submitted){
 if(!Array.isArray(saved)||!Array.isArray(submitted)||saved.length!==submitted.length)return false;
 return saved.every(s=>submitted.filter(t=>t?.facilityId===s.facilityId&&t.confirmed===true&&String(t.evidence||'').trim().slice(0,1800)===s.evidence&&cents(t.outstanding)===cents(s.outstanding)).length===1);
}
