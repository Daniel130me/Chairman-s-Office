const clean=(value,max=180)=>String(value??'').replace(/\s+/g,' ').trim().replace(/bearer\s+[a-z0-9._-]+/ig,'Bearer [redacted]').replace(/\b(?:api[_ -]?key|token|authorization)\s*[:=]\s*\S+/ig,'credential=[redacted]').replace(/https?:\/\/\S+/ig,'[URL]').slice(0,max);
export function formatVapiStage(stage){
 const key=String(stage||'').toLowerCase();
 const labels={
  initialization:'Preparing voice session',
  'input-validation':'Checking voice configuration',
  'microphone-preflight':'Requesting microphone access',
  'mobile-permissions':'Checking microphone permissions',
  'web-call-creation':'Creating Vapi call session',
  'daily-call-object-creation':'Preparing live audio',
  'daily-call-join':'Connecting live audio',
  'audio-processing-setup':'Preparing audio processing',
  connected:'Live voice connected',
  configuration:'Checking Vapi configuration'
 };
 return labels[key]||('Connecting · '+String(stage||'voice service').replace(/[-_]+/g,' '));
}
export function describeVapiFailure(event={}){
 const nested=event?.error;
 const detail=clean(typeof nested==='string'?nested:nested?.message||nested?.error||event?.message||event?.description||'');
 const type=clean(event?.type||nested?.type||nested?.code||nested?.name||'voice-error',80);
 const stage=clean(event?.stage||nested?.stage||event?.context?.stage||'',80);
 const combined=(type+' '+stage+' '+detail).toLowerCase();
 const recoverable=/audio-processing-setup-error|local-audio-level-observer-error|audio-level-observer/.test(combined);
 let userMessage='Vapi could not establish the live voice connection'+(stage?' during '+formatVapiStage(stage).toLowerCase():'')+'. Please try again.';
 if(/microphone|notallowederror|permissiondeniederror|customer-did-not-give-microphone-permission/.test(combined)){
  userMessage='Microphone access is blocked. Allow microphone access for Chairman’s Office in your browser or device settings, then answer the call again.';
 }else if(/assistant-not-found|error-get-assistant|assistant-not-valid/.test(combined)){
  userMessage='Vapi could not load the configured assistant. The assistant ID or its configuration needs to be checked in Vapi.';
 }else if(/unauthorized|invalid.*(public )?key|error-get-org|\b401\b/.test(combined)){
  userMessage='Vapi rejected the public API key. The production Vapi credentials need to be checked.';
 }else if(/insufficient-credits|subscription-frozen|wallet-does-not-exist|concurrency-limit/.test(combined)){
  userMessage='Vapi could not start the call because of an account, credit or concurrency limit. Check the Vapi account status.';
 }else if(/network|transport|websocket|failed to fetch|daily-call-join|connection-timeout/.test(combined)){
  userMessage='Vapi could not establish the audio connection. Check your internet connection and try again.';
 }else if(recoverable){
  userMessage='The call has a non-fatal audio-monitoring warning. The voice conversation can continue.';
 }else if(detail){
  userMessage='Vapi connection failed'+(stage?' during '+formatVapiStage(stage).toLowerCase():'')+': '+detail.slice(0,120);
 }
 const summary=[stage||'connection',type,detail].filter(Boolean).join(' — ').slice(0,240);
 return {type,stage,detail,userMessage,summary,recoverable};
}
