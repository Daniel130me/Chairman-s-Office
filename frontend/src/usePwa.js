import {useEffect,useRef,useState} from 'react';
export function usePwa(){
 const [online,setOnline]=useState(true),[visible,setVisible]=useState(true),[installed,setInstalled]=useState(false),[installPrompt,setInstallPrompt]=useState(null),[ios,setIos]=useState(false),[worker,setWorker]=useState('checking'),[update,setUpdate]=useState(false),[updateError,setUpdateError]=useState('');
 const registration=useRef(null),requested=useRef(false),updateTimer=useRef(null);
 useEffect(()=>{
  let active=true,cleanup=[],watched=new Set();
  const listen=(target,type,fn)=>{target.addEventListener(type,fn);cleanup.push(()=>target.removeEventListener(type,fn));};
  const display=window.matchMedia('(display-mode: standalone)');
  const mode=()=>setInstalled(display.matches||navigator.standalone===true);
  const connection=()=>{setOnline(navigator.onLine!==false);setVisible(document.visibilityState==='visible');};
  mode();connection();setIos(/iPad|iPhone|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1));
  listen(window,'online',connection);listen(window,'offline',connection);listen(window,'pageshow',connection);listen(document,'visibilitychange',connection);
  if(display.addEventListener)listen(display,'change',mode);
  listen(window,'beforeinstallprompt',e=>{e.preventDefault();setInstallPrompt(e);});
  listen(window,'appinstalled',()=>{setInstalled(true);setInstallPrompt(null);});
  if(!('serviceWorker' in navigator)){setWorker('unsupported');return()=>cleanup.forEach(f=>f());}
  const sw=navigator.serviceWorker;
  const change=()=>{if(requested.current){requested.current=false;clearTimeout(updateTimer.current);window.location.reload();}};
  listen(sw,'controllerchange',change);
  let checkedAt=0;const check=()=>{if(document.visibilityState==='visible'&&navigator.onLine!==false&&Date.now()-checkedAt>60000){checkedAt=Date.now();registration.current?.update().catch(()=>{});}};
  listen(window,'online',check);listen(window,'pageshow',check);listen(document,'visibilitychange',check);
  const watch=reg=>{
   if(!active)return;
   registration.current=reg;setWorker(reg.active?'ready':'installing');
   const inspect=()=>{
    if(!active)return;
    setUpdate(!!(reg.waiting&&sw.controller));
    if(reg.active)setWorker('ready');
    const installing=reg.installing;
    if(installing&&!watched.has(installing)){watched.add(installing);listen(installing,'statechange',inspect);}
   };
   listen(reg,'updatefound',inspect);inspect();const timer=setInterval(check,30*60*1000);cleanup.push(()=>clearInterval(timer));
  };
  sw.register('/sw.js',{updateViaCache:'none'}).then(watch).catch(()=>{if(active)setWorker('failed');});
  return()=>{active=false;cleanup.forEach(f=>f());clearTimeout(updateTimer.current);};
 },[]);
 async function install(){if(!installPrompt)return;try{await installPrompt.prompt();await installPrompt.userChoice;}finally{setInstallPrompt(null);}}
 function applyUpdate(){
  const waiting=registration.current?.waiting;if(!waiting){setUpdate(false);return;}
  requested.current=true;setUpdateError('');
  try{waiting.postMessage({type:'ACTIVATE_UPDATE'});updateTimer.current=setTimeout(()=>{requested.current=false;setUpdateError('Update did not activate. Reopen the office and try again.');},15000);}catch{requested.current=false;setUpdateError('Update could not be started. Try again.');}
 }
 return {online,visible,installed,installPrompt:!!installPrompt,ios,worker,update,updateError,install,applyUpdate};
}
