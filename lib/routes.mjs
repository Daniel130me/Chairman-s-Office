import { one, sql, uid, transaction } from '../backend/src/db.mjs';
import {start} from 'workflow/api';
import {realtimeMeetingAvailable,createMeetingRealtimeSecret} from './meeting-realtime.mjs';
import {interruptMeeting,retryMeetingRound,recoverMeetingRounds} from './meeting-session.mjs';
import {meetingRoundWorkflow} from '../workflows/meeting-round.js';
import * as world from '../backend/src/world.mjs';
import { aiStatus } from '../backend/src/ai.mjs';
import { requireUser } from './profile.mjs';
import {checkPrivateAudioRequest, HttpError, uuid, clock, pushEndpoint, readBody, checkOrigin } from './validation.mjs';
import {EconomyError,recordTransaction,assignTask,cancelTask} from './economy.mjs';
import {createBoardMotion,decideBoardMotion} from './board-governance.mjs';
import {decideHRCase} from './hr-world.mjs';
import {hireEmployee,terminateEmployee} from './employment.mjs';
import {receivePurchaseOrder,payPurchaseOrder,sellInventory,configureReorder} from './procurement.mjs';
import {createInvoice,payInvoice,createContract,transitionContract,runPayroll,openInvestigation,addInvestigationEvidence,resolveInvestigation,createPurchaseOrder,transitionPurchaseOrder,createCompanyLoan,transitionCompanyLoan,repayCompanyLoan,createAcquisition,transitionAcquisition} from './operations.mjs';
import {decideAction,retryAction} from './action-requests.mjs';
import {createPersonalDebt,repayPersonalDebt,configureAssetUpkeep,createPersonalAccount,personalTransaction,transferPersonalFunds,acquirePersonalAsset,acquirePersonalInvestment,updatePersonalValuation,sellPersonalHolding} from './personal-wealth.mjs';
import {createTravelTrip,createTravelBooking,confirmTravelBooking,cancelTravelBooking,refundTravelBooking,changeTravelTrip} from './travel.mjs';
import {createSecurityIncident,updateSecurityIncident,addSecurityEvidence,updateSecurityEvidence} from './security.mjs';
import {disposeSubsidiary} from './subsidiary-disposal.mjs';
import {startIntangibleSchedule,cancelIntangibleSchedule} from './intangible-schedules.mjs';
import {adjustAcquiredIntangible,payAcquisitionPayable,saveAcquisitionAllocation,corporateFinanceSnapshot,saveDiligence,setLoanTerms,refinanceLoan,adjustInvestment,advanceIntercompany,repayIntercompany} from './corporate-finance.mjs';
import {proposeRebooking,decideRebooking} from './travel-rebooking.mjs';
import {progressiveMeetingAudioAvailable} from './progressive-meeting-audio.mjs';
import {checkpointCall,meetingVoiceSegment,requestConcierge,reportDisruption,resolveDisruption,executiveTravelSnapshot} from './executive-experience.mjs';
import {createRfq,counterRfq,decideRfq,rfqSnapshot} from './supplier-rfq.mjs';
import {reviseDisputePlan,createDisputePlan,payDisputeInstallment,cancelDisputePlan,disputePlanSnapshot} from './dispute-payment-plans.mjs';
import {advancedOperationsSnapshot,recordStocktake,returnCustomerSale,returnSupplierLine,reviewSupplier,createObligation,completeObligation,openDispute,addDisputeEvidence,resolveDispute} from './advanced-operations.mjs';
import {completeSecurityWorkItem} from './security-world.mjs';
import {createGrant,transitionGrant,verifyGrant,scheduleGrant,reportGrantImpact} from './philanthropy.mjs';
import {groupPeriodReport} from './group-period-report.mjs';
import {activityHistory,visitActivity} from './activity-history.mjs';
import {transcribeMeetingAudio,uploadVoiceNote,readVoiceNote} from './voice-notes.mjs';
import {readColleagueAudio} from './colleague-calls.mjs';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function handle(request,context) {
  try {
    const {path}=await context.params;
    const route=path.join('/'), method=request.method;
    if(route==='health'&&method==='GET'){await sql('SELECT 1');return reply({ok:true,service:'chairmans-office'});}
    if(method!=='GET')checkOrigin(request);
    if(method==='GET'&&(route.startsWith('meeting-voice/')||route.startsWith('voice-notes/')||route.startsWith('colleague-audio/')))checkPrivateAudioRequest(request);
    const user=await requireUser();
    if(method==='GET'&&path.length===3&&path[0]==='voice-notes'&&path[2]==='audio')return await readVoiceNote(user.id,uuid(path[1]));
    if(method==='GET'&&path.length===3&&path[0]==='colleague-audio'&&path[2]==='audio')return await readColleagueAudio(user.id,uuid(path[1]));
    let body={};
    if(method!=='GET'||route.startsWith('meeting-voice/')){
      const limit=await one(`INSERT INTO request_limits(user_id,bucket,count) VALUES($1,date_trunc('minute',now()),1)
        ON CONFLICT(user_id,bucket) DO UPDATE SET count=request_limits.count+1 RETURNING count`,[user.id]);
      if(limit.count>60)throw new HttpError(429,'Too many requests. Try again in a minute.');
      if(method==='POST'&&path.length===2&&path[0]==='voice-notes')return reply(await uploadVoiceNote(user,uuid(path[1]),request),201);
      if(method==='POST'&&path.length===3&&path[0]==='meetings'&&path[2]==='transcribe')return reply(await transcribeMeetingAudio(user,uuid(path[1]),request));
      if(method!=='GET')body=await readBody(request);
    }
    const [resource,id,action]=path;
    if(method==='GET'&&route==='meeting-voice/config')return reply({streaming:realtimeMeetingAvailable(),progressiveAudio:progressiveMeetingAudioAvailable()});
    if(method==='GET'&&route==='me')return reply({user});
    if(method==='GET'&&route==='activity/history')return reply(await activityHistory(user.id,new URL(request.url).searchParams.get('cursor')));
    if(method==='POST'&&route==='activity/visit')return reply(await visitActivity(user.id,body.visitId));
    if(method==='POST'&&route==='intercompany'){body.lenderCompanyId=uuid(body.lenderCompanyId);body.borrowerCompanyId=uuid(body.borrowerCompanyId);return reply({facility:await advanceIntercompany(user,body)},201);}
    if(method==='POST'&&resource==='intercompany'&&action==='repay'&&path.length===3)return reply({payment:await repayIntercompany(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='travel-disruptions'&&action==='rebook'&&path.length===3)return reply({proposal:await proposeRebooking(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='travel-rebookings'&&action==='decide'&&path.length===3)return reply({proposal:await decideRebooking(user,uuid(id),body)});
    if(method==='GET'&&route==='executive-travel')return reply(await executiveTravelSnapshot(user.id));
    if(method==='POST'&&resource==='calls'&&action==='checkpoint'&&path.length===3)return reply(await checkpointCall(user,uuid(id),body));
    if(method==='GET'&&resource==='meeting-voice'&&path.length===3)return await meetingVoiceSegment(user,uuid(id),Number(action),{progressive:new URL(request.url).searchParams.get('progressive')==='1',signal:request.signal});
    if(method==='POST'&&resource==='trips'&&action==='concierge'&&path.length===3)return reply({job:await requestConcierge(user,uuid(id),body)},202);
    if(method==='POST'&&resource==='trips'&&action==='disruption'&&path.length===3){if(body.bookingId)body.bookingId=uuid(body.bookingId);return reply({disruption:await reportDisruption(user,uuid(id),body)},201);}
    if(method==='POST'&&resource==='travel-disruptions'&&action==='resolve'&&path.length===3)return reply({disruption:await resolveDisruption(user,uuid(id),body)});
    if(method==='GET'&&route==='supplier-rfqs')return reply(await rfqSnapshot(user.id));
    if(method==='POST'&&resource==='purchase-orders'&&action==='rfq'&&path.length===3){if(!Array.isArray(body.supplierIds)||body.supplierIds.length>5)throw new HttpError(400,'Select suppliers');body.supplierIds=body.supplierIds.map(x=>uuid(x));return reply({rfq:await createRfq(user,uuid(id),body)},201);}
    if(method==='POST'&&resource==='supplier-rfq-rounds'&&action==='counter'&&path.length===3)return reply({round:await counterRfq(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='supplier-rfqs'&&action==='decide'&&path.length===3){if(body.roundId)body.roundId=uuid(body.roundId);return reply({rfq:await decideRfq(user,uuid(id),body)});}
    if(method==='GET'&&route==='dispute-payment-plans')return reply(await disputePlanSnapshot(user.id));
    if(method==='POST'&&resource==='commercial-disputes'&&action==='payment-plan'&&path.length===3)return reply({plan:await createDisputePlan(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='dispute-installments'&&action==='pay'&&path.length===3)return reply({installment:await payDisputeInstallment(user,uuid(id),body)});
    if(method==='POST'&&resource==='dispute-payment-plans'&&action==='revise'&&path.length===3)return reply({revision:await reviseDisputePlan(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='dispute-payment-plans'&&action==='cancel'&&path.length===3)return reply({plan:await cancelDisputePlan(user,uuid(id),body)});
    if(method==='GET'&&route==='advanced-operations')return reply(await advancedOperationsSnapshot(user.id));
    if(method==='POST'&&resource==='inventory'&&action==='stocktake'&&path.length===3)return reply({count:await recordStocktake(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='stock-sales'&&action==='return'&&path.length===3)return reply({return:await returnCustomerSale(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='purchase-order-lines'&&action==='return'&&path.length===3)return reply({return:await returnSupplierLine(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='purchase-orders'&&action==='review'&&path.length===3)return reply({review:await reviewSupplier(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='contracts'&&action==='obligation'&&path.length===3)return reply({obligation:await createObligation(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='contract-obligations'&&action==='complete'&&path.length===3)return reply({obligation:await completeObligation(user,uuid(id),body)});
    if(method==='POST'&&resource==='contracts'&&action==='dispute'&&path.length===3)return reply({dispute:await openDispute(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='commercial-disputes'&&action==='evidence'&&path.length===3)return reply({evidence:await addDisputeEvidence(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='commercial-disputes'&&action==='resolve'&&path.length===3)return reply({dispute:await resolveDispute(user,uuid(id),body)});
    if(method==='POST'&&resource==='acquisition-allocations'&&action==='amortization-schedule'&&path.length===3)return reply({schedule:await startIntangibleSchedule(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='amortization-schedules'&&action==='cancel'&&path.length===3)return reply({schedule:await cancelIntangibleSchedule(user,uuid(id),body)});
    if(method==='POST'&&resource==='acquisition-allocations'&&action==='adjust-intangible'&&path.length===3)return reply({adjustment:await adjustAcquiredIntangible(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='acquisition-allocations'&&action==='pay'&&path.length===3)return reply({payment:await payAcquisitionPayable(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='acquisitions'&&action==='allocation'&&path.length===3)return reply({allocation:await saveAcquisitionAllocation(user,uuid(id),body)});
    if(method==='POST'&&resource==='corporate-investments'&&action==='dispose-control'&&path.length===3)return reply({disposal:await disposeSubsidiary(user,uuid(id),body)},201);
    if(method==='GET'&&route==='corporate-finance/period'){const params=new URL(request.url).searchParams;return reply(await groupPeriodReport(user.id,params.get('start'),params.get('end')));}
    if(method==='GET'&&route==='corporate-finance')return reply(await corporateFinanceSnapshot(user.id));
    if(method==='POST'&&resource==='acquisitions'&&action==='diligence'&&path.length===3)return reply({diligence:await saveDiligence(user,uuid(id),body)});
    if(method==='POST'&&resource==='loans'&&action==='terms'&&path.length===3)return reply({terms:await setLoanTerms(user,uuid(id),body)});
    if(method==='POST'&&resource==='loans'&&action==='refinance'&&path.length===3)return reply({refinancing:await refinanceLoan(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='corporate-investments'&&action==='adjust'&&path.length===3)return reply({adjustment:await adjustInvestment(user,uuid(id),body)},201);
    if(method==='GET'&&route==='state')return reply({user,state:await world.state(user.id)});
    if(method==='POST'&&resource==='world-conversations'&&action==='message'&&path.length===3)return reply(await world.sendGroupMessage(user,uuid(id),body.body));
    if(method==='POST'&&resource==='grants'&&path.length===3&&action==='verify')return reply({grant:await verifyGrant(user,uuid(id),body)});
    if(method==='POST'&&resource==='grants'&&path.length===3&&action==='recurring')return reply({grant:await scheduleGrant(user,uuid(id),body)});
    if(method==='POST'&&resource==='grants'&&path.length===3&&action==='impact')return reply({report:await reportGrantImpact(user,uuid(id),body)},201);
    if(method==='POST'&&route==='grants'){if(body.fundingSource==='company')body.companyId=uuid(body.companyId);return reply({grant:await createGrant(user,body)},201);}
    if(method==='POST'&&resource==='grants'&&path.length===3&&['approve','pay','cancel'].includes(action))return reply({grant:await transitionGrant(user,uuid(id),{...body,status:action==='approve'?'approved':action==='pay'?'paid':'cancelled'})});
    if(method==='POST'&&route==='security-incidents')return reply({incident:await createSecurityIncident(user,body)},201);
    if(method==='POST'&&resource==='security-incidents'&&path.length===3&&action==='update')return reply({incident:await updateSecurityIncident(user,uuid(id),body)});
    if(method==='POST'&&resource==='security-incidents'&&path.length===3&&action==='evidence')return reply({evidence:await addSecurityEvidence(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='security-evidence'&&path.length===3&&action==='verify')return reply({evidence:await updateSecurityEvidence(user,uuid(id),body)});
    if(method==='POST'&&resource==='security-work-items'&&path.length===3&&action==='complete')return reply({workItem:await completeSecurityWorkItem(user,uuid(id),body)}); 
    if(method==='POST'&&resource==='trips'&&path.length===3&&action==='change')return reply({trip:await changeTravelTrip(user,uuid(id),body)});
    if(method==='POST'&&resource==='bookings'&&path.length===3&&action==='refund')return reply({refund:await refundTravelBooking(user,uuid(id),body)},201);
    if(method==='POST'&&route==='trips')return reply({trip:await createTravelTrip(user,body)},201);
    if(method==='POST'&&resource==='trips'&&path.length===3&&action==='bookings')return reply({booking:await createTravelBooking(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='bookings'&&path.length===3&&action==='confirm')return reply({booking:await confirmTravelBooking(user,uuid(id),body)});
    if(method==='POST'&&resource==='bookings'&&path.length===3&&action==='cancel')return reply({booking:await cancelTravelBooking(user,uuid(id),body)});
    if(method==='POST'&&resource==='personal'&&id==='accounts')return reply({account:await createPersonalAccount(user,body)},201);
    if(method==='POST'&&resource==='personal'&&id==='transactions'){body.accountId=uuid(body.accountId);return reply({transaction:await personalTransaction(user,body)},201);}
    if(method==='POST'&&route==='personal/debts'){body.accountId=uuid(body.accountId);return reply({debt:await createPersonalDebt(user,body)},201);}
    if(method==='POST'&&resource==='personal-debts'&&path.length===3&&action==='repay')return reply({payment:await repayPersonalDebt(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='personal-assets'&&path.length===3&&action==='upkeep')return reply({asset:await configureAssetUpkeep(user,uuid(id),body)});
    if(method==='POST'&&route==='personal/transfers'){body.fromAccountId=uuid(body.fromAccountId);body.toAccountId=uuid(body.toAccountId);return reply({transfer:await transferPersonalFunds(user,body)},201);}
    if(method==='POST'&&resource==='personal'&&id==='assets'){body.accountId=uuid(body.accountId);return reply({asset:await acquirePersonalAsset(user,body)},201);}
    if(method==='POST'&&resource==='personal'&&id==='investments'){body.accountId=uuid(body.accountId);return reply({investment:await acquirePersonalInvestment(user,body)},201);}
    if(method==='POST'&&resource==='personal'&&id==='value'&&path.length===4)return reply({holding:await updatePersonalValuation(user,path[2],uuid(path[3]),body)});
    if(method==='POST'&&resource==='personal'&&id==='sell'&&path.length===4)return reply({holding:await sellPersonalHolding(user,path[2],uuid(path[3]),body)});
    if(method==='POST'&&resource==='approvals'&&action==='decide'&&path.length===3)return reply({approval:await decideAction(user,uuid(id),body)});
    if(method==='POST'&&resource==='approvals'&&action==='retry'&&path.length===3)return reply({approval:await retryAction(user,uuid(id),body)});
    if(method==='POST'&&route==='investigations') {if(body.companyId)body.companyId=uuid(body.companyId);return reply({investigation:await openInvestigation(user,body)},201);}
    if(method==='POST'&&resource==='investigations'&&action==='evidence'&&path.length===3)return reply({evidence:await addInvestigationEvidence(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='investigations'&&action==='resolve'&&path.length===3)return reply({investigation:await resolveInvestigation(user,uuid(id),body)});
    if(method==='POST'&&route==='acquisitions'){body.buyerCompanyId=uuid(body.buyerCompanyId);return reply({acquisition:await createAcquisition(user,body)},201);}
    if(method==='POST'&&resource==='acquisitions'&&path.length===3&&['approve','complete','cancel'].includes(action))return reply({acquisition:await transitionAcquisition(user,uuid(id),{...body,status:action==='approve'?'approved':action==='complete'?'completed':'cancelled'})});
    if(method==='POST'&&route==='loans'){body.companyId=uuid(body.companyId);return reply({loan:await createCompanyLoan(user,body)},201);}
    if(method==='POST'&&resource==='loans'&&path.length===3&&action==='repay')return reply({payment:await repayCompanyLoan(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='loans'&&path.length===3&&['approve','disburse','cancel'].includes(action))return reply({loan:await transitionCompanyLoan(user,uuid(id),{...body,status:action==='approve'?'approved':action==='disburse'?'disbursed':'cancelled'})});
    if(method==='POST'&&resource==='purchase-orders'&&path.length===3&&action==='partial-receive')return reply({purchaseOrder:await receivePurchaseOrder(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='purchase-orders'&&path.length===3&&action==='partial-pay')return reply({purchaseOrder:await payPurchaseOrder(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='inventory'&&path.length===3&&action==='sell')return reply({sale:await sellInventory(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='inventory'&&path.length===3&&action==='reorder')return reply({item:await configureReorder(user,uuid(id),body)});
    if(method==='POST'&&route==='purchase-orders'){body.companyId=uuid(body.companyId);return reply({purchaseOrder:await createPurchaseOrder(user,body)},201);}
    if(method==='POST'&&resource==='purchase-orders'&&path.length===3&&['approve','receive','pay','cancel'].includes(action))return reply({purchaseOrder:await transitionPurchaseOrder(user,uuid(id),{...body,status:action==='approve'?'approved':action==='receive'?'received':action==='pay'?'paid':'cancelled'})});
    if(method==='POST'&&route==='invoices'){body.companyId=uuid(body.companyId);return reply({invoice:await createInvoice(user,body)},201);}
    if(method==='POST'&&resource==='invoices'&&action==='pay'&&path.length===3)return reply({invoice:await payInvoice(user,uuid(id))});
    if(method==='POST'&&route==='contracts'){body.companyId=uuid(body.companyId);return reply({contract:await createContract(user,body)},201);}
    if(method==='POST'&&resource==='contracts'&&action==='transition'&&path.length===3)return reply({contract:await transitionContract(user,uuid(id),body)});
    if(method==='POST'&&route==='payroll/run'){body.companyId=uuid(body.companyId);return reply({payroll:await runPayroll(user,body)},201);}
    if(method==='POST'&&resource==='economy'&&action==='transaction'&&path.length===3)return reply({entry:await recordTransaction(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='hr-cases'&&action==='decide'&&path.length===3)return reply({case:await decideHRCase(user,uuid(id),body)});
    if(method==='POST'&&route==='employees'){body.companyId=uuid(body.companyId);return reply({employee:await hireEmployee(user,body)},201);}
    if(method==='POST'&&resource==='employees'&&action==='terminate'&&path.length===3)return reply({employee:await terminateEmployee(user,uuid(id),body)});
    if(method==='POST'&&route==='tasks'){body.assigneeId=uuid(body.assigneeId);if(body.companyId)body.companyId=uuid(body.companyId);return reply({task:await assignTask(user,body)},201);}
    if(method==='POST'&&resource==='tasks'&&action==='cancel'&&path.length===3)return reply({task:await cancelTask(user,uuid(id))});
    if(method==='GET'&&route==='providers')return reply({providers:aiStatus(),voice:'Vapi Web SDK'});
    if(method==='POST'&&route==='world')return reply({world:await world.createWorld(user,body)},201);
    if(method==='POST'&&resource==='mail'&&action==='read'&&path.length===3){await sql("UPDATE messages SET read_at=now() WHERE user_id=$1 AND contact_id=$2 AND channel='email' AND direction='incoming' AND read_at IS NULL",[user.id,uuid(id)]);return reply({ok:true});}
    if(method==='POST'&&resource==='messages'&&path.length===2){const channel=body.channel||'chat';if(!['chat','email'].includes(channel))throw new HttpError(400,'Invalid message channel');return reply(await world.message(user,uuid(id),body.body,channel,body.sourceCallId?uuid(body.sourceCallId):null,body.subject));}
    if(method==='PUT'&&resource==='contacts'&&action==='voice'&&path.length===3){
      const found=await one('UPDATE contacts SET voice_id=$1,vapi_assistant_id=$2 WHERE id=$3 AND user_id=$4 RETURNING id',[String(body.voiceId||'').slice(0,120)||null,String(body.vapiAssistantId||'').slice(0,120)||null,uuid(id),user.id]);
      if(!found)throw new HttpError(404,'Contact not found');return reply({ok:true});
    }
    if(method==='POST'&&resource==='contacts'&&action==='request-call'&&path.length===3)return reply({invite:await world.makeInvite(user,uuid(id))});
    if(method==='POST'&&route==='calls/start')return reply(await world.startCall(user,uuid(body.contactId),body.inviteId?uuid(body.inviteId):null),201);
    if(method==='POST'&&resource==='calls'&&action==='end'&&path.length===3)return reply(await world.finishCall(user,uuid(id),body.transcript,body.status==='failed'?'failed':'completed'));
    if(method==='POST'&&resource==='invites'&&action==='decline'&&path.length===3){
      await sql("UPDATE invites SET status='declined' WHERE id=$1 AND user_id=$2 AND status='pending'",[uuid(id),user.id]);return reply({ok:true});
    }
    if(method==='POST'&&resource==='meetings'&&path.length===3&&action==='motions')return reply({motion:await createBoardMotion(user,uuid(id),body)},201);
    if(method==='POST'&&resource==='board-motions'&&path.length===3&&action==='decide')return reply({motion:await decideBoardMotion(user,uuid(id),body)});
    if(method==='POST'&&route==='meetings'){
      if(!Array.isArray(body.attendees)||!body.attendees.length)throw new HttpError(400,'Select attendees');
      body.attendees.forEach(x=>uuid(x,'attendee'));
      if(body.start_at&&!Number.isFinite(Date.parse(body.start_at)))throw new HttpError(400,'Invalid meeting date');
      return reply({meeting:await world.createMeeting(user,body)},201);
    }
    if(resource==='meetings'&&(path.length===3||method==='GET'&&action==='rounds'&&path.length===4)){
      uuid(id);
      if(method==='POST'&&action==='realtime-secret')return reply(await createMeetingRealtimeSecret(user,id,body),201);
      if(method==='POST'&&action==='speak'){
         if(typeof body.message!=='string'||!body.message.trim())throw new HttpError(400,'Speak or type a message first.');
         const result=await world.meetingSpeak(user,id,body.message,{requestId:body.requestId?uuid(body.requestId):null,contactId:body.contactId?uuid(body.contactId):null,interrupt:body.interrupt===true});
         if(!result.replayed)try{await start(meetingRoundWorkflow,[result.roundId,user.id]);}
         catch(error){await sql("UPDATE meeting_rounds SET status='failed',error=$1,completed_at=now() WHERE id=$2 AND user_id=$3 AND status='pending'",[String(error.message||'Unable to start meeting workflow').slice(0,500),result.roundId,user.id]);}
         return reply(result,202);
       }
      if(method==='POST'&&action==='retry'){await recoverMeetingRounds(user.id);const round=await retryMeetingRound(user,id,uuid(body.roundId));if(round.status==='pending')try{await start(meetingRoundWorkflow,[round.id,user.id]);}catch(error){await sql("UPDATE meeting_rounds SET status='failed',error=$1,completed_at=now() WHERE id=$2 AND user_id=$3 AND status='pending'",[String(error.message||'Unable to restart discussion').slice(0,500),round.id,user.id]);}return reply({roundId:round.id},202);}
      if(method==='POST'&&action==='interrupt')return reply({round:await interruptMeeting(user,id,uuid(body.roundId))});
      if(method==='POST'&&action==='end')return reply(await world.endMeeting(user,id));
      if(method==='GET'&&action==='rounds'&&path.length===3){await recoverMeetingRounds(user.id);return reply({rounds:await world.meetingRounds(user,id)});}
       if(method==='GET'&&action==='rounds'&&path.length===4){await recoverMeetingRounds(user.id);const round=await world.meetingRoundStatus(user,id,uuid(path[3]));if(!round)throw new HttpError(404,'Meeting round unavailable');return reply({round});}
       if(method==='GET'&&action==='turns'){
        if(!await one('SELECT id FROM meetings WHERE id=$1 AND user_id=$2',[id,user.id]))throw new HttpError(404,'Meeting unavailable');
        return reply({turns:await sql('SELECT * FROM meeting_turns WHERE meeting_id=$1 AND user_id=$2 ORDER BY created_at',[id,user.id])});
      }
    }
    if(method==='POST'&&route==='decisions'){
      if(typeof body.content!=='string'||!body.content.trim())throw new HttpError(400,'Write a decision first');
      return reply({decision:await world.recordDecision(user,uuid(body.threadId),body.content)},201);
    }
    if(method==='POST'&&resource==='tenders'&&path.length===3){
      if(action==='negotiate')return reply(await world.negotiate(user,uuid(id),uuid(body.bidId),body.amount));
      if(action==='prefer')return reply(await world.prefer(user,uuid(id),uuid(body.bidId)));
    }
    if(method==='PUT'&&route==='settings'){
      const changes=[];
      for(const key of ['morning','evening','quiet_start','quiet_end','quiet_enabled','max_daily','urgent','ringtone','theme']){
        if(body[key]===undefined)continue;let value=body[key];
        if(['morning','evening','quiet_start','quiet_end'].includes(key))value=clock(value);
        else if(key==='max_daily'){if(!Number.isInteger(Number(value))||Number(value)<0||Number(value)>8)throw new HttpError(400,'Maximum calls must be 0–8');value=Number(value);}
        else if(key==='urgent'||key==='quiet_enabled'){if(typeof value!=='boolean')throw new HttpError(400,'Invalid urgent setting');}
        else if(key==='theme'){if(!['dark','light'].includes(value))throw new HttpError(400,'Invalid theme');}
        else value=String(value).slice(0,32);
        changes.push([key,value]);
      }
      await transaction(async q=>{for(const [key,value] of changes)await q('UPDATE settings SET '+key+'=$1 WHERE user_id=$2',[value,user.id]);});
      return reply({settings:await one('SELECT * FROM settings WHERE user_id=$1',[user.id])});
    }
    if(method==='GET'&&route==='push/status'){const [row]=await sql('SELECT count(*)::int AS devices FROM push_subscriptions WHERE user_id=$1',[user.id]);return reply({devices:row.devices,configured:!!(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY)});}
    if(method==='POST'&&route==='push/test'){const endpoint=pushEndpoint(body.endpoint);const sub=await one('SELECT id FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2',[user.id,endpoint]);if(!sub)throw new HttpError(404,'This device is not subscribed.');const w=await one('SELECT id FROM worlds WHERE user_id=$1',[user.id]);if(!w)throw new HttpError(404,'Empire unavailable.');const recent=await one("SELECT id FROM events WHERE user_id=$1 AND kind='notification-test' AND created_at>now()-interval '2 minutes'",[user.id]);if(recent)throw new HttpError(429,'A test alert was recently queued.');const eventId=uid();await sql("INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,'notification-test','Notification test','A test alert was requested.')",[eventId,user.id,w.id]);return reply({queued:true,eventId},202);}
    if(method==='GET'&&route==='push/public')return reply({key:process.env.VAPID_PUBLIC_KEY||null});
    if(method==='POST'&&route==='push/subscribe'){
      const endpoint=pushEndpoint(body.endpoint);
      if(typeof body.keys?.p256dh!=='string'||typeof body.keys?.auth!=='string'||body.keys.p256dh.length>200||body.keys.auth.length>100)throw new HttpError(400,'Invalid push subscription');
      const row=await one(`INSERT INTO push_subscriptions(id,user_id,endpoint,subscription) VALUES($1,$2,$3,$4)
        ON CONFLICT(endpoint) DO UPDATE SET subscription=EXCLUDED.subscription WHERE push_subscriptions.user_id=EXCLUDED.user_id RETURNING id`,[uid(),user.id,endpoint,JSON.stringify({endpoint,keys:body.keys})]);
      if(!row)throw new HttpError(409,'This device is subscribed to another account.');
      return reply({ok:true});
    }
    if(method==='POST'&&route==='push/unsubscribe'){await sql('DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2',[user.id,String(body.endpoint||'')]);return reply({ok:true});}
    throw new HttpError(404,'Unknown API route');
  }catch(e){
    if(e instanceof HttpError||e instanceof EconomyError)return reply({error:e.message},e.status);
    if(e.code==='23505')return reply({error:'This record already exists.'},409);
    if(/^(Contact unavailable|Meeting unavailable|No participants|Matter unavailable|Bid unavailable|Call unavailable|Your empire is already established|Set a holding company|Invalid time zone|Write a message|Select attendees|Empire unavailable|Enter a valid amount|Invitation unavailable)/.test(e.message||''))return reply({error:e.message},400);
    console.error('API error',e.code||e.name);return reply({error:'Request could not be completed. Try again.'},503);
  }
}
