// Choose the next fictional participant after the most recent character response.
// Chairman messages do not reset the round-robin order.
export function nextConversationParticipant(participants,history=[]){
 if(!Array.isArray(participants)||participants.length===0)return null;
 if(participants.length===1)return participants[0];
 const ids=new Set(participants.map(p=>p.contact_id));
 const previous=[...history].reverse().find(message=>message?.sender_contact_id&&ids.has(message.sender_contact_id));
 if(!previous)return participants[0];
 const index=participants.findIndex(p=>p.contact_id===previous.sender_contact_id);
 return participants[(index<0?0:index+1)%participants.length];
}
