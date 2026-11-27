import {pathToFileURL} from 'node:url';
import {sql,database} from '../backend/src/db.mjs';
// Read-only, aggregate diagnostics. Never print user IDs, messages or credentials.
// Run against a backed-up or isolated database before a deployment.
export async function reconcileWorlds(){
 const checks=[
 ['company cash vs ledger',`SELECT count(*)::int AS n FROM companies c JOIN company_economy e ON e.company_id=c.id AND e.user_id=c.user_id
 LEFT JOIN LATERAL (SELECT coalesce(sum(CASE WHEN debit='cash' THEN amount WHEN credit='cash' THEN -amount ELSE 0 END),0) AS balance FROM economy_journal j WHERE j.company_id=c.id AND j.user_id=c.user_id) j ON true WHERE c.cash<>j.balance`],
 ['inventory carrying values vs ledger',`SELECT count(*)::int AS n FROM company_economy e LEFT JOIN LATERAL (SELECT coalesce(sum(stock_value),0) AS value FROM inventory_items i WHERE i.company_id=e.company_id AND i.user_id=e.user_id) i ON true LEFT JOIN LATERAL (SELECT coalesce(sum(CASE WHEN debit='inventory' THEN amount WHEN credit='inventory' THEN -amount ELSE 0 END),0) AS value FROM economy_journal j WHERE j.company_id=e.company_id AND j.user_id=e.user_id) j ON true WHERE i.value<>j.value`],
 ['invalid purchase settlement',`SELECT count(*)::int AS n FROM purchase_orders WHERE credited_total+paid_total>received_total OR returned_total>paid_total OR received_total>total OR (status='paid' AND credited_total+paid_total<>received_total)`],
 ['supplier return reconciliation',`SELECT count(*)::int AS n FROM purchase_orders p LEFT JOIN LATERAL (SELECT coalesce(sum(r.credit_value),0) AS credit,coalesce(sum(r.settlement_value-r.credit_value),0) AS cash FROM inventory_returns r JOIN purchase_order_lines l ON l.id=r.purchase_order_line_id AND l.user_id=r.user_id WHERE l.purchase_order_id=p.id AND r.user_id=p.user_id AND r.kind='supplier') r ON true WHERE p.credited_total<>r.credit OR p.returned_total<>r.cash`],
 ['over-returned supplier lines',`SELECT count(*)::int AS n FROM purchase_order_lines l WHERE (SELECT coalesce(sum(quantity),0) FROM inventory_returns r WHERE r.purchase_order_line_id=l.id AND r.user_id=l.user_id)>l.received_quantity`],
 ['over-returned customer sales',`SELECT count(*)::int AS n FROM procurement_transactions s WHERE s.kind='stock-sale' AND (SELECT coalesce(sum(quantity),0) FROM inventory_returns r WHERE r.sale_id=s.id AND r.user_id=s.user_id)>(s.payload->>'quantity')::numeric`],
 ['invalid closed financing',`SELECT count(*)::int AS n FROM company_loans WHERE status='closed' AND outstanding_principal<>0`],
 ['replacement booking mismatch',`SELECT count(*)::int AS n FROM travel_rebookings r LEFT JOIN travel_bookings b ON b.id=r.new_booking_id AND b.user_id=r.user_id WHERE r.status='approved' AND (b.id IS NULL OR b.amount<>r.amount OR b.provider<>r.provider)`],
 ['duplicate effective provider review',`SELECT count(*)::int AS n FROM (SELECT booking_id FROM travel_provider_reviews GROUP BY booking_id HAVING count(*)>1) q`],
 ['settlement credits mismatch',`SELECT count(*)::int AS n FROM business_invoices WHERE settlement_paid IS NOT NULL AND (settlement_credit IS NULL OR settlement_paid+settlement_credit<>amount)`],
 ['installment agreement totals',`SELECT count(*)::int AS n FROM dispute_payment_plans p JOIN business_invoices b ON b.id=p.invoice_id AND b.user_id=p.user_id LEFT JOIN LATERAL (SELECT coalesce(sum(amount),0) total,coalesce(sum(amount) FILTER(WHERE paid_at IS NOT NULL),0) paid FROM dispute_payment_installments i WHERE i.plan_id=p.id AND i.user_id=p.user_id) i ON true WHERE i.total<>p.agreed_amount OR p.agreed_amount+p.agreed_credit<>b.amount OR (p.status='completed' AND (i.paid<>p.agreed_amount OR b.settlement_paid IS DISTINCT FROM p.agreed_amount OR b.settlement_credit IS DISTINCT FROM p.agreed_credit))`],
 ['controlled ownership mismatch',`SELECT count(*)::int AS n FROM company_investments h JOIN companies c ON c.id=h.target_company_id AND c.user_id=h.user_id WHERE h.status='active' AND (c.parent_company_id IS DISTINCT FROM h.investor_company_id OR c.ownership_percentage<>h.ownership_percentage)`],
 ['acquired intangible reconciliation',`SELECT count(*)::int AS n FROM acquisition_allocations a JOIN company_acquisitions d ON d.id=a.acquisition_id AND d.user_id=a.user_id LEFT JOIN LATERAL (SELECT coalesce(sum(amount),0) charged FROM acquisition_intangible_adjustments x WHERE x.user_id=a.user_id AND x.allocation_id=a.id) x ON true LEFT JOIN LATERAL (SELECT coalesce(sum(CASE WHEN debit='intangible_assets' THEN amount WHEN credit='intangible_assets' THEN -amount ELSE 0 END),0) balance FROM economy_journal j WHERE j.user_id=a.user_id AND j.company_id=d.target_company_id) j ON true WHERE d.status='completed' AND (x.charged>a.acquired_intangibles OR j.balance<>a.acquired_intangibles-x.charged)`],
 ['acquired payable reconciliation',`SELECT count(*)::int AS n FROM acquisition_allocations a JOIN company_acquisitions d ON d.id=a.acquisition_id AND d.user_id=a.user_id LEFT JOIN LATERAL (SELECT coalesce(sum(amount),0) paid FROM acquisition_payable_payments p WHERE p.user_id=a.user_id AND p.allocation_id=a.id) p ON true LEFT JOIN LATERAL (SELECT coalesce(sum(CASE WHEN credit='acquired_payables' THEN amount WHEN debit='acquired_payables' THEN -amount ELSE 0 END),0) balance FROM economy_journal j WHERE j.user_id=a.user_id AND j.company_id=d.target_company_id) j ON true WHERE d.status='completed' AND (p.paid>a.acquired_payables OR j.balance<>a.acquired_payables-p.paid)`],
 ['disposed subsidiary archive integrity',`SELECT count(*)::int AS n FROM subsidiary_disposals d JOIN companies c ON c.id=d.subsidiary_id AND c.user_id=d.user_id JOIN company_investments h ON h.id=d.investment_id AND h.user_id=d.user_id WHERE c.disposed_at IS NULL OR c.parent_company_id IS NOT NULL OR h.target_company_id IS NOT NULL OR (d.closing_statement->>'balanceCheck')::numeric<>0 OR d.group_gain<>d.proceeds+d.retained_value+d.minority_interest-d.net_assets-d.goodwill OR d.parent_gain<>d.proceeds+d.retained_value-d.previous_carrying`],
 ['post-disposal journal writes',`SELECT count(*)::int AS n FROM economy_journal j JOIN companies c ON c.id=j.company_id AND c.user_id=j.user_id WHERE c.disposed_at IS NOT NULL AND j.created_at>c.disposed_at`],
 ['journal cross-tenant ownership',`SELECT count(*)::int AS n FROM economy_journal j JOIN companies c ON c.id=j.company_id WHERE j.user_id<>c.user_id`],
 ['call cross-tenant ownership',`SELECT count(*)::int AS n FROM calls c JOIN contacts p ON p.id=c.contact_id WHERE c.user_id<>p.user_id`]
 ];
 const results=[];
 for(const [name,query] of checks){const [r]=await sql(query);results.push({name,violations:r.n});}
 return results;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const results=await reconcileWorlds();console.table(results);if(results.some(r=>r.violations>0))process.exitCode=1;}
 catch(e){console.error('Reconciliation failed:',e.code||e.name);process.exitCode=1;}
 finally{await database().end();}
}
