// Predictable intent detection for common executive call requests.
function requestedDelay(text){
  const match=text.match(/\b(?:in|after)\s+(\d{1,5})\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i)
    || text.match(/\b(\d{1,5})\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\s+(?:from now|later)\b/i);
  if(!match)return null;
  const amount=Number(match[1]);
  const unit=match[2].toLowerCase();
  const multiplier=unit.startsWith('h')?3600:unit.startsWith('m')?60:1;
  return amount*multiplier;
}

export function parseCallIntent(message){
  const text=String(message||'').trim();
  if(!text)return null;
  const delaySeconds=requestedDelay(text);
  if(delaySeconds!==null&&(!Number.isInteger(delaySeconds)||delaySeconds<0||delaySeconds>86400)){
    return {clarification:'I can arrange a call up to 24 hours ahead. What time would you prefer?'};
  }

  // Delegation takes priority: "ask the CFO to call me back" means the CFO calls.
  const delegation=text.match(/\b(?:ask|tell|have|get|request|arrange|i want|i need|can you get|could you get)\s+(?:the\s+|our\s+)?(.+?)\s+(?:to\s+)?(?:call|ring|phone)\s+me(?:\s+back)?\b/i);
  if(delegation){
    const recipient=delegation[1].replace(/^(?:the|our|group)\s+/i,'').trim();
    if(recipient)return {recipient,delaySeconds:delaySeconds??0,kind:'delegated-call'};
  }

  const callback=/\b(?:call|ring|phone)\s+me\s+back\b|\bget\s+back\s+to\s+me\b/i.test(text);
  const delayedSelf=/\b(?:call|ring|phone)\s+me\s+(?:again\s+)?(?:in|after)\s+\d/i.test(text);
  if(callback||delayedSelf){
    if(delaySeconds===null)return {clarification:'Of course. When would you like me to call you back?'};
    return {recipient:null,delaySeconds,kind:'assistant-callback'};
  }
  return null;
}
