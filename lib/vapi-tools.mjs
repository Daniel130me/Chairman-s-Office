import {one,transaction,uid} from '../backend/src/db.mjs';
import {describeSchedule,normalizeChairmanMessage} from './vapi-tool-results.mjs';
import {scheduleExecutiveCall} from './call-workflow.mjs';
import {verifyVapiActionToken} from './vapi-action-token.mjs';
import {parseCallIntent} from './executive-intents.mjs';
import {requestAction} from './action-requests.mjs';

function objectArguments(value){
  if(typeof value==='string'){
    try{value=JSON.parse(value);}catch{return {};}
  }
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
}

function toolCalls(message){
  if(Array.isArray(message?.toolCallList)&&message.toolCallList.length)return message.toolCallList;
  if(Array.isArray(message?.toolWithToolCallList))return message.toolWithToolCallList.map(x=>x.toolCall||x);
  if(Array.isArray(message?.toolCallList))return message.toolCallList;
  return [];
}

export async function handleVapiTools(request){
  let payload;
  try{payload=await request.json();}catch{
    return Response.json({results:[]});
  }

  const message=payload?.message||payload;
  if(message?.type!=='tool-calls')return Response.json({results:[]});

  const calls=toolCalls(message);
  console.info('[Vapi tools] tool-calls received',{count:calls.length,names:calls.map(item=>item?.function?.name||item?.name||item?.toolCall?.function?.name||'unknown')});
  const results=[];
  for(const item of calls){
    const toolCallId=item?.id||item?.toolCall?.id;
    if(!toolCallId)continue;
    const fn=item?.function||item?.toolCall?.function||{};
    const name=fn.name||item?.name;
    const args={...objectArguments(fn.arguments??fn.parameters??item?.arguments),...objectArguments(item?.parameters)};

    try{
      if(name==='send_chairman_message'){
        const claims=verifyVapiActionToken(args.action_token);
        const call=await one("SELECT id,user_id,world_id,contact_id FROM calls WHERE id=$1 AND user_id=$2 AND status='active'",[claims.callId,claims.userId]);
        if(!call||call.contact_id!==claims.sourceContactId)throw new Error('This call session has ended. Please start a new call.');
        const body=normalizeChairmanMessage(args.body);
        const messageKey=call.id;
        const contact=await one('SELECT id,name,title FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3',[call.contact_id,call.user_id,call.world_id]);
        if(!contact)throw new Error('The executive contact is no longer available.');
        const saved=await transaction(async q=>{
          const [active]=await q("SELECT id FROM calls WHERE id=$1 AND user_id=$2 AND contact_id=$3 AND status='active' FOR UPDATE",[call.id,call.user_id,call.contact_id]);
          if(!active)throw new Error('The call has ended. I could not send the message.');
          const [prior]=await q('SELECT id,contact_id FROM messages WHERE user_id=$1 AND (client_message_key=$2 OR source_call_id=$2) LIMIT 1 FOR UPDATE',[call.user_id,messageKey]);
          if(prior){
            if(prior.contact_id!==call.contact_id)throw new Error('This message action key has already been used.');
            return {id:prior.id,alreadySent:true};
          }
          const [inserted]=await q("INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body,source_call_id,client_message_key) VALUES($1,$2,$3,$4,'incoming','chat',$5,$6,$6) ON CONFLICT DO NOTHING RETURNING id",[uid(),call.user_id,call.world_id,call.contact_id,body,messageKey]);
          if(!inserted){
            const [existing]=await q('SELECT id,contact_id FROM messages WHERE user_id=$1 AND (client_message_key=$2 OR source_call_id=$2) LIMIT 1',[call.user_id,messageKey]);
            if(!existing||existing.contact_id!==call.contact_id)throw new Error('The message could not be saved safely. Please try again.');
            return {id:existing.id,alreadySent:true};
          }
          await q('UPDATE contacts SET last_contact_at=now() WHERE id=$1 AND user_id=$2',[call.contact_id,call.user_id]);
          await q("INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,'executive-message-sent',$5,$6)",[uid(),call.user_id,call.world_id,call.contact_id,'Message from '+contact.name,contact.name+' sent a text message to the Chairman’s Messages app.']);
          return {id:inserted.id,alreadySent:false};
        });
        results.push({toolCallId,result:saved.alreadySent
          ?'That message was already saved in the Chairman’s Office Messages app, so no duplicate was created.'
          :'The text message is now saved in the Chairman’s Office Messages app, in the conversation with the Chairman. This is an in-app message, not an SMS to his mobile number.'});
        continue;
      }
      if(name==='propose_business_action'){
        const claims=verifyVapiActionToken(args.action_token);
        const call=await one("SELECT id,user_id,world_id,contact_id FROM calls WHERE id=$1 AND user_id=$2 AND status='active'",[claims.callId,claims.userId]);
        if(!call||call.contact_id!==claims.sourceContactId)throw new Error('This call session has ended. Please start a new call.');
        const user=await one('SELECT id,name FROM users WHERE id=$1',[call.user_id]);
        const request=await requestAction(user,claims.sourceContactId,{actionType:args.action_type,title:args.title,reason:args.reason,payload:objectArguments(args.payload),operationKey:claims.callId+':'+toolCallId});
        results.push({toolCallId,result:'Approval request submitted to the Chairman’s Approvals app. No action has been executed. Request: '+request.title+'. Wait for the Chairman’s decision.'});
        continue;
      }
      if(name!=='arrange_internal_call')throw new Error('This executive action is not available.');
      const claims=verifyVapiActionToken(args.action_token);
      const call=await one(
        "SELECT id,user_id,world_id,contact_id FROM calls WHERE id=$1 AND user_id=$2 AND status='active'",
        [claims.callId,claims.userId]
      );
      if(!call||call.contact_id!==claims.sourceContactId)throw new Error('This call session has ended. Please start a new call.');

      const recipient=typeof args.recipient==='string'?args.recipient.trim().slice(0,100):'';
      const reason=typeof args.reason==='string'?args.reason.slice(0,240):'';
      const detected=parseCallIntent(reason);
      if(detected?.clarification){
        results.push({toolCallId,result:detected.clarification});
        continue;
      }

      let delaySeconds;
      if(args.delaySeconds===undefined||args.delaySeconds===null){
        if(detected&&Number.isInteger(detected.delaySeconds))delaySeconds=detected.delaySeconds;
        else if(!recipient&&!/\b(now|immediately|right away|as soon as (?:this call )?ends)\b/i.test(reason)){
          results.push({toolCallId,result:'Please ask the Chairman when he would like you to call him back. No callback has been scheduled yet.'});
          continue;
        }else if(recipient&&/\b(later|soon|in a while|after lunch|this afternoon|tonight|tomorrow|at\s+\d)\b/i.test(reason)){
          results.push({toolCallId,result:'Please ask the Chairman for a precise time. No call has been scheduled yet.'});
          continue;
        }else delaySeconds=0;
      }else delaySeconds=Number(args.delaySeconds);

      if(!Number.isInteger(delaySeconds)||delaySeconds<0||delaySeconds>86400){
        throw new Error('Choose a callback time between now and 24 hours from now.');
      }

      const action=await scheduleExecutiveCall({
        userId:call.user_id,
        worldId:call.world_id,
        recipient:recipient||null,
        defaultContactId:claims.sourceContactId,
        delaySeconds,
        kind:recipient?'delegated-call':'assistant-callback',
        actionKey:claims.callId+':'+(recipient.toLowerCase()||'current-executive')+':'+delaySeconds,
        reason
      });
      results.push({toolCallId,result:describeSchedule(action,{selfCallback:!recipient})});
    }catch(error){
      console.error('[Vapi tools] tool execution failed',{name,toolCallId,error:String(error?.message||error).slice(0,240)});
      results.push({
        toolCallId,
        error:'I could not complete that action. '+String(error?.message||'Please try again.').replace(/[\r\n]+/g,' ').slice(0,350)
      });
    }
  }

  return Response.json({results});
}
