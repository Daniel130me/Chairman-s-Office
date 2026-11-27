import React from 'react';
export default function PwaSettings({pwa,onUpdate,lastSync}){
 return <div className="settings-group"><h3>App & connection</h3>
 <p className="settings-note">Mode: {pwa.installed?'Installed standalone app':'Browser'} · {pwa.online?'Network available':'Offline'} · App shell: {pwa.worker}</p>
 {lastSync&&<p className="settings-note">Last successful sync: {new Date(lastSync).toLocaleString()}</p>}
 {!pwa.installed&&(pwa.installPrompt?<button className="primary-btn" onClick={()=>pwa.install().catch(()=>{})}>Install Chairman’s Office</button>:<p className="settings-note">{pwa.ios?'Open in Safari, tap Share, then Add to Home Screen. Open the installed app to enable notifications.':'Open your browser menu and choose Install app or Add to Home Screen, if supported.'}</p>)}
 {pwa.update&&<button className="primary-btn" onClick={onUpdate}>Install available update</button>}
 {pwa.updateError&&<p role="alert">{pwa.updateError}</p>}
 <p className="settings-note">When disconnected, records already loaded in this session remain available as a dated view. No new business decisions or messages are queued offline; reconnect to submit them. Private records are not saved to persistent browser storage.</p>
 </div>;
}
