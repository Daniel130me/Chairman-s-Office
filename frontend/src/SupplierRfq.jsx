import RichText from './RichText.jsx';
import React,{useEffect,useState} from 'react';
import {api,usd} from './api.js';
export default function SupplierRfq({state,onChange,notify}){
 const [data,setData]=useState(null),[form,setForm]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const orders=state.operations?.purchaseOrders||[],contacts=(state.contacts||[]).filter(c=>['supplier','vendor'].includes(c.kind)&&c.company);
 const load=async()=>{try{setData(await api('/supplier-rfqs'));setError('');}catch(e){setError(e.message);}};
 useEffect(()=>{void load();const timer=setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine!==false)void load();},15000);return()=>clearInterval(timer);},[]);
 function field(k,v){setForm(f=>({...f,[k]:v}));}
 async function submit(e){e.preventDefault();if(busy)return;setBusy(true);
 try{const {type,id,...body}=form;const url=type==='create'?'/purchase-orders/'+id+'/rfq':type==='counter'?'/supplier-rfq-rounds/'+id+'/counter':'/supplier-rfqs/'+id+'/decide';
 if(type==='counter')body.markupBasisPoints=Number(body.markupBasisPoints);await api(url,{method:'POST',body});setForm(null);await load();await onChange();notify('Supplier request updated.');
 }catch(e){notify(e.message);}finally{setBusy(false);}}
 if(error)return <div className="detail-section"><p>{error}</p><button onClick={load}>Retry quotes</button></div>;
 if(!data)return <div className="detail-section">Loading competitive quotes…</div>;
 return <div className="content-section"><h3>Competitive supplier quotations</h3><p>Request independent offers from two to five fictional suppliers. No stock or cash moves when you select a quote.</p>
 {orders.filter(p=>p.status==='draft'&&!p.disposed_at&&!p.operation_key?.startsWith('po:reorder:')&&!data.requests.some(r=>r.purchase_order_id===p.id)&&!(state.supplierNegotiations||[]).some(n=>n.purchase_order_id===p.id)).map(p=><div key={p.id} className="detail-section"><b>{p.po_number} · {usd(p.total)}</b><RichText text={p.description}/><button disabled={contacts.length<2} onClick={()=>setForm({type:'create',id:p.id,supplierIds:[],reason:'',operationKey:crypto.randomUUID()})}>Invite competing suppliers</button></div>)}
 {data.requests.map(r=><div key={r.id} className="detail-section"><b>{orders.find(p=>p.id===r.purchase_order_id)?.po_number||'Order'} · {r.disposed_at?'Transferred · read-only':r.status}</b><RichText text={r.reason}/>{data.rounds.filter(x=>x.rfq_id===r.id).map(x=>{const latest=!data.rounds.some(y=>y.rfq_id===r.id&&y.supplier_contact_id===x.supplier_contact_id&&y.round_number>x.round_number);return <div key={x.id} className="detail-section"><b>{x.company} · Round {x.round_number} · {x.status}</b>{x.response&&<p>{x.response.reason} {x.response.total?' · '+usd(x.response.total):''}</p>}{x.requested_markup!==null&&<p>Requested adjustment: {x.requested_markup/100}% of baseline</p>}{r.awarded_round_id===x.id&&<p>Selected supplier</p>}{!r.disposed_at&&r.status==='open'&&latest&&x.status==='quoted'&&<><button onClick={()=>setForm({type:'decide',id:r.id,decision:'awarded',roundId:x.id,reason:''})}>Select this quote</button>{x.round_number<4&&<button onClick={()=>setForm({type:'counter',id:x.id,markupBasisPoints:String(x.response.markupBasisPoints)})}>Counteroffer</button>}</>}</div>})}{!r.disposed_at&&r.status==='open'&&<button onClick={()=>setForm({type:'decide',id:r.id,decision:'cancelled',reason:''})}>Cancel request</button>}</div>)}
 {form&&<form className="form-card" aria-busy={busy} onSubmit={submit}><h3>{form.type==='create'?'Invite suppliers':form.type==='counter'?'Counteroffer':'Record sourcing decision'}</h3>{form.type==='create'&&<div>{contacts.map(c=><label key={c.id}><input type="checkbox" checked={form.supplierIds.includes(c.id)} onChange={e=>field('supplierIds',e.target.checked?[...form.supplierIds,c.id]:form.supplierIds.filter(id=>id!==c.id))}/>{c.company} · {c.name}</label>)}</div>}
 {form.type==='counter'?<label>Adjustment from original price in basis points (100 = 1%)<input type="number" min="-1000" max="1000" step="1" required value={form.markupBasisPoints} onChange={e=>field('markupBasisPoints',e.target.value)}/></label>:<label>Reason<textarea required value={form.reason} onChange={e=>field('reason',e.target.value)}/></label>}
 <button className="primary-btn" disabled={busy||(form.type==='create'&&(form.supplierIds.length<2||form.supplierIds.length>5))}>Confirm</button><button type="button" onClick={()=>setForm(null)}>Cancel</button></form>}
 </div>;
}
