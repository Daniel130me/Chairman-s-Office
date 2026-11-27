export function canAccessCharacterMemory({viewerContactId,viewerKind,ownerContactId,ownerKind,sensitivity}={}){
 if(viewerContactId&&ownerContactId&&viewerContactId===ownerContactId)return true;
 if(sensitivity==='public')return true;
 if(sensitivity==='internal')return viewerKind==='internal'&&ownerKind==='internal';
 return false;
}
