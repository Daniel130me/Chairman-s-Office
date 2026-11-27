import {createHash} from 'node:crypto';
import {EconomyError} from './economy-rules.mjs';
const fail=m=>{throw new EconomyError(m,409);};
export const transferableLabels=new Set(['active employees','open contracts','unsettled invoices','open purchase orders']);
export async function operatingTransferReview(q,userId,ids){
 const rows=await q(`SELECT * FROM (
  SELECT 'employment' kind,e.id,e.company_id,c.name label,to_jsonb(e) record,
   jsonb_build_object('terms',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.effective_on,t.id),'[]') FROM employment_terms t WHERE t.user_id=e.user_id AND t.employment_id=e.id),'name',c.name,'jobTitle',e.job_title) details
  FROM employment_records e JOIN contacts c ON c.id=e.contact_id AND c.user_id=e.user_id WHERE e.user_id=$1 AND e.company_id=ANY($2::uuid[]) AND e.status='active'
  UNION ALL SELECT 'contract',c.id,c.company_id,c.title,to_jsonb(c),
   jsonb_build_object('counterparty',c.counterparty,'obligations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM contract_obligations o WHERE o.user_id=c.user_id AND o.contract_id=c.id))
  FROM business_contracts c WHERE c.user_id=$1 AND c.company_id=ANY($2::uuid[]) AND c.status IN ('draft','active')
  UNION ALL SELECT 'invoice',i.id,i.company_id,i.invoice_number,to_jsonb(i),jsonb_build_object('customer',i.customer_name,'amount',i.amount)
  FROM business_invoices i WHERE i.user_id=$1 AND i.company_id=ANY($2::uuid[]) AND i.status='issued'
  UNION ALL SELECT 'purchase-order',p.id,p.company_id,p.po_number,to_jsonb(p),
   jsonb_build_object('vendor',p.vendor_name,'lines',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM purchase_order_lines l WHERE l.user_id=p.user_id AND l.purchase_order_id=p.id),'negotiations',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id),'[]') FROM supplier_negotiations n WHERE n.user_id=p.user_id AND n.purchase_order_id=p.id))
  FROM purchase_orders p WHERE p.user_id=$1 AND p.company_id=ANY($2::uuid[]) AND p.status IN ('draft','approved','received')
 ) x ORDER BY kind,id LIMIT 201`,[userId,ids]);
 if(rows.length>200)fail('Review a smaller disposal perimeter; at most 200 operating records can be transferred in one transaction.');
 const blockers=[];
 const checks=[
 ['disputed contracts',`SELECT count(*)::int n FROM business_contracts WHERE user_id=$1 AND company_id=ANY($2::uuid[]) AND status='disputed'`],
 ['open commercial disputes',`SELECT count(*)::int n FROM commercial_disputes d JOIN business_contracts c ON c.id=d.contract_id AND c.user_id=d.user_id WHERE d.user_id=$1 AND c.company_id=ANY($2::uuid[]) AND d.status='open'`],
 ['active dispute settlement plans',`SELECT count(*)::int n FROM dispute_payment_plans p JOIN business_invoices i ON i.id=p.invoice_id AND i.user_id=p.user_id WHERE p.user_id=$1 AND i.company_id=ANY($2::uuid[]) AND p.status='active'`],
 ['open competitive supplier requests',`SELECT count(*)::int n FROM supplier_rfqs f JOIN purchase_orders p ON p.id=f.purchase_order_id AND p.user_id=f.user_id WHERE f.user_id=$1 AND p.company_id=ANY($2::uuid[]) AND f.status='open'`],
 ['employee assignments outside the sale perimeter',`SELECT count(*)::int n FROM business_tasks t JOIN employment_records e ON e.contact_id=t.assignee_id AND e.user_id=t.user_id WHERE e.user_id=$1 AND e.company_id=ANY($2::uuid[]) AND e.status='active' AND t.status='assigned' AND (t.company_id IS NULL OR NOT(t.company_id=ANY($2::uuid[])))`]
 ];
 for(const [label,query] of checks){const [r]=await q(query,[userId,ids]);if(r.n)blockers.push({label,count:r.n});}
 return {rows,blockers,digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
}
export function confirmedOperatingTransfer(review,submitted){
 if(!review.rows.length){if(submitted&&submitted.confirmed===true)fail('Operating records changed. Refresh the pre-sale review.');return null;}
 const evidence=typeof submitted?.evidence==='string'?submitted.evidence.trim().slice(0,3000):'';
 if(submitted?.confirmed!==true||submitted.digest!==review.digest||evidence.length<30)fail('Confirm the exact operating obligations review and provide written buyer/counterparty and employee assumption evidence.');
 return {digest:review.digest,evidence,records:review.rows};
}
export function operatingTransferMatches(saved,submitted){
 if(!saved)return !submitted||submitted.confirmed!==true;
 return submitted?.confirmed===true&&submitted.digest===saved.digest&&String(submitted.evidence||'').trim().slice(0,3000)===saved.evidence;
}
export async function transferEmployeeContacts(q,userId,ids,buyer){
 // Employment itself continues with the sold legal entity. Only its relationship
 // to this Chairman changes. Never falsely record a dismissal or final payroll.
 await q(`UPDATE contacts c SET kind='external',relationship='employee of former subsidiary',title=e.job_title,agenda='Continue responsibilities in the former subsidiary under its new owner; maintain independent professional relationships.'
 FROM employment_records e WHERE e.user_id=$1 AND e.company_id=ANY($2::uuid[]) AND e.status='active' AND c.id=e.contact_id AND c.user_id=e.user_id`,[userId,ids]);
}
