import {refreshRealWorldSignals} from '../lib/real-world-signals.mjs';
export async function realWorldRefreshWorkflow(userId){
 "use workflow";
 return await refreshStep(userId);
}
async function refreshStep(userId){
 "use step";
 return refreshRealWorldSignals(userId);
}
