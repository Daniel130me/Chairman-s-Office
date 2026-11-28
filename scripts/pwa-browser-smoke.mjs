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
 const state={world:{id:'22222222-2222-4222-8222-222222222222',name:'PWA smoke empire',region:'Test region'},contacts:[{id:'44444444-4444-4444-8444-444444444444',name:'Test Executive',title:'Chief of Staff',kind:'internal',company:'PWA smoke empire'}],invites:[],threads:[],events:[],companies:[{id:'55555555-5555-4555-8555-555555555555',name:'PWA validation company with a deliberately long name',sector:'Technology',cash:1000,revenue:0,valuation:1000}],meetings:[],messages:[],documents:[{id:'33333333-3333-4333-8333-333333333333',title:'Formatting fixture',kind:'executive brief',created_at:'2026-11-27T12:00:00Z',body:'**Decision brief**\n<table onclick="window.__formattingUnsafe=true"><tr><th>Option</th><th>Potential Gains</th><th>Risks</th></tr><tr><td>Acquire PulseWave</td><td>- Immediate access<br>- Cross-sell opportunities</td><td>Integration delays</td></tr></table>\n**Recommendation:** Review first.'}],settings:{theme:'dark',quiet_enabled:false,max_daily:4},operations:{}};
 let failBoot=true,stateRequests=0,investigationRequests=0,failInvestigation=true;
 await context.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let payload={ok:true},status=200;
  if(path==='/api/state'){stateRequests++;if(failBoot){status=503;payload={error:'Test connection unavailable'};}else payload={user,state};}
  else if(path==='/api/investigations'&&route.request().method()==='POST'){investigationRequests++;const body=route.request().postDataJSON();assert.equal(body.title,'Fixture investigation');assert.equal(body.allegation,'Evidence needs review.');if(failInvestigation){status=409;payload={error:'Fixture validation error'};}else payload={case:{id:'fixture-case'}};}
  else if(path==='/api/invites/pending')payload={invites:[]};
  else if(path==='/api/providers')payload={providers:[]};
  else if(path==='/api/push/status')payload={devices:0,configured:false};
  else if(path==='/api/engine/status')payload={health:'healthy',engine:{revision:22,expectedRevision:22,active:true,lastTickAt:null},world:{lastCheckedAt:null},external:{signalsAt:null,newsAt:null},stages:[]};
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
 await page.waitForFunction(async()=>{const names=await caches.keys();if(!names.includes('chairmans-office-v6'))return false;const cache=await caches.open('chairmans-office-v6');return !!await cache.match('/offline.html');},{},{timeout:30000});
 const box=await page.locator('.phone-screen').boundingBox();assert.ok(box.width<=390.5&&box.height<=844.5);
 await context.setOffline(true);await page.getByText('Offline · previously loaded records only',{exact:false}).waitFor();
 await page.getByText('PWA smoke empire',{exact:true}).waitFor();
 // Use a real navigation (rather than browser reload) so the service worker must
 // return its public offline document when the network request cannot complete.
 await page.goto(base+'/?app=settings',{waitUntil:'domcontentloaded'}).catch(()=>null);
 await page.waitForFunction(()=>{const body=document.body.innerText;return body.includes('Your office is temporarily unreachable.')||(body.includes('OFFICE CONNECTION')&&body.includes('Reconnect before sending requests.'));},{},{timeout:20000}).catch(async()=>{const details=await page.evaluate(()=>({online:navigator.onLine,controlled:!!navigator.serviceWorker.controller,url:location.href,ready:document.readyState}));throw new Error('Cold offline navigation did not show a safe connection screen. '+JSON.stringify(details)+' Body: '+(await page.locator('body').innerText()).slice(0,1000));});
 const coldOfflineBody=await page.locator('body').innerText();
 assert.ok(!coldOfflineBody.includes('PWA smoke empire'),'Private world data must not survive a cold offline navigation.');
 const offlineShell=await page.evaluate(async()=>{const cache=await caches.open('chairmans-office-v6');const response=await cache.match('/offline.html');return response?await response.text():'';});
 assert.ok(offlineShell.includes('Your office is temporarily unreachable.'),'Public offline document must be present in the service-worker cache.');
 await context.setOffline(false);
 const retry=page.getByRole('button',{name:/Try again|Reconnect/});
 if(await retry.isVisible().catch(()=>false))await retry.click();
 await page.getByText('PWA smoke empire',{exact:true}).waitFor().catch(async()=>{throw new Error('Automatic reconnect did not restore the office. Server: '+serverOutput+' Diagnostics: '+JSON.stringify(diagnostics)+' Body: '+(await page.locator('body').innerText()).slice(0,1000));});
 await page.waitForLoadState('networkidle');
 let settingsResponse=null;
 try{settingsResponse=await page.goto(base+'/?app=settings',{waitUntil:'domcontentloaded'});}catch(error){throw new Error('Settings deep link navigation failed: '+error.message+'; server: '+serverOutput+'; diagnostics: '+JSON.stringify(diagnostics));}
 await page.getByText('App & connection',{exact:true}).waitFor().catch(async()=>{const details=await page.evaluate(()=>({online:navigator.onLine,controlled:!!navigator.serviceWorker.controller,url:location.href,ready:document.readyState}));throw new Error('Settings deep link did not restore after reconnect. '+JSON.stringify(details)+' Response: '+(settingsResponse?.status()??'none')+' Server: '+serverOutput+' Diagnostics: '+JSON.stringify(diagnostics)+' Body: '+(await page.locator('body').innerText()).slice(0,1000));});
 assert.equal(diagnostics.pageErrors.length,0,'Settings and PWA must not throw runtime errors: '+JSON.stringify(diagnostics.pageErrors));
 await page.getByText('Private records are not saved to persistent browser storage.',{exact:false}).waitFor();
 await page.goto(base+'/?app=documents',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:/Formatting fixture/}).click();
 const report=page.locator('.document-rich-text');
 await report.getByRole('table').waitFor();
 assert.equal(await report.getByRole('columnheader').count(),3);
 assert.equal(await report.getByRole('listitem').count(),2);
 assert.ok((await report.getByRole('cell',{name:'Integration delays'}).innerText()).includes('Integration delays'));
 assert.equal(await report.locator('[onclick]').count(),0);
 assert.ok(!(await report.innerText()).includes('<table>'));
 await report.getByRole('table').click();
 assert.equal(await page.evaluate(()=>!!window.__formattingUnsafe),false);
 // Exercise the actual selected form on narrow and normal phone widths.
 await page.goto(base+'/?app=investigations',{waitUntil:'domcontentloaded'});
 const caseForm=page.locator('form.form-card').filter({hasText:'Open a case'});
 await caseForm.getByRole('button',{name:'Open investigation'}).waitFor();
 await caseForm.getByRole('button',{name:'Open investigation'}).click();
 assert.equal(investigationRequests,0,'Missing required fields must not reach the API');
 for(const width of [320,360,390]){
  await page.setViewportSize({width,height:844});
  const geometry=await caseForm.evaluate(el=>{const container=el.getBoundingClientRect();return [...el.querySelectorAll('label>input,label>select,label>textarea')].map(f=>{const r=f.getBoundingClientRect(),label=f.parentElement.getBoundingClientRect(),style=getComputedStyle(f);return {width:r.width,labelWidth:label.width,height:r.height,left:r.left,right:r.right,containerLeft:container.left,containerRight:container.right,fontSize:parseFloat(style.fontSize),display:style.display};});});
  assert.equal(geometry.length,4);
  for(const field of geometry){assert.ok(field.width>=field.labelWidth-1&&field.right<=field.containerRight+1&&field.left>=field.containerLeft-1,'Fields must fit their card at '+width);assert.ok(field.height>=44&&field.fontSize>=16&&field.display==='block','Field must be usable on mobile');}
 }
 await caseForm.getByLabel('Case title').fill('Fixture investigation');
 await caseForm.getByLabel('Concern or allegation').fill('Evidence needs review.');
 await caseForm.getByRole('button',{name:'Open investigation'}).click();
 await caseForm.getByRole('alert').filter({hasText:'Fixture validation error'}).waitFor();
 assert.equal(await caseForm.getByLabel('Case title').inputValue(),'Fixture investigation','Failed submissions retain draft');
 failInvestigation=false;await caseForm.getByRole('button',{name:'Open investigation'}).click();
 await page.waitForFunction(()=>document.querySelector('form.form-card input')?.value==='');
 assert.equal(investigationRequests,2);
 // Calendar exercises date inputs and chip buttons without submitting live data.
 await page.goto(base+'/?app=calendar',{waitUntil:'domcontentloaded'});
 await page.locator('.app-header button.icon-circle').last().click();
 const schedule=page.locator('form.form-card').filter({hasText:'Schedule a boardroom meeting'});
 await schedule.getByLabel('Meeting title').waitFor();
 const attendee=schedule.getByRole('button',{name:'Test Executive'});
 await attendee.click();assert.equal(await attendee.getAttribute('aria-pressed'),'true');
 await schedule.getByRole('button',{name:'Cancel',exact:true}).click();await schedule.waitFor({state:'detached'});
 assert.equal(diagnostics.pageErrors.length,0,'Form checks must not throw runtime errors');
 const keys=await page.evaluate(async()=>{const result=[];for(const name of await caches.keys()){if(!name.startsWith('chairmans-office-'))continue;const cache=await caches.open(name);for(const req of await cache.keys())result.push(new URL(req.url).pathname);}return result;});
 assert.ok(keys.includes('/offline.html'));assert.ok(keys.every(p=>p.startsWith('/_next/static/')||['/offline.html','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/manifest.webmanifest'].includes(p)));assert.ok(stateRequests>=2);
 await page.setViewportSize({width:360,height:480});const small=await page.locator('.phone-screen').boundingBox();assert.ok(small.height<=480.5,'Small phone viewport must not overflow');
 console.log('PWA browser smoke passed: recoverable startup, mobile sizing, offline session, cold offline shell, reconnect, deep link, public-only caches.');
}finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});next.kill();}
