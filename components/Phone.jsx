'use client';
import dynamic from 'next/dynamic';
// Browser-only audio and voice SDK must not run on the server.
const ExecutivePhone = dynamic(() => import('../frontend/src/App.jsx'), {
  ssr: false,
  loading: () => <div className="boot-screen"><div className="boot-mark">CO</div><div className="boot-name">CHAIRMAN'S OFFICE</div><div className="boot-loader"/></div>
});
export default function Phone() { return <ExecutivePhone />; }
