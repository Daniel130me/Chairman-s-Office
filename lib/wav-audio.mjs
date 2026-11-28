export function normalizeWavForPlayback(input){
 if(!input)return null;
 const bytes=Buffer.from(input);
 if(bytes.length<44||bytes.length>2*1024*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')return null;
 let offset=12,format=null,dataOffset=-1,dataLength=0,channels=0,sampleRate=0,bits=0,blockAlign=0;
 while(offset+8<=bytes.length){
  const id=bytes.toString('ascii',offset,offset+4);
  const size=bytes.readUInt32LE(offset+4);
  const start=offset+8,remaining=bytes.length-start;
  if(id==='fmt '){
   if(size<16||size>remaining)return null;
   format=bytes.readUInt16LE(start);
   channels=bytes.readUInt16LE(start+2);
   sampleRate=bytes.readUInt32LE(start+4);
   blockAlign=bytes.readUInt16LE(start+12);
   bits=bytes.readUInt16LE(start+14);
  }
  if(id==='data'){
   dataOffset=offset+4;
   dataLength=size===0xffffffff||size>remaining?remaining:size;
   if(size===0xffffffff||size>remaining)bytes.writeUInt32LE(dataLength,dataOffset);
   break;
  }
  if(size===0xffffffff||size>remaining)return null;
  offset=start+size+(size&1);
 }
 if(format!==1||dataOffset<0||!channels||channels>2||sampleRate<8000||sampleRate>48000||![16,24,32].includes(bits))return null;
 const expectedAlign=channels*(bits/8);
 if(blockAlign!==expectedAlign||dataLength<blockAlign*2||dataLength%blockAlign!==0)return null;
 bytes.writeUInt32LE(bytes.length-8,4);
 return bytes;
}
