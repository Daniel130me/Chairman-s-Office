export function failedCallSummary(failureReason=''){
 const detail=String(failureReason||'').replace(/[\r\n]+/g,' ').trim().slice(0,220);
 return 'Voice connection failed before the conversation began. '+(detail?'Connection detail: '+detail+'. ':'')+'No transcript was captured; no decisions, commitments or follow-ups were made.';
}
