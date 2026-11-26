export function buildMeetingPrompt({meetingTitle,empireName,person,attendees,history}){
 const people=(attendees||[]).filter(x=>x.id!==person.id).map(x=>x.name+' ('+x.title+')').join('; ');
 const discussion=(history||[]).map(x=>x.speaker+': '+x.message).join(' | ').slice(-6500);
 return 'Meeting: '+meetingTitle+'. Empire: '+empireName+'. You are '+person.name+', '+person.title+'. Your professional temperament: '+person.temperament+'. Your agenda: '+person.agenda+'. Other participants: '+people+'. Discussion so far: '+discussion+'. Respond directly to the latest point, including another executive’s argument when relevant. State your independent view, explain your reasoning, respectfully disagree where appropriate, cite only facts present in the discussion or your authorised business context, and offer one practical next step. Do not repeat another participant without adding analysis. Do not claim actions or votes that have not occurred. Speak in first person without a role prefix.';
}
