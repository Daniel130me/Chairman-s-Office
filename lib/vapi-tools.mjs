import {one} from '../backend/src/db.mjs';
import {scheduleExecutiveCall} from './call-workflow.mjs';
import {verifyVapiActionToken} from './vapi-action-token.mjs';
import {parseCallIntent} from './executive-intents.mjs';

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

function describeSchedule(action){
  const who=action.contact.name+' ('+action.contact.title+')';
  if(action.delaySeconds===0){
    return 'The incoming call from '+who+' has been created and is ready on the Chairman’s Office line. The Chairman must end the current call, if one is active, before answering the new call.';
  }
  const seconds=action.delaySeconds;
  const when=seconds<60?seconds+' seconds':seconds%60===0?(seconds/60)+' minutes':Math.floor(seconds/60)+' minutes and '+(seconds%60)+' seconds';
  return 'A callback from '+who+' has been scheduled for '+when+' from now. If the Chairman is still on another call when it becomes due, it will wait until that call ends.';
}

export async function handleVapiTools(request){
  let payload;
  try{payload=await request.json();}catch{
    return Response.json({results:[]});
  }

  const message=payload?.message||payload;
  if(message?.type!=='tool-calls')return Response.json({results:[]});

  const results=[];
  for(const item of toolCalls(message)){
    const toolCallId=item?.id||item?.toolCall?.id;
    if(!toolCallId)continue;
    const fn=item?.function||item?.toolCall?.function||{};
    const name=fn.name||item?.name;
    const args={...objectArguments(fn.arguments??fn.parameters??item?.arguments),...objectArguments(item?.parameters)};

    try{
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
      results.push({toolCallId,result:describeSchedule(action)});
    }catch(error){
      results.push({
        toolCallId,
        result:'I could not arrange that call. '+String(error?.message||'Please try again.').replace(/[\r\n]+/g,' ').slice(0,350)
      });
    }
  }

  return Response.json({results});
}
