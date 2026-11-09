import React, {useEffect, useRef, useState} from 'react';
import Vapi from '@vapi-ai/web';

const PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY;
const ASSISTANT_ID = import.meta.env.VITE_VAPI_ASSISTANT_ID;
const STORAGE = 'chairmans-office-local-note-v1';

function getStoredNote() {
  try { return localStorage.getItem(STORAGE) ?? ''; } catch { return ''; }
}

export default function App() {
  const [screen, setScreen] = useState('home'); // home, ringing, connecting, live, finished
  const [status, setStatus] = useState('Ready for your executive briefing');
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([]);
  const [note, setNote] = useState(getStoredNote);
  const [draft, setDraft] = useState(getStoredNote);
  const [seconds, setSeconds] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const vapiRef = useRef(null);
  const ringRef = useRef(null);
  const clockRef = useRef(null);
  const previousScreen = useRef('home');

  function stopTone() {
    if (ringRef.current) {
      clearInterval(ringRef.current.interval);
      try {ringRef.current.ctx.close();} catch{}
      ringRef.current = null;
    }
  }
  function ringTone() {
    stopTone();
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const bell = () => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 0.35);
      };
      bell(); const interval = setInterval(bell, 1000);
      ringRef.current = {ctx, interval};
    } catch { /* visible ringing screen still works without audio permission */ }
  }
  useEffect(()=>{ previousScreen.current=screen; },[screen]);
  useEffect(()=>()=>{ stopTone(); try{vapiRef.current?.stop();}catch{} },[]);
  useEffect(()=> {
    if (screen !== 'live') return;
    const t = setInterval(()=>setSeconds(v=>v+1),1000);
    return ()=>clearInterval(t);
  },[screen]);
  useEffect(()=>{
    if (countdown === null) return;
    if (countdown <= 0) {setCountdown(null); setScreen('ringing'); ringTone();return;}
    const t=setTimeout(()=>setCountdown(v=>v-1),1000);return ()=>clearTimeout(t);
  },[countdown]);

  function startRinging(){setError('');setMessages([]);setSeconds(0);setScreen('ringing');ringTone();}
  function dismiss(){stopTone();setScreen('home');setCountdown(null);}
  function saveNote(){const n=draft.trim().slice(0,1500);localStorage.setItem(STORAGE,n);setNote(n);setStatus('Your fictional executive note is saved locally.');}

  async function answer() {
    stopTone(); setScreen('connecting'); setError('');
    if (!PUBLIC_KEY || !ASSISTANT_ID) {
      setError('Configure VITE_VAPI_PUBLIC_KEY and VITE_VAPI_ASSISTANT_ID in frontend/.env first.');
      setScreen('ringing');return;
    }
    let sdk;
    try {
      sdk = new Vapi(PUBLIC_KEY);
      vapiRef.current = sdk;
      sdk.on('call-start',()=>{
        setScreen('live');setStatus('Connected to Amara');
        // Small local proof of continuity. For production, inject trusted context at call start from the backend.
        if(note) sdk.send({type:'add-message', message:{role:'system',content:'Executive memory note from the previous fictional meeting: '+note}, triggerResponseEnabled:false});
      });
      sdk.on('call-end',()=>{setScreen('finished');setStatus('Executive briefing ended');});
      sdk.on('message',m=>{
        if(m?.type === 'transcript' && m.transcript && m.transcriptType === 'final') {
          setMessages(prev=>[...prev,{role:m.role||'speaker',text:m.transcript}].slice(-40));
        }
      });
      sdk.on('error',e=>{
        setError(e?.message || 'Voice connection failed. Check Vapi logs and microphone permissions.');
        setScreen('finished');
      });
      await sdk.start(ASSISTANT_ID);
    } catch(e) {setError(e?.message || 'Unable to start the voice session.');setScreen('finished');}
  }
  function hangup(){try{vapiRef.current?.stop();}catch{}setScreen('finished');}
  const duration=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;

  return <div className="shell">
    <header className="topbar"><div className="mark">M</div><div><div className="brand">MERIDIAN GLOBAL</div><div className="subbrand">OFFICE OF THE CHAIRMAN · LOCAL SIMULATION</div></div><div className="devtag">DEVELOPMENT</div></header>
    <main className="layout">
      <section className="panel call-panel">
        <div className="tiny label">PRIVATE EXECUTIVE LINE</div>
        <div className="avatar"><span>A</span><i/></div>
        <h1>Amara</h1><div className="job">Executive Chief of Staff</div>
        {screen==='home' && <><p className="call-status">Your executive line is ready.</p><button className="primary" onClick={startRinging}>Simulate incoming call</button><button className="outline" onClick={()=>setCountdown(30)}>Ring in 30 seconds</button>{countdown!==null&&<p className="helper">Incoming demo call in {countdown}s. Keep this page open.</p>}</>}
        {screen==='ringing' && <><p className="call-status ringing">Incoming internet call…</p><div className="call-actions"><button className="decline" onClick={dismiss}>✕ Decline</button><button className="accept" onClick={answer}>☎ Answer</button></div></>}
        {screen==='connecting'&&<><p className="call-status">Connecting securely…</p><button className="decline" onClick={hangup}>Cancel</button></>}
        {screen==='live'&&<><p className="call-status live">● Connected · {duration}</p><button className="decline" onClick={hangup}>☎ End call</button></>}
        {screen==='finished'&&<><p className="call-status">{status}</p><button className="primary" onClick={startRinging}>Start another briefing</button></>}
        {error&&<p className="error" role="alert">{error}</p>}
        <div className="footnote">Internet voice powered by Vapi · No telephone number or Twilio required</div>
      </section>
      <section className="right">
        <div className="panel inbox"><div className="sectionhead"><span>CHAIRMAN'S AGENDA</span><span className="quiet">FICTIONAL</span></div>
          <div className="agenda-row"><time>07:30</time><div><b>Morning executive briefing</b><small>Amara · Office of the Chairman</small></div><span className="pill">Pending</span></div>
          <div className="agenda-row"><time>10:00</time><div><b>Northstar Freight acquisition</b><small>David · Group CFO</small></div></div>
          <div className="agenda-row"><time>14:00</time><div><b>European expansion review</b><small>Sarah · Regional CEO</small></div></div>
        </div>
        <div className="panel memory"><div className="sectionhead"><span>EXECUTIVE MEMORY · LOCAL TEST</span><span className="quiet">BROWSER ONLY</span></div>
          <p className="helper">After your call, type a short decision here and save it. At the start of the next call, the note is sent to Amara as simulation context. It is not a production memory engine.</p>
          <textarea value={draft} onChange={e=>setDraft(e.target.value)} maxLength={1500} placeholder="Example: I instructed David to negotiate the acquisition price down to $68 million." rows={3}/>
          <button className="secondary" onClick={saveNote}>Save directive for next call</button>
          {note&&<div className="saved"><b>Saved memory:</b> {note}</div>}
        </div>
        <div className="panel transcript"><div className="sectionhead"><span>LIVE TRANSCRIPT</span><span className="quiet">THIS SESSION</span></div>
          {messages.length ? messages.map((m,i)=><div className="line" key={i}><span>{m.role==='assistant'?'Amara': 'Chairman'}</span><p>{m.text}</p></div>) : <p className="helper">Your spoken conversation appears here after connecting. The assistant will guide you through the first acquisition briefing.</p>}
        </div>
      </section>
    </main>
    <footer>This is a fictional executive simulation. No real meetings or transactions occur. Test calls use provider credits and may incur usage charges.</footer>
  </div>;
}
