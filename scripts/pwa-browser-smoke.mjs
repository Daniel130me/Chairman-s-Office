// Real Chromium lifecycle smoke against the built app. All account and business API calls
// are intercepted with a fictional fixture. No credentials, AI calls or production data.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
const require=createRequire(process.env.PWA_PLAYWRIGHT_PACKAGE||import.meta.url);
const {chromium}=require('playwright');
const port=3417,base='http://127.0.0.1:'+port;
const next=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'-H','127.0.0.1'],{stdio:['ignore','pipe','pipe'],env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'}});
let browser,context;let serverOutput='';next.stdout.on('data',d=>serverOutput=(serverOutput+d).slice(-8000));next.stderr.on('data',d=>serverOutput=(serverOutput+d).slice(-8000));
const diagnostics={failedRequests:[],pageErrors:[],consoleErrors:[],navigationResponses:[]};
try{
 let ready=false;for(let i=0;i<90;i++){if(next.exitCode!==null)break;try{const r=await fetch(base+'/manifest.webmanifest');if(r.ok){ready=true;break;}}catch{}await sleep(500);}assert.ok(ready,'Next server failed: '+serverOutput);
 const manifest=await (await fetch(base+'/manifest.webmanifest')).json();assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');assert.ok(manifest.icons.some(i=>i.sizes==='192x192'));assert.ok(manifest.icons.some(i=>i.sizes==='512x512'));
 browser=await chromium.launch({headless:true});context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'allow'});
 const user={id:'11111111-1111-4111-8111-111111111111',name:'PWA Test',email:'fixture@example.invalid'};
 const state={world:{id:'22222222-2222-4222-8222-222222222222',name:'PWA smoke empire',region:'Test region'},contacts:[],invites:[],threads:[],events:[],companies:[],meetings:[],messages:[],documents:[],settings:{theme:'dark',quiet_enabled:false,max_daily:4},operations:{}};
 let failBoot=true,stateRequests=0;
 await context.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let payload={ok:true},status=200;
  if(path==='/api/state'){stateRequests++;if(failBoot){status=503;payload={error:'Test connection unavailable'};}else payload={user,state};}
  else if(path==='/api/invites/pending')payload={invites:[]};
  else if(path==='/api/providers')payload={providers:[]};
  else if(path==='/api/push/status')payload={devices:0,configured:false};
  await route.fulfill({status,contentType:'application/json',headers:{'Cache-Control':'private, no-store'},body:JSON.stringify(payload)});
 });
 const page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('requestfailed',request=>{if(request.url().startsWith(base))diagnostics.failedRequests.push({url:request.url(),failure:request.failure()?.errorText});});
 page.on('pageerror',error=>diagnostics.pageErrors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')diagnostics.consoleErrors.push(message.text());});
 page.on('response',response=>{if(response.request().isNavigationRequest())diagnostics.navigationResponses.push({url:response.url(),status:response.status()});});
 await page.goto(base);await page.getByText('OFFICE CONNECTION',{exact:true}).waitFor();
 failBoot=false;await page.getByRole('button',{name:'Reconnect',exact:true}).click();
 await page.getByText('PWA smoke empire',{exact:true}).waitFor();
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:30000});
 await page.waitForFunction(async()=>{const names=await caches.keys();if(!names.includes('chairmans-office-v5'))return false;const cache=await caches.open('chairmans-office-v5');return !!await cache.match('/offline.html');},{},{timeout:30000});
 const box=await page.locator('.phone-screen').boundingBox();assert.ok(box.width<=390.5&&box.height<=844.5);
 await context.setOffline(true);await page.getByText('Offline · previously loaded records only',{exact:false}).waitFor();
 await page.getByText('PWA smoke empire',{exact:true}).waitFor();
 await page.reload({waitUntil:'domcontentloaded'}).catch(()=>null);
 const coldOfflineBody=await page.locator('body').innerText();
 const safeOffline=coldOfflineBody.includes('Your office is temporarily unreachable.')||(coldOfflineBody.includes('OFFICE CONNECTION')&&coldOfflineBody.includes('Reconnect before sending requests.'));
 assert.ok(safeOffline,'Cold offline navigation must show a safe connection screen. Body: '+coldOfflineBody.slice(0,1000));
 assert.ok(!coldOfflineBody.includes('PWA smoke empire'),'Private world data must not survive a cold offline reload.');
 // Verify the explicit public offline shell is also available from the service-worker cache.
 await page.goto(base+'/offline.html',{waitUntil:'domcontentloaded'}).catch(()=>null);
 await page.getByText('Your office is temporarily unreachable.',{exact:false}).waitFor();
 await context.setOffline(false);
 const retry=page.getByRole('button',{name:'Try again',exact:true});
 if(await retry.isVisible().catch(()=>false))await retry.click();
 await page.getByText('PWA smoke empire',{exact:true}).waitFor().catch(async()=>{throw new Error('Automatic reconnect did not restore the office. Server: '+serverOutput+' Diagnostics: '+JSON.stringify(diagnostics)+' Body: '+(await page.locator('body').innerText()).slice(0,1000));});
 await page.waitForLoadState('networkidle');
 let settingsResponse=null;
 try{settingsResponse=await page.goto(base+'/?app=settings',{waitUntil:'domcontentloaded'});}catch(error){throw new Error('Settings deep link navigation failed: '+error.message+'; server: '+serverOutput+'; diagnostics: '+JSON.stringify(diagnostics));}
 await page.getByText('App & connection',{exact:true}).waitFor().catch(async()=>{const details=await page.evaluate(()=>({online:navigator.onLine,controlled:!!navigator.serviceWorker.controller,url:location.href,ready:document.readyState}));throw new Error('Settings deep link did not restore after reconnect. '+JSON.stringify(details)+' Response: '+(settingsResponse?.status()??'none')+' Server: '+serverOutput+' Diagnostics: '+JSON.stringify(diagnostics)+' Body: '+(await page.locator('body').innerText()).slice(0,1000));});
 await page.getByText('Private records are not saved to persistent browser storage.',{exact:false}).waitFor();
 const keys=await page.evaluate(async()=>{const result=[];for(const name of await caches.keys()){if(!name.startsWith('chairmans-office-'))continue;const cache=await caches.open(name);for(const req of await cache.keys())result.push(new URL(req.url).pathname);}return result;});
 assert.ok(keys.includes('/offline.html'));assert.ok(keys.every(p=>p.startsWith('/_next/static/')||['/offline.html','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/manifest.webmanifest'].includes(p)));assert.ok(stateRequests>=2);
 await page.setViewportSize({width:360,height:480});const small=await page.locator('.phone-screen').boundingBox();assert.ok(small.height<=480.5,'Small phone viewport must not overflow');
 console.log('PWA browser smoke passed: recoverable startup, mobile sizing, offline session, cold offline shell, reconnect, deep link, public-only caches.');
}finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});next.kill();}
