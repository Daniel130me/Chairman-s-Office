'use client';
import {useState} from 'react';
import {authClient} from '../../lib/auth/client.js';
export default function ResetPassword(){
  const [password,setPassword]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e){e.preventDefault();setBusy(true);try{
    const token=new URLSearchParams(window.location.search).get('token');
    if(!token)throw Error('This reset link is missing or expired.');
    const r=await authClient.resetPassword({token,newPassword:password});if(r.error)throw Error(r.error.message);setNotice('Password changed. Return to your office to sign in.');
  }catch(e){setNotice(e.message)}finally{setBusy(false)}}
  return <div className="access"><div className="access-card"><div className="brand-seal">CO</div><h1>Restore executive access</h1><form onSubmit={submit}><label>New password<input type="password" minLength={10} required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary-btn" disabled={busy}>Reset password</button></form><p role="status">{notice}</p><a href="/">Return to your office</a></div></div>;
}
