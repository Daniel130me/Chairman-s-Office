import {reserveProviderAttempt,finishProviderAttempt} from '../../lib/autonomous-ai-budget.mjs';
const definitions={
  groq:{url:'https://api.groq.com/openai/v1/chat/completions',model:'openai/gpt-oss-20b'},
  gemini:{model:'gemini-2.5-flash'},
  zai:{url:'https://api.z.ai/api/paas/v4/chat/completions',model:'glm-4.7-flash'},
  mistral:{url:'https://api.mistral.ai/v1/chat/completions',model:'mistral-small-latest'},
  openrouter:{url:'https://openrouter.ai/api/v1/chat/completions',model:'openai/gpt-4o-mini'},
  openai:{url:'https://api.openai.com/v1/chat/completions',model:'gpt-4.1-mini'}
};
const defaultOrder=['groq','mistral','openrouter','openai','gemini'];

// Explicit server-only references also work in bundlers that rewrite env access.
// Read at request time; never serialize a credential to a workflow argument.
function config(name){
  switch(name){
    case 'groq':return {key:process.env.GROQ_API_KEY,model:process.env.GROQ_MODEL};
    case 'gemini':return {key:process.env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL};
    case 'zai':return {key:process.env.ZAI_API_KEY,model:process.env.ZAI_MODEL};
    case 'mistral':return {key:process.env.MISTRAL_API_KEY,model:process.env.MISTRAL_MODEL};
    case 'openrouter':return {key:process.env.OPENROUTER_API_KEY,model:process.env.OPENROUTER_MODEL};
    case 'openai':return {key:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL};
    default:return {};
  }
}
export function providerOrder(){
  const configured=process.env.AI_ORDER;
  const names=(configured?configured.split(','):defaultOrder).map(x=>x.trim().toLowerCase()).filter(x=>Object.hasOwn(definitions,x));
  return [...new Set(names)];
}
export function aiStatus(){
  return providerOrder().map(name=>{
    const c=config(name);
    return {name,model:c.model||definitions[name].model,configured:!!c.key?.trim()};
  });
}
export function parseOutput(value,json){
  if(typeof value!=='string'||!value.trim())return null;
  if(!json)return value.trim();
  try{return JSON.parse(value.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi,'').trim());}
  catch{return null;}
}
async function requestGemini(system,prompt,signal,json,c,dispatch){
  const model=c.model||definitions.gemini.model;
  const payload={systemInstruction:{parts:[{text:system}]},contents:[{parts:[{text:prompt}]}]};
  if(json)payload.generationConfig={responseMimeType:'application/json'};
  const response=await dispatch(()=>fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':c.key},
    body:JSON.stringify(payload),signal
  }));
  if(!response.ok){console.warn('AI provider HTTP status','gemini',response.status);return null;}
  const parts=(await response.json()).candidates?.[0]?.content?.parts||[];
  return parts.filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join('')||null;
}
async function requestCompatible(name,system,prompt,signal,json,c,dispatch){
  const provider=definitions[name];
  const payload={model:c.model||provider.model,
    messages:[{role:'system',content:system},{role:'user',content:prompt}],temperature:json?0.3:0.78,max_tokens:json?1800:850};
  if(name==='zai')payload.thinking={type:'disabled'};
  // Native JSON mode when supported; gateways/models may reject it, in which
  // case retry once without that optional field under the same time budget.
  if(json&&['groq','mistral','openrouter','openai'].includes(name))payload.response_format={type:'json_object'};
  const send=()=>dispatch(()=>fetch(provider.url,{method:'POST',headers:{'Authorization':'Bearer '+c.key,'Content-Type':'application/json'},body:JSON.stringify(payload),signal}));
  let response=await send();
  if([400,422].includes(response.status)&&payload.response_format){
    delete payload.response_format;
    response=await send();
  }
  if(!response.ok){console.warn('AI provider HTTP status',name,response.status);return null;}
  return (await response.json()).choices?.[0]?.message?.content||null;
}
export async function ask(system,prompt,{fallback='',json=false,validate}={}){
  const order=providerOrder();
  let attempted=0;
  for(const name of order){
    const c=config(name);
    if(!c.key?.trim()){console.warn('AI provider not configured',name);continue;}
    attempted++;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),14000);
    let ticket=null,outputCharacters=0,success=false;
    const dispatch=async fn=>{if(ticket)await finishProviderAttempt(ticket,0,false);ticket=await reserveProviderAttempt(name,system.length+prompt.length);return fn();};
    try{
      const value=name==='gemini'
        ?await requestGemini(system,prompt,controller.signal,json,c,dispatch)
        :await requestCompatible(name,system,prompt,controller.signal,json,c);
      outputCharacters=typeof value==='string'?value.length:0;
      const parsed=parseOutput(value,json);
      if(parsed!==null){
        // Semantically unusable JSON must not block the next provider.
        const result=validate?validate(parsed):parsed;
        if(result!==null&&result!==undefined&&result!==false){success=true;return result;}
      }
      console.warn('AI provider unusable output',name,json?'json':'text');
    }catch(error){
      if(error.code==='AUTONOMY_LIMIT')throw error;
      console.warn('AI provider fallback',name,error.name||'Error');
    }finally{clearTimeout(timeout);await finishProviderAttempt(ticket,outputCharacters,success).catch(error=>console.warn('AI usage result accounting',error.code||error.name));}
  }
  console.warn('AI providers exhausted',order.join(','),'attempted',attempted);
  return fallback;
}
