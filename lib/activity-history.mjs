import {sql,transaction} from '../backend/src/db.mjs';
import {HttpError,uuid} from './validation.mjs';
// Fixed source registry; user input is never interpolated into SQL identifiers.
export const activitySources=[
 ['operations.opportunities','commercial_opportunities','updated_at'],
 ['operations.milestones','commercial_milestones','updated_at'],
 ['colleagueCalls','colleague_calls','started_at'],
 [
  "events",
  "events",
  "created_at"
 ],
 [
  "operations.auditLog",
  "world_audit_log",
  "created_at",
  "",
  [
   "before_state",
   "after_state"
  ]
 ],
 [
  "messages",
  "messages",
  "created_at"
 ],
 [
  "worldConversationMessages",
  "world_conversation_messages",
  "created_at"
 ],
 [
  "calls",
  "calls",
  "started_at",
  "",
  [
   "transcript"
  ]
 ],
 [
  "invites",
  "invites",
  "due_at"
 ],
 [
  "meetings",
  "meetings",
  "created_at"
 ],
 [
  "meeting_turns",
  "meeting_turns",
  "created_at"
 ],
 [
  "decisions",
  "decisions",
  "created_at"
 ],
 [
  "documents",
  "documents",
  "created_at",
  "",
  [
   "body"
  ]
 ],
 [
  "tenders",
  "tenders",
  "created_at"
 ],
 [
  "bids",
  "bids",
  "created_at"
 ],
 [
  "economy.journal",
  "economy_journal",
  "effective_at",
  "company"
 ],
 [
  "economy.tasks",
  "business_tasks",
  "GREATEST(t.created_at,t.completed_at)",
  "assignee"
 ],
 [
  "employees",
  "employment_records",
  "GREATEST(t.hired_at,t.terminated_at)",
  "employee"
 ],
 [
  "operations.invoices",
  "business_invoices",
  "GREATEST(t.issued_at,t.paid_at)",
  "company"
 ],
 [
  "operations.contracts",
  "business_contracts",
  "GREATEST(t.created_at,t.updated_at)",
  "company"
 ],
 [
  "operations.payroll",
  "payroll_runs",
  "paid_at",
  "company"
 ],
 [
  "operations.investigations",
  "investigation_cases",
  "GREATEST(t.opened_at,t.updated_at)",
  "company"
 ],
 [
  "operations.evidence",
  "investigation_evidence",
  "created_at"
 ],
 [
  "operations.purchaseOrders",
  "purchase_orders",
  "GREATEST(t.created_at,t.approved_at,t.received_at,t.paid_at)",
  "company"
 ],
 [
  "operations.inventoryMovements",
  "inventory_movements",
  "created_at",
  "inventory"
 ],
 [
  "operations.loans",
  "company_loans",
  "GREATEST(t.created_at,t.approved_at,t.disbursed_at)",
  "company"
 ],
 [
  "operations.loanPayments",
  "company_loan_payments",
  "paid_at"
 ],
 [
  "operations.acquisitions",
  "company_acquisitions",
  "GREATEST(t.created_at,t.approved_at,t.completed_at)",
  "buyer"
 ],
 [
  "operations.investments",
  "company_investments",
  "acquired_at",
  "investor"
 ],
 [
  "actionRequests",
  "action_requests",
  "GREATEST(t.created_at,t.decided_at,t.executed_at)",
  "requester"
 ],
 [
  "trips",
  "travel_trips",
  "created_at"
 ],
 [
  "travelBookings",
  "travel_bookings",
  "GREATEST(t.created_at,t.booked_at)"
 ],
 [
  "securityIncidents",
  "security_incidents",
  "GREATEST(t.created_at,t.updated_at,t.resolved_at)"
 ],
 [
  "securityEvidence",
  "security_incident_evidence",
  "created_at"
 ],
 [
  "grants",
  "charitable_grants",
  "GREATEST(t.created_at,t.approved_at,t.paid_at)"
 ],
 [
  "personalTransactions",
  "personal_transactions",
  "created_at",
  "account"
 ],
 [
  "personalAssets",
  "personal_assets",
  "GREATEST(t.acquired_at,t.sold_at)"
 ],
 [
  "personalInvestments",
  "personal_investments",
  "GREATEST(t.purchased_at,t.updated_at)"
 ],
 [
  "marketMoves",
  "market_moves",
  "created_at",
  "market"
 ],
 [
  "realWorldNews",
  "real_world_news",
  "COALESCE(t.published_at,t.retrieved_at)"
 ]
];
const metadata={
 company:["LEFT JOIN companies c ON c.id=t.company_id AND c.user_id=t.user_id","jsonb_build_object('company_name',c.name)"],
 assignee:["LEFT JOIN contacts c ON c.id=t.assignee_id AND c.user_id=t.user_id","jsonb_build_object('assignee_name',c.name)"],
 employee:["LEFT JOIN contacts c ON c.id=t.contact_id AND c.user_id=t.user_id LEFT JOIN companies co ON co.id=t.company_id AND co.user_id=t.user_id","jsonb_build_object('name',c.name,'contact_name',c.name,'company_name',co.name)"],
 inventory:["LEFT JOIN inventory_items i ON i.id=t.inventory_item_id AND i.user_id=t.user_id LEFT JOIN companies c ON c.id=t.company_id AND c.user_id=t.user_id","jsonb_build_object('item_name',i.name,'company_name',c.name)"],
 buyer:["LEFT JOIN companies c ON c.id=t.buyer_company_id AND c.user_id=t.user_id","jsonb_build_object('buyer_name',c.name)"],
 investor:["LEFT JOIN companies c ON c.id=t.investor_company_id AND c.user_id=t.user_id","jsonb_build_object('investor_name',c.name)"],
 requester:["LEFT JOIN contacts c ON c.id=t.requested_by_contact_id AND c.user_id=t.user_id LEFT JOIN companies co ON co.id=t.company_id AND co.user_id=t.user_id","jsonb_build_object('requester_name',c.name,'requester_title',c.title,'company_name',co.name)"],
 account:["LEFT JOIN personal_accounts a ON a.id=t.account_id AND a.user_id=t.user_id","jsonb_build_object('account_name',a.name)"],
 market:["LEFT JOIN external_organizations o ON o.id=t.organization_id AND o.user_id=t.user_id LEFT JOIN contacts c ON c.id=t.contact_id AND c.user_id=t.user_id LEFT JOIN companies co ON co.id=t.company_id AND co.user_id=t.user_id","jsonb_build_object('organization_name',o.name,'contact_name',c.name,'company_name',co.name)"]
};
export function historyQuery(){
 return activitySources.map(([source,table,date,meta,omit=[]])=>{
  const time=date.includes('(')?date:'t.'+date;
  const [join,extra]=metadata[meta]||['',"'{}'::jsonb"];
  const record='(to_jsonb(t)'+omit.map(field=>" - '"+field+"'").join('')+' || '+extra+')';
  return "SELECT '"+source+"'::text AS source,"+time+" AS ts,t.id,"+record+" AS record FROM "+table+" t "+join+" WHERE t.user_id=$1 AND "+time+" IS NOT NULL";
 }).join(' UNION ALL ');
}
export function decodeActivityCursor(cursor){
 if(!cursor)return null;
 try{
  const c=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
  if(!activitySources.some(x=>x[0]===c.source)||typeof c.ts!=='string'||!Number.isFinite(Date.parse(c.ts)))throw Error();
  uuid(c.id);
  return c;
 }catch{throw new HttpError(400,'Invalid activity cursor');}
}
export async function activityHistory(userId,cursor){
 const c=decodeActivityCursor(cursor);
 const rows=await sql(`SELECT source,ts::text AS ts,id,record FROM (${historyQuery()}) history
   WHERE ($2::timestamptz IS NULL OR (ts,source,id)<($2::timestamptz,$3::text,$4::uuid))
   ORDER BY ts DESC,source DESC,id DESC LIMIT 151`,[userId,c?.ts||null,c?.source||null,c?.id||null]);
 const page=rows.slice(0,150),last=page.at(-1);
 return {rows:page.map(({source,record})=>({source,record})),nextCursor:rows.length>150?Buffer.from(JSON.stringify({source:last.source,ts:last.ts,id:last.id})).toString('base64url'):null};
}
export async function visitActivity(userId,visitId){
 uuid(visitId,'visit');
 return transaction(async q=>{
  await q('INSERT INTO activity_visits(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',[userId]);
  const [prior]=await q('SELECT * FROM activity_visits WHERE user_id=$1 FOR UPDATE',[userId]);
  if(prior.visit_id===visitId)return {lastSeenAt:prior.previous_seen_at,visitedAt:prior.last_seen_at};
  const [next]=await q('UPDATE activity_visits SET previous_seen_at=last_seen_at,last_seen_at=now(),visit_id=$2 WHERE user_id=$1 RETURNING previous_seen_at,last_seen_at',[userId,visitId]);
  return {lastSeenAt:next.previous_seen_at,visitedAt:next.last_seen_at};
 });
}
