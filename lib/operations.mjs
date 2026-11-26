import {sql,one,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
import {recordSystemExpense,recordSystemSale,recordSystemInvoice,recordSystemInvoicePayment,recordSystemPayroll,recordSystemPurchase,recordSystemSupplierPayment,recordSystemLoanDraw,recordSystemLoanPayment,recordSystemInterestPayment,recordSystemInvestmentPurchase,recordSystemInvestmentSale} from './economy.mjs';
import {canTransitionContract,validPayrollMonth} from './operations-rules.mjs';
function clean(value,max=240){return String(value??'').trim().slice(0,max);}
export async function worldCompany(q,userId,companyId){
 const c=(await q('SELECT c.*,w.id AS world_id FROM companies c JOIN worlds w ON w.id=c.world_id AND w.user_id=c.user_id WHERE c.id=$1 AND c.user_id=$2 FOR UPDATE',[companyId,userId]))[0];
 if(!c)throw new EconomyError('Company unavailable.',404);
 return c;
}
async function audit(q,userId,worldId,actorName,action,entityType,entityId,beforeState,afterState,reason){
 await q('INSERT INTO world_audit_log(id,user_id,world_id,actor_type,actor_name,action,entity_type,entity_id,before_state,after_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[uid(),userId,worldId,'chairman',actorName,action,entityType,entityId,beforeState?JSON.stringify(beforeState):null,afterState?JSON.stringify(afterState):null,reason||null]);
}
export async function createInvoice(user,body){
 const key='invoice:'+operationKey(body.operationKey),customer=clean(body.customer,120),description=clean(body.description,500),amount=amountString(body.amount);
 if(!customer||!description)throw new EconomyError('Enter the customer and invoice description.');
 const due=body.dueAt?new Date(body.dueAt):new Date(Date.now()+30*86400000);
 if(!Number.isFinite(due.getTime())||due.getTime()<Date.now()-86400000)throw new EconomyError('Choose a valid invoice due date.');
 return transaction(async q=>{
  const c=await worldCompany(q,user.id,body.companyId);
  const prior=(await q('SELECT * FROM business_invoices WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];
  if(prior){if(prior.company_id!==c.id||prior.customer_name!==customer||prior.description!==description||prior.amount!==amount)throw new EconomyError('Operation reference already used.',409);await recordSystemInvoice(q,c,'invoice:'+prior.id,prior.amount,'Invoice '+prior.invoice_number+' issued to '+prior.customer_name,'Accounts receivable');if(prior.status==='paid')await recordSystemInvoicePayment(q,c,'invoice:'+prior.id+':payment',prior.amount,'Payment received for '+prior.invoice_number+' from '+prior.customer_name,'Accounts receivable');return prior;}
  const count=(await q('SELECT count(*)::int n FROM business_invoices WHERE user_id=$1 AND company_id=$2',[user.id,c.id]))[0].n+1;
  const number='INV-'+new Date().getUTCFullYear()+'-'+String(count).padStart(5,'0');
  const duplicate=(await q("SELECT id FROM business_invoices WHERE user_id=$1 AND company_id=$2 AND lower(customer_name)=lower($3) AND amount=$4::numeric AND issued_at>=now()-interval '30 days' LIMIT 1",[user.id,c.id,customer,amount]))[0];
  const unusuallyLarge=Number(c.cash)>0&&Number(amount)>Number(c.cash)*0.1;
  const risk=duplicate?'high':unusuallyLarge?'review':'none';
  const riskReason=duplicate?'Repeated invoice to the same customer for the same amount within 30 days; verify supporting documents.':unusuallyLarge?'Invoice exceeds 10% of the company cash balance at issue; verify approval and supporting documents.':null;
  const row=(await q('INSERT INTO business_invoices(id,user_id,world_id,company_id,invoice_number,customer_name,description,amount,due_at,operation_key,risk_level,risk_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',[uid(),user.id,c.world_id,c.id,number,customer,description,amount,due.toISOString(),key,risk,riskReason]))[0];
  await recordSystemInvoice(q,c,'invoice:'+row.id,amount,'Invoice '+number+' issued to '+customer,'Accounts receivable');
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,c.world_id,'invoice-issued',number+' issued',customer+' · USD '+amount+' · '+description]);
  await audit(q,user.id,c.world_id,'Chairman','invoice.issued','invoice',row.id,null,row,'Invoice issued; no payment has been received.');
  if(risk!=='none'){
   const caseId=uid();
   await q('INSERT INTO investigation_cases(id,user_id,world_id,company_id,source_invoice_id,title,allegation,severity,opened_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[caseId,user.id,c.world_id,c.id,row.id,'Invoice verification · '+number,'Automated control flagged a pattern for verification. This is not a finding of fraud or misconduct.',risk==='high'?'high':'moderate','Automated controls']);
   await q('INSERT INTO investigation_evidence(id,user_id,case_id,evidence_type,description,source_reference,confidence,collected_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),user.id,caseId,'invoice-record',riskReason,row.id,0.5,'Automated controls']);
   await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,c.world_id,'investigation-opened','Invoice requires verification · '+number,riskReason+' No conclusion has been reached.']);
  }
  return row;
 });
}
export async function payInvoice(user,id){
 return transaction(async q=>{
  const row=(await q('SELECT * FROM business_invoices WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]))[0];
  if(!row)throw new EconomyError('Invoice unavailable.',404);
  if(row.status==='paid')return row;
  if(row.status!=='issued')throw new EconomyError('Only issued invoices can be paid.',409);
  const c=await worldCompany(q,user.id,row.company_id);
  await recordSystemInvoicePayment(q,c,'invoice:'+row.id+':payment',row.amount,'Payment received for '+row.invoice_number+' from '+row.customer_name,'Accounts receivable');
  const paid=(await q("UPDATE business_invoices SET status='paid',paid_at=now() WHERE id=$1 AND user_id=$2 RETURNING *",[id,user.id]))[0];
  await audit(q,user.id,row.world_id,'Accounts Receivable','invoice.paid','invoice',row.id,row,paid,'Fictional payment recorded in company ledger.');
  return paid;
 });
}
export async function createContract(user,body){
 const key='contract:'+operationKey(body.operationKey),title=clean(body.title,160),counterparty=clean(body.counterparty,140),type=clean(body.type,60)||'commercial',terms=clean(body.terms,4000),value=amountString(body.value);
 if(!title||!counterparty||!terms)throw new EconomyError('Enter a title, counterparty and terms.');
 return transaction(async q=>{
  const c=await worldCompany(q,user.id,body.companyId);
  const prior=(await q('SELECT * FROM business_contracts WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];
  if(prior){if(prior.company_id!==c.id||prior.title!==title||prior.counterparty!==counterparty||prior.terms!==terms||prior.value!==value)throw new EconomyError('Operation reference already used.',409);return prior;}
  const row=(await q('INSERT INTO business_contracts(id,user_id,world_id,company_id,title,counterparty,contract_type,value,terms,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[uid(),user.id,c.world_id,c.id,title,counterparty,type,value,terms,key]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,c.world_id,'contract-drafted',title,counterparty+' · USD '+value+' · Awaiting review and approval.']);
  await audit(q,user.id,c.world_id,'Chairman','contract.drafted','contract',row.id,null,row,'Draft only; no obligation or payment has been created.');
  return row;
 });
}
export async function transitionContract(user,id,body){
 const status=clean(body.status,20),reason=clean(body.reason,500);
 return transaction(async q=>{
  const old=(await q('SELECT * FROM business_contracts WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]))[0];
  if(!old)throw new EconomyError('Contract unavailable.',404);
  if(old.status===status)return old;
  if(!canTransitionContract(old.status,status))throw new EconomyError('That contract transition is not permitted.',409);
  if(!reason)throw new EconomyError('Record the reason for this contract decision.');
  const row=(await q('UPDATE business_contracts SET status=$1,updated_at=now() WHERE id=$2 AND user_id=$3 RETURNING *',[status,id,user.id]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,old.world_id,'contract-'+status,old.title,status+' with '+old.counterparty+'. '+reason]);
  await audit(q,user.id,old.world_id,'Chairman','contract.'+status,'contract',id,old,row,reason);
  return row;
 });
}
export async function runPayroll(user,body){
 const period=clean(body.periodMonth,7);
 if(!validPayrollMonth(period))throw new EconomyError('Choose a valid payroll month.');
 return transaction(async q=>{
  const c=await worldCompany(q,user.id,body.companyId);
  const prior=(await q('SELECT * FROM payroll_runs WHERE user_id=$1 AND company_id=$2 AND period_month=$3 FOR UPDATE',[user.id,c.id,period]))[0];
  if(prior)return prior;
  const staff=await q("SELECT e.id,e.annual_salary,p.name,e.job_title FROM employment_records e JOIN contacts p ON p.id=e.contact_id AND p.user_id=e.user_id WHERE e.user_id=$1 AND e.company_id=$2 AND e.status='active' ORDER BY p.name",[user.id,c.id]);
  if(!staff.length)throw new EconomyError('There are no active employment records for this company.',409);
  const total=(await q("SELECT sum(round(annual_salary/12,2))::numeric(20,2)::text total FROM employment_records WHERE user_id=$1 AND company_id=$2 AND status='active'",[user.id,c.id]))[0].total;
  const amount=amountString(total);
  await recordSystemPayroll(q,c,'payroll:'+c.id+':'+period,amount,'Monthly payroll for '+period+' ('+staff.length+' employees)','Payroll');
  const run=(await q("INSERT INTO payroll_runs(id,user_id,world_id,company_id,period_month,total,employee_count,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[uid(),user.id,c.world_id,c.id,period,amount,staff.length,'payroll:'+c.id+':'+period]))[0];
  for(const person of staff)await q('INSERT INTO payroll_items(id,user_id,payroll_run_id,employment_id,employee_name,job_title,gross_pay) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,run.id,person.id,person.name,person.job_title,(Math.round(Number(person.annual_salary)/12*100)/100).toFixed(2)]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,c.world_id,'payroll-paid','Payroll completed · '+period,staff.length+' employees · USD '+amount]);
  await audit(q,user.id,c.world_id,'Chairman','payroll.paid','payroll',run.id,null,run,'Fictional salary payment recorded in company ledger.');
  return run;
 });
}
export async function operationsSnapshot(userId){
 const [invoices,contracts,payroll,auditLog,investigations,evidence,purchaseOrders,inventory,inventoryMovements,loans,loanPayments,acquisitions,investments]=await Promise.all([
  sql('SELECT i.*,c.name AS company_name FROM business_invoices i JOIN companies c ON c.id=i.company_id AND c.user_id=i.user_id WHERE i.user_id=$1 ORDER BY i.issued_at DESC LIMIT 100',[userId]),
  sql('SELECT k.*,c.name AS company_name FROM business_contracts k JOIN companies c ON c.id=k.company_id AND c.user_id=k.user_id WHERE k.user_id=$1 ORDER BY k.created_at DESC LIMIT 100',[userId]),
  sql('SELECT p.*,c.name AS company_name FROM payroll_runs p JOIN companies c ON c.id=p.company_id AND c.user_id=p.user_id WHERE p.user_id=$1 ORDER BY p.paid_at DESC LIMIT 50',[userId]),
  sql('SELECT * FROM world_audit_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]),
  sql('SELECT i.*,c.name AS company_name FROM investigation_cases i LEFT JOIN companies c ON c.id=i.company_id AND c.user_id=i.user_id WHERE i.user_id=$1 ORDER BY i.opened_at DESC LIMIT 100',[userId]),
  sql('SELECT e.* FROM investigation_evidence e WHERE e.user_id=$1 ORDER BY e.created_at DESC LIMIT 300',[userId]),
  sql('SELECT p.*,c.name AS company_name FROM purchase_orders p JOIN companies c ON c.id=p.company_id AND c.user_id=p.user_id WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 100',[userId]),
  sql('SELECT i.*,c.name AS company_name FROM inventory_items i JOIN companies c ON c.id=i.company_id AND c.user_id=i.user_id WHERE i.user_id=$1 ORDER BY i.name',[userId]),
  sql('SELECT m.*,i.name AS item_name,c.name AS company_name FROM inventory_movements m JOIN inventory_items i ON i.id=m.inventory_item_id AND i.user_id=m.user_id JOIN companies c ON c.id=m.company_id AND c.user_id=m.user_id WHERE m.user_id=$1 ORDER BY m.created_at DESC LIMIT 200',[userId]),
  sql('SELECT l.*,c.name AS company_name FROM company_loans l JOIN companies c ON c.id=l.company_id AND c.user_id=l.user_id WHERE l.user_id=$1 ORDER BY l.created_at DESC',[userId]),
  sql('SELECT p.* FROM company_loan_payments p WHERE p.user_id=$1 ORDER BY p.paid_at DESC LIMIT 100',[userId]),
  sql('SELECT a.*,c.name AS buyer_name FROM company_acquisitions a JOIN companies c ON c.id=a.buyer_company_id AND c.user_id=a.user_id WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 100',[userId]),
  sql('SELECT i.*,c.name AS investor_name FROM company_investments i JOIN companies c ON c.id=i.investor_company_id AND c.user_id=i.user_id WHERE i.user_id=$1 ORDER BY i.acquired_at DESC LIMIT 100',[userId])
 ]);
 return {invoices,contracts,payroll,auditLog,investigations,evidence,purchaseOrders,inventory,inventoryMovements,loans,loanPayments,acquisitions,investments};
}

export async function openInvestigation(user,body){
 const title=clean(body.title,160),allegation=clean(body.allegation,2000),severity=clean(body.severity,12)||'moderate';
 if(!title||!allegation||!['low','moderate','high','critical'].includes(severity))throw new EconomyError('Provide a title, allegation and valid severity.');
 return transaction(async q=>{
  const w=(await q('SELECT id FROM worlds WHERE user_id=$1',[user.id]))[0];
  if(!w)throw new EconomyError('Empire unavailable.',404);
  const company=body.companyId?await worldCompany(q,user.id,body.companyId):null;
  const row=(await q('INSERT INTO investigation_cases(id,user_id,world_id,company_id,title,allegation,severity,opened_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[uid(),user.id,w.id,company?.id||null,title,allegation,severity,'Chairman']))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,w.id,'investigation-opened',title,allegation]);
  await audit(q,user.id,w.id,'Chairman','investigation.opened','investigation',row.id,null,row,'Investigation opened; allegations remain unproven.');
  return row;
 });
}
export async function addInvestigationEvidence(user,id,body){
 const type=clean(body.type,60)||'note',description=clean(body.description,2000),source=clean(body.sourceReference,180)||null;
 const confidence=body.confidence===undefined?null:Number(body.confidence);
 if(!description||confidence!==null&&(!Number.isFinite(confidence)||confidence<0||confidence>1))throw new EconomyError('Provide evidence details and a confidence between 0 and 1.');
 return transaction(async q=>{
  const c=(await q("SELECT * FROM investigation_cases WHERE id=$1 AND user_id=$2 AND status IN ('open','in-review') FOR UPDATE",[id,user.id]))[0];
  if(!c)throw new EconomyError('Investigation is unavailable or closed.',404);
  const evidence=(await q('INSERT INTO investigation_evidence(id,user_id,case_id,evidence_type,description,source_reference,confidence,collected_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[uid(),user.id,id,type,description,source,confidence,'Chairman']))[0];
  await q("UPDATE investigation_cases SET status='in-review',updated_at=now() WHERE id=$1",[id]);
  await audit(q,user.id,c.world_id,'Chairman','investigation.evidence-added','investigation',id,null,evidence,'Evidence added; confidence is an assessment, not proof.');
  return evidence;
 });
}
export async function resolveInvestigation(user,id,body){
 const status=clean(body.status,20),finding=clean(body.finding,2500);
 if(!['substantiated','unsubstantiated','closed'].includes(status)||!finding)throw new EconomyError('Choose an outcome and record the findings.');
 return transaction(async q=>{
  const old=(await q("SELECT * FROM investigation_cases WHERE id=$1 AND user_id=$2 AND status IN ('open','in-review') FOR UPDATE",[id,user.id]))[0];
  if(!old)throw new EconomyError('Investigation unavailable.',404);
  const row=(await q('UPDATE investigation_cases SET status=$1,finding=$2,updated_at=now() WHERE id=$3 AND user_id=$4 RETURNING *',[status,finding,id,user.id]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,old.world_id,'investigation-'+status,old.title,finding]);
  await audit(q,user.id,old.world_id,'Chairman','investigation.'+status,'investigation',id,old,row,finding);
  return row;
 });
}

function qtyString(input){const s=String(input??'');if(!/^[0-9]{1,10}(?:\.[0-9]{1,4})?$/.test(s)||Number(s)<=0)throw new EconomyError('Enter a positive quantity with up to four decimal places.');return Number(s).toFixed(4);}
function cents(s){const [w,f='']=String(s).split('.');return BigInt(w)*100n+BigInt(f.padEnd(2,'0'));}
function moneyFromCents(v){return (v/100n).toString()+'.'+(v%100n).toString().padStart(2,'0');}
export async function createPurchaseOrder(user,body){
 const key='po:'+operationKey(body.operationKey),vendor=clean(body.vendor,140),description=clean(body.description,500),lines=Array.isArray(body.lines)?body.lines.slice(0,20):[];
 if(!vendor||!description||!lines.length)throw new EconomyError('Enter a vendor, purpose and at least one order line.');
 const prepared=lines.map(line=>{const sku=clean(line.sku,60),name=clean(line.name,140),quantity=qtyString(line.quantity),unitCost=amountString(line.unitCost);if(!sku||!name)throw new EconomyError('Every order line needs an SKU and item name.');const scaled=BigInt(quantity.split('.')[0])*10000n+BigInt(quantity.split('.')[1]);const total=(cents(unitCost)*scaled+5000n)/10000n;return {sku,name,quantity,unitCost,lineTotal:moneyFromCents(total),totalCents:total};});
 if(prepared.some(l=>l.totalCents<=0n))throw new EconomyError('Each order line must have a positive total.');
 const totalCents=prepared.reduce((n,l)=>n+l.totalCents,0n),total=moneyFromCents(totalCents);
 const due=body.dueAt?new Date(body.dueAt):null;if(due&&(!Number.isFinite(due.getTime())||due.getTime()<Date.now()-86400000))throw new EconomyError('Choose a valid purchase-order due date.');
 return transaction(async q=>{
  const c=await worldCompany(q,user.id,body.companyId);
  const prior=(await q('SELECT * FROM purchase_orders WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];
  if(prior){if(prior.company_id!==c.id||prior.vendor_name!==vendor||prior.total!==total)throw new EconomyError('Operation reference already used.',409);return prior;}
  const count=(await q('SELECT count(*)::int n FROM purchase_orders WHERE user_id=$1 AND company_id=$2',[user.id,c.id]))[0].n+1;
  const number='PO-'+new Date().getUTCFullYear()+'-'+String(count).padStart(5,'0');
  const po=(await q('INSERT INTO purchase_orders(id,user_id,world_id,company_id,po_number,vendor_name,description,total,due_at,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[uid(),user.id,c.world_id,number,vendor,description,total,due,key]))[0];
  for(const line of prepared){
   const item=(await q("INSERT INTO inventory_items(id,user_id,world_id,company_id,sku,name) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,company_id,sku) DO UPDATE SET name=excluded.name RETURNING id",[uid(),user.id,c.world_id,c.id,line.sku,line.name]))[0];
   await q('INSERT INTO purchase_order_lines(id,user_id,purchase_order_id,inventory_item_id,item_name,sku,quantity,unit_cost,line_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[uid(),user.id,po.id,item.id,line.name,line.sku,line.quantity,line.unitCost,line.lineTotal]);
  }
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,c.world_id,'purchase-order-drafted',number+' drafted',vendor+' · USD '+total+' · Awaiting approval.']);
  await audit(q,user.id,c.world_id,'Chairman','purchase-order.drafted','purchase-order',po.id,null,po,'Draft purchase order; no inventory or cash movement yet.');
  return po;
 });
}
export async function transitionPurchaseOrder(user,id,body){
 const target=clean(body.status,20),reason=clean(body.reason,500);
 if(!['approved','received','paid','cancelled'].includes(target)||!reason)throw new EconomyError('Choose a valid purchase-order action and record a reason.');
 return transaction(async q=>{
  const po=(await q('SELECT * FROM purchase_orders WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]))[0];
  if(!po)throw new EconomyError('Purchase order unavailable.',404);
  if(po.status===target)return po;
  const allowed={draft:['approved','cancelled'],approved:['received','cancelled'],received:['paid'],paid:[],cancelled:[]};
  if(!(allowed[po.status]||[]).includes(target))throw new EconomyError('That purchase-order transition is not permitted.',409);
  const c=await worldCompany(q,user.id,po.company_id);
  if(target==='received'){
   const lines=await q('SELECT * FROM purchase_order_lines WHERE purchase_order_id=$1 AND user_id=$2 ORDER BY id',[id,user.id]);
   if(!lines.length)throw new EconomyError('Purchase order has no lines.',409);
   await recordSystemPurchase(q,c,'purchase-order:'+po.id,po.total,'Inventory received from '+po.vendor_name+' under '+po.po_number,'Procurement');
   for(const line of lines){
    await q(`UPDATE inventory_items SET
      average_cost=CASE WHEN quantity+$2::numeric=0 THEN $3::numeric ELSE round((quantity*average_cost+$2::numeric*$3::numeric)/(quantity+$2::numeric),2) END,
      quantity=quantity+$2::numeric WHERE id=$1 AND user_id=$4`,[line.inventory_item_id,line.quantity,line.unit_cost,user.id]);
    await q('INSERT INTO inventory_movements(id,user_id,company_id,inventory_item_id,direction,quantity,unit_cost,source_type,source_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[uid(),user.id,c.id,line.inventory_item_id,'in',line.quantity,line.unit_cost,'purchase-order',po.id]);
   }
  }
  if(target==='paid')await recordSystemSupplierPayment(q,c,'purchase-order:'+po.id+':payment',po.total,'Supplier payment for '+po.po_number+' to '+po.vendor_name,'Accounts Payable');
  const row=(await q('UPDATE purchase_orders SET status=$1,approval_reason=$2,'+(target==='approved'?'approved_at=now()':target==='received'?'received_at=now()':target==='paid'?'paid_at=now()':'')+' WHERE id=$3 AND user_id=$4 RETURNING *',[target,reason,id,user.id]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,po.world_id,'purchase-order-'+target,po.po_number+' '+target,po.vendor_name+' · USD '+po.total+' · '+reason]);
  await audit(q,user.id,po.world_id,'Chairman','purchase-order.'+target,'purchase-order',id,po,row,reason);
  return row;
 });
}

function zeroableAmount(value){const s=String(value??'0');if(!/^[0-9]{1,12}(?:\.[0-9]{1,2})?$/.test(s))throw new EconomyError('Enter a valid non-negative amount.');return Number(s)===0?'0.00':amountString(s);}
export async function createCompanyLoan(user,body){
 const key='loan:'+operationKey(body.operationKey),lender=clean(body.lender,140),purpose=clean(body.purpose,500),principal=amountString(body.principal),rate=Number(body.annualInterestRate),term=Number(body.termMonths);
 if(!lender||!purpose||!Number.isFinite(rate)||rate<0||rate>100||!Number.isInteger(term)||term<1||term>360)throw new EconomyError('Enter lender, purpose, valid interest rate and term.');
 return transaction(async q=>{
  const c=await worldCompany(q,user.id,body.companyId);
  const prior=(await q('SELECT * FROM company_loans WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];if(prior)return prior;
  const row=(await q('INSERT INTO company_loans(id,user_id,world_id,company_id,lender_name,principal,outstanding_principal,annual_interest_rate,term_months,purpose,operation_key) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10) RETURNING *',[uid(),user.id,c.world_id,c.id,lender,principal,rate,term,purpose,key]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,c.world_id,'loan-proposed','Financing proposal · '+lender,'USD '+principal+' · '+rate+'% annual interest · '+term+' months · Awaiting approval.']);
  await audit(q,user.id,c.world_id,'Chairman','loan.drafted','loan',row.id,null,row,'Draft financing proposal; no debt or cash movement yet.');
  return row;
 });
}
export async function transitionCompanyLoan(user,id,body){
 const target=clean(body.status,20),reason=clean(body.reason,500);
 if(!['approved','disbursed','cancelled'].includes(target)||!reason)throw new EconomyError('Choose a valid loan action and record a reason.');
 return transaction(async q=>{
  const loan=(await q('SELECT * FROM company_loans WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]))[0];if(!loan)throw new EconomyError('Loan unavailable.',404);
  if(loan.status===target)return loan;
  const allowed={draft:['approved','cancelled'],approved:['disbursed','cancelled'],disbursed:[],closed:[],cancelled:[]};
  if(!(allowed[loan.status]||[]).includes(target))throw new EconomyError('That loan transition is not permitted.',409);
  const c=await worldCompany(q,user.id,loan.company_id);
  if(target==='disbursed')await recordSystemLoanDraw(q,c,'loan:'+loan.id+':draw',loan.principal,'Loan proceeds from '+loan.lender_name,'Financing');
  const row=(await q('UPDATE company_loans SET status=$1,'+(target==='approved'?'approved_at=now()':target==='disbursed'?'disbursed_at=now()':'')+' WHERE id=$2 AND user_id=$3 RETURNING *',[target,id,user.id]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,loan.world_id,'loan-'+target,'Loan '+target+' · '+loan.lender_name,'USD '+loan.principal+' · '+reason]);
  await audit(q,user.id,loan.world_id,'Chairman','loan.'+target,'loan',id,loan,row,reason);
  return row;
 });
}
export async function repayCompanyLoan(user,id,body){
 const principal=amountString(body.principalPaid),interest=zeroableAmount(body.interestPaid),reason=clean(body.reason,500),key='loan-payment:'+operationKey(body.operationKey);
 if(!reason)throw new EconomyError('Record the reason for this repayment.');
 return transaction(async q=>{
  const loan=(await q('SELECT * FROM company_loans WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]))[0];
  if(!loan||loan.status!=='disbursed')throw new EconomyError('Only disbursed loans can be repaid.',409);
  const prior=(await q('SELECT * FROM company_loan_payments WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];if(prior)return prior;
  if(Number(principal)>Number(loan.outstanding_principal))throw new EconomyError('Principal repayment exceeds the outstanding loan balance.',409);
  const c=await worldCompany(q,user.id,loan.company_id);
  await recordSystemLoanPayment(q,c,key+':principal',principal,'Principal repayment to '+loan.lender_name,'Debt service');
  if(Number(interest)>0)await recordSystemInterestPayment(q,c,key+':interest',interest,'Interest payment to '+loan.lender_name,'Debt service');
  const outstanding=(Number(loan.outstanding_principal)-Number(principal)).toFixed(2);
  const status=Number(outstanding)===0?'closed':'disbursed';
  const payment=(await q('INSERT INTO company_loan_payments(id,user_id,loan_id,principal_paid,interest_paid,total_paid,reason,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[uid(),user.id,id,principal,interest,(Number(principal)+Number(interest)).toFixed(2),reason,key]))[0];
  await q('UPDATE company_loans SET outstanding_principal=$1,status=$2 WHERE id=$3 AND user_id=$4',[outstanding,status,id,user.id]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,loan.world_id,'loan-repayment','Loan repayment · '+loan.lender_name,'Principal USD '+principal+' · Interest USD '+interest+' · Remaining USD '+outstanding]);
  await audit(q,user.id,loan.world_id,'Chairman','loan.repaid','loan',id,loan,{...loan,outstanding_principal:outstanding,status},reason);
  return payment;
 });
}

export async function createAcquisition(user,body){
 const key='acquisition:'+operationKey(body.operationKey),target=clean(body.targetName,160),sector=clean(body.targetSector,100),seller=clean(body.sellerName,160),description=clean(body.description,1000),price=amountString(body.purchasePrice),valuation=String(Number(body.targetValuation??0)===0?'0.00':amountString(body.targetValuation)),ownership=Number(body.ownershipPercentage);
 if(!target||!sector||!seller||!description||!Number.isFinite(ownership)||ownership<=0||ownership>100)throw new EconomyError('Enter target, sector, seller, purpose and valid ownership percentage.');
 return transaction(async q=>{
  const c=await worldCompany(q,user.id,body.buyerCompanyId);
  const prior=(await q('SELECT * FROM company_acquisitions WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];
  if(prior){if(prior.buyer_company_id!==c.id||prior.target_name!==target||prior.purchase_price!==price)throw new EconomyError('Operation reference already used.',409);return prior;}
  const row=(await q('INSERT INTO company_acquisitions(id,user_id,world_id,buyer_company_id,target_name,target_sector,seller_name,purchase_price,target_valuation,ownership_percentage,description,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',[uid(),user.id,c.world_id,c.id,target,sector,seller,price,valuation,ownership,description,key]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,c.world_id,'acquisition-proposed','Acquisition proposal · '+target,seller+' · USD '+price+' · '+ownership+'% proposed stake. Awaiting approval.']);
  await audit(q,user.id,c.world_id,'Chairman','acquisition.drafted','acquisition',row.id,null,row,'Draft acquisition; no cash or ownership movement.');
  return row;
 });
}
export async function transitionAcquisition(user,id,body){
 const target=clean(body.status,20),reason=clean(body.reason,500);
 if(!['approved','completed','cancelled'].includes(target)||!reason)throw new EconomyError('Choose an acquisition action and record a reason.');
 return transaction(async q=>{
  const deal=(await q('SELECT * FROM company_acquisitions WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]))[0];
  if(!deal)throw new EconomyError('Acquisition unavailable.',404);
  if(deal.status===target)return deal;
  const allowed={draft:['approved','cancelled'],approved:['completed','cancelled'],completed:[],cancelled:[]};
  if(!(allowed[deal.status]||[]).includes(target))throw new EconomyError('That acquisition transition is not permitted.',409);
  const buyer=await worldCompany(q,user.id,deal.buyer_company_id);
  let subsidiaryId=null;
  if(target==='completed'){
   await recordSystemInvestmentPurchase(q,buyer,'acquisition:'+deal.id,deal.purchase_price,'Acquisition of '+deal.target_name,'Corporate development');
   if(Number(deal.ownership_percentage)>50){
    subsidiaryId=uid();
    await q('INSERT INTO companies(id,user_id,world_id,name,sector,valuation,cash,revenue,parent_company_id,ownership_percentage) VALUES($1,$2,$3,$4,$5,$6,0,0,$7,$8)',[subsidiaryId,user.id,deal.world_id,deal.target_name,deal.target_sector,deal.target_valuation,buyer.id,deal.ownership_percentage]);
   }
   await q('INSERT INTO company_investments(id,user_id,world_id,investor_company_id,target_company_id,acquisition_id,target_name,sector,ownership_percentage,cost_basis,current_value) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[uid(),user.id,deal.world_id,buyer.id,subsidiaryId,deal.id,deal.target_name,deal.target_sector,deal.ownership_percentage,deal.purchase_price,deal.target_valuation]);
  }
  const row=(await q('UPDATE company_acquisitions SET status=$1,target_company_id=$2,'+(target==='approved'?'approved_at=now()':target==='completed'?'completed_at=now()':'')+' WHERE id=$3 AND user_id=$4 RETURNING *',[target,subsidiaryId,id,user.id]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,deal.world_id,'acquisition-'+target,'Acquisition '+target+' · '+deal.target_name,'Buyer: '+buyer.name+' · Price USD '+deal.purchase_price+' · Stake '+deal.ownership_percentage+'% · '+reason]);
  await audit(q,user.id,deal.world_id,'Chairman','acquisition.'+target,'acquisition',id,deal,row,reason);
  return row;
 });
}
