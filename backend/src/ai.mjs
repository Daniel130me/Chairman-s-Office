const definitions={
  groq:{key:'GROQ_API_KEY',url:'https://api.groq.com/openai/v1/chat/completions',model:'openai/gpt-oss-20b'},
  gemini:{key:'GEMINI_API_KEY',model:'gemini-2.5-flash'},
  zai:{key:'ZAI_API_KEY',url:'https://api.z.ai/api/paas/v4/chat/completions',model:'glm-4.7-flash'},
  mistral:{key:'MISTRAL_API_KEY',url:'https://api.mistral.ai/v1/chat/completions',model:'mistral-small-latest'},
  openrouter:{key:'OPENROUTER_API_KEY',url:'https://openrouter.ai/api/v1/chat/completions',model:'openai/gpt-4o-mini'},
  openai:{key:'OPENAI_API_KEY',url:'https://api.openai.com/v1/chat/completions',model:'gpt-4.1-mini'}
};
const defaultOrder=['groq','mistral','openrouter','openai','gemini'];

export function providerOrder(){
  const configured=process.env.AI_ORDER;
  const names=(configured?configured.split(','):defaultOrder).map(x=>x.trim().toLowerCase()).filter(x=>Object.hasOwn(definitions,x));
  return [...new Set(names)];
}
export function aiStatus(){
  return providerOrder().map(name=>{
    const provider=definitions[name];
    return {name,model:process.env[`${name.toUpperCase()}_MODEL`]||provider.model,configured:!!process.env[provider.key]};
  });
}
function parseOutput(value,json){
  if(typeof value!=='string'||!value.trim())return null;
  if(!json)return value.trim();
  try{return JSON.parse(value.replace(/^```(?:json)?\s*|\s*```$/g,'').trim());}
  catch{return null;}
}
async function requestGemini(system,prompt,signal){
  const model=process.env.GEMINI_MODEL||definitions.gemini.model;
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{parts:[{text:prompt}]}]}),signal
  });
  if(!response.ok){console.warn('AI provider HTTP status','gemini',response.status);return null;}
  return (await response.json()).candidates?.[0]?.content?.parts?.[0]?.text||null;
}
async function requestCompatible(name,system,prompt,signal){
  const provider=definitions[name];
  const payload={model:process.env[`${name.toUpperCase()}_MODEL`]||provider.model,
    messages:[{role:'system',content:system},{role:'user',content:prompt}],temperature:0.78,max_tokens:850};
  // GLM-4.7-Flash supports disabling its reasoning mode for faster conversational responses.
  if(name==='zai')payload.thinking={type:'disabled'};
  const response=await fetch(provider.url,{
    method:'POST',headers:{'Authorization':`Bearer ${process.env[provider.key]}`,'Content-Type':'application/json'},
    body:JSON.stringify(payload),signal
  });
  if(!response.ok){console.warn('AI provider HTTP status',name,response.status);return null;}
  return (await response.json()).choices?.[0]?.message?.content||null;
}
export async function ask(system,prompt,{fallback='',json=false}={}){
  for(const name of providerOrder()){
    const provider=definitions[name];
    if(!process.env[provider.key])continue;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),14000);
    try{
      const value=name==='gemini'
        ?await requestGemini(system,prompt,controller.signal)
        :await requestCompatible(name,system,prompt,controller.signal);
      const parsed=parseOutput(value,json);
      if(parsed!==null)return parsed;
      console.warn('AI provider unusable output',name,json?'json':'text');
    }catch(error){
      console.warn('AI provider fallback',name,error.name||'Error');
    }finally{clearTimeout(timeout);}
  }
  console.warn('AI providers exhausted',providerOrder().join(','));
  return fallback;
}
