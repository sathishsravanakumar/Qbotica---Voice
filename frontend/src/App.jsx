import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, MicOff, Send, Keyboard, Upload, Trash2, Home, ChevronRight, Loader, ArrowUpRight, Wrench } from "lucide-react";
import BayCard from "./components/BayCard.jsx";
import AgentLog from "./components/AgentLog.jsx";
import BillingPanel from "./components/BillingPanel.jsx";

const WS_URL = `ws://${window.location.hostname}:8000/ws`;
const API = "/api";

function useVoice() {
  const [rec, setRec] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState(null);
  const [level, setLevel] = useState(0);
  const [devs, setDevs] = useState([]);
  const [dev, setDev] = useState("");
  const mr = useRef(null); const ch = useRef([]); const af = useRef(null);

  useEffect(() => { navigator.mediaDevices.enumerateDevices().then(ds => { const m = ds.filter(d => d.kind === "audioinput"); setDevs(m); if (m.length && !dev) setDev(m[0].deviceId); }); }, []);

  const start = useCallback(async () => {
    setErr(null); setText(""); ch.current = [];
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: dev ? { deviceId: { exact: dev }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext(), src = ctx.createMediaStreamSource(s), an = ctx.createAnalyser(); an.fftSize = 256; src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      (function tick() { an.getByteFrequencyData(buf); setLevel(Math.min(100, buf.reduce((a, b) => a + b, 0) / buf.length * 2)); af.current = requestAnimationFrame(tick); })();
      const mt = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const rec = new MediaRecorder(s, { mimeType: mt });
      rec.ondataavailable = e => { if (e.data.size > 0) ch.current.push(e.data); };
      rec.onstop = async () => {
        cancelAnimationFrame(af.current); setLevel(0); ctx.close(); s.getTracks().forEach(t => t.stop());
        const blob = new Blob(ch.current, { type: rec.mimeType }); ch.current = [];
        if (blob.size < 5000) { setErr("Too short — speak 2+ seconds."); return; }
        setBusy(true);
        try { const fd = new FormData(); fd.append("audio", blob, "r.webm"); const r = await fetch(`${API}/transcribe`, { method: "POST", body: fd }); const d = await r.json(); if (d.error) setErr(d.error); else if (d.transcript?.trim()) setText(d.transcript.trim()); else setErr("No speech detected."); }
        catch { setErr("Transcription failed."); } finally { setBusy(false); }
      };
      mr.current = rec; rec.start(1000); setRec(true);
    } catch (e) { setErr(e.name === "NotAllowedError" ? "Mic blocked — allow in browser settings." : "Mic error."); }
  }, [dev]);

  const stop = useCallback(() => { const m = mr.current; if (m?.state === "recording") { m.requestData(); setTimeout(() => m.stop(), 200); } setRec(false); }, []);
  return { rec, busy, text, setText, err, level, devs, dev, setDev, start, stop };
}

export default function App() {
  const nav = useNavigate();
  const [bays, setBays] = useState({});
  const [sel, setSel] = useState("1");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState("text");
  const [txt, setTxt] = useState("");
  const [upBusy, setUpBusy] = useState(false);
  const [upText, setUpText] = useState("");
  const [upErr, setUpErr] = useState(null);
  const wsRef = useRef(null);
  const v = useVoice();
  const input = mode === "voice" ? v.text : mode === "upload" ? upText : txt;

  useEffect(() => { fetch(`${API}/bays`).then(r => r.json()).then(setBays).catch(() => { const o = {}; for (let i = 1; i <= 6; i++) o[String(i)] = { bay_number: String(i), status: "IDLE", vehicle: null, technician_name: null, items: [], logs: [], results: {} }; setBays(o); }); }, []);

  useEffect(() => {
    function conn() {
      const w = new WebSocket(WS_URL);
      w.onmessage = e => { const d = JSON.parse(e.data), id = d.bay; setBays(p => { const b = p[id]; if (!b) return p; const u = { ...b };
        if (d.type === "status_update") u.status = d.status;
        else if (d.type === "parsed") { u.vehicle = d.intent.vehicle; u.technician_name = d.intent.technician_name; u.items = d.intent.items; }
        else if (d.type === "search_complete") u.results = d.results;
        else if (d.type === "billing_update") u.billing = d.billing;
        else if (d.type === "bay_cleared") return { ...p, [id]: { bay_number: id, status: "IDLE", vehicle: null, technician_name: null, items: [], logs: [], results: {}, billing: null } };
        else if (d.type === "agent_log") u.logs = [...u.logs, d.message];
        else if (d.type === "agent_complete") { u.status = d.status; u.results = d.results; }
        else if (d.type === "agent_error") { u.status = d.status; u.logs = [...u.logs, d.error]; }
        return { ...p, [id]: u }; }); };
      w.onclose = () => setTimeout(conn, 2000); wsRef.current = w;
    } conn(); return () => wsRef.current?.close();
  }, []);

  async function send() {
    if (!input.trim()) return; setSending(true); if (v.rec) v.stop();
    try {
      const r = await fetch(`${API}/voice-command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: input.trim(), bay_number: sel }) });
      const d = await r.json();
      setBays(p => { const b = p[sel] || { logs: [] }, u = { ...b };
        if (d.parsed_intent) { u.vehicle = d.parsed_intent.vehicle; u.technician_name = d.parsed_intent.technician_name; u.items = d.parsed_intent.items; u.logs = [...(b.logs || []), `Parsed: ${d.parsed_intent.vehicle.year} ${d.parsed_intent.vehicle.make} ${d.parsed_intent.vehicle.model}`]; }
        if (d.parts_results) { u.results = d.parts_results; u.logs = [...(u.logs || []), d.parts_results.summary || ""]; }
        if (d.billing) { u.billing = d.billing; u.status = "COMPLETE"; } else if (d.status === "error") { u.status = "ERROR"; u.logs = [...(u.logs || []), d.message]; }
        return { ...p, [sel]: u }; });
      if (mode === "text") setTxt(""); else if (mode === "upload") setUpText(""); else v.setText("");
    } catch {} finally { setSending(false); }
  }

  const bay = bays[sel] || { logs: [], bay_number: sel, items: [], results: {} };
  const veh = bay.vehicle && bay.vehicle.year !== "N/A" ? bay.vehicle : null;
  const hasBill = bay.billing && (bay.billing.parts_items?.length > 0 || bay.billing.labor_items?.length > 0);

  return (
    <div className="min-h-screen flex bg-[#f8fafc]">

      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-screen w-56 bg-white hidden lg:flex flex-col z-50 border-r border-slate-200">
        <div className="p-4 pb-3 border-b border-slate-100">
          <button onClick={() => nav("/")} className="flex items-center gap-2 cursor-pointer group">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-sm">B</div>
            <span className="font-bold text-slate-900 text-[15px] group-hover:text-blue-600 transition-colors">BayOps AI</span>
          </button>
        </div>

        <div className="px-2 pt-2">
          <button onClick={() => nav("/")} className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition cursor-pointer text-[12px] font-medium">
            <Home className="w-3.5 h-3.5" /> Home
          </button>
        </div>

        <div className="px-4 pt-4 pb-1.5">
          <span className="text-[9px] uppercase tracking-[0.15em] text-slate-400 font-bold">Service Bays</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 space-y-px">
          {Object.values(bays).map(b => <BayCard key={b.bay_number} bay={b} onSelect={setSel} isSelected={sel === b.bay_number} />)}
        </nav>

        <div className="p-3 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> System Online
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="lg:ml-56 flex-1 min-h-screen flex flex-col">

        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-200 px-5 py-2.5">
          <div className="flex items-center justify-between max-w-5xl mx-auto">
            <div className="flex items-center gap-1.5 text-[12px]">
              <button onClick={() => nav("/")} className="lg:hidden w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center text-white font-bold text-[10px] cursor-pointer mr-1">B</button>
              <button onClick={() => nav("/")} className="hidden lg:block text-slate-400 hover:text-blue-500 transition cursor-pointer font-medium">Home</button>
              <ChevronRight className="w-3 h-3 text-slate-300" />
              <span className="font-semibold text-slate-900">Bay {sel}</span>
              {veh && <><ChevronRight className="w-3 h-3 text-slate-300" /><span className="text-slate-500">{veh.year} {veh.make} {veh.model}</span></>}
            </div>
            <div className="flex items-center gap-2">
              {bay.technician_name && bay.technician_name !== "Unknown" && (
                <span className="hidden sm:flex items-center gap-1 text-[11px] text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md"><Wrench className="w-3 h-3" />{bay.technician_name}</span>
              )}
              {hasBill && <span className="text-[12px] font-bold text-emerald-600 mono bg-emerald-50 px-2 py-0.5 rounded-md">${bay.billing.total.toFixed(2)}</span>}
              <button onClick={async () => { await fetch(`${API}/bays/${sel}/clear`, { method: "POST" }); }}
                className="p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 transition cursor-pointer" title="Clear Bay"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </header>

        <div className="flex-1 max-w-5xl mx-auto w-full p-4 lg:p-6 space-y-4">

          {/* Input Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-100">
              <span className="text-[12px] font-semibold text-slate-900">Command</span>
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                {[{ id: "text", icon: Keyboard, l: "Type" }, { id: "upload", icon: Upload, l: "Upload" }, { id: "voice", icon: Mic, l: "Voice" }].map(({ id, icon: I, l }) => (
                  <button key={id} onClick={() => setMode(id)} className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 cursor-pointer transition ${mode === id ? "bg-white text-blue-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}><I className="w-3 h-3" />{l}</button>
                ))}
              </div>
            </div>
            <div className="p-4">

              {mode === "text" && <>
                <textarea value={txt} onChange={e => setTxt(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder='e.g. "Mike bay 3, 2019 Honda Civic needs front brake pads and oil filter from AutoZone"'
                  rows={2} className="w-full bg-slate-50 rounded-lg p-3.5 mb-3 border border-slate-200 text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50 transition text-[13px]" />
                <div className="flex items-center gap-2">
                  <button onClick={send} disabled={!txt.trim() || sending} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-30 transition cursor-pointer shadow-sm">
                    {sending ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {sending ? "Processing..." : "Send to AI"}
                  </button>
                  <span className="text-[10px] text-slate-400">Enter to send</span>
                </div>
              </>}

              {mode === "upload" && <>
                <div className="bg-slate-50 rounded-lg p-3.5 mb-3 min-h-[48px] border border-slate-200 text-[13px]">
                  {upBusy ? <span className="flex items-center gap-2 text-blue-500"><Loader className="w-3.5 h-3.5 animate-spin" />Transcribing...</span>
                    : upText ? <p className="text-slate-800">{upText}</p>
                    : <p className="text-slate-400 italic">Upload .mp3, .wav, or .m4a audio</p>}
                </div>
                {upErr && <p className="text-red-500 text-[11px] mb-2">{upErr}</p>}
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold bg-blue-500 hover:bg-blue-600 text-white cursor-pointer shadow-sm transition">
                    <Upload className="w-3.5 h-3.5" /> Choose File
                    <input type="file" accept="audio/*" className="hidden" onChange={async e => {
                      const f = e.target.files?.[0]; if (!f) return; setUpText(""); setUpErr(null); setUpBusy(true);
                      try { const fd = new FormData(); fd.append("audio", f, f.name); const r = await fetch(`${API}/transcribe`, { method: "POST", body: fd }); const d = await r.json(); if (d.error) setUpErr(d.error); else if (d.transcript?.trim()) setUpText(d.transcript.trim()); else setUpErr("No speech."); }
                      catch { setUpErr("Failed."); } finally { setUpBusy(false); e.target.value = ""; }
                    }} />
                  </label>
                  <button onClick={send} disabled={!upText.trim() || sending || upBusy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-30 transition cursor-pointer shadow-sm"><Send className="w-3.5 h-3.5" />Send</button>
                </div>
              </>}

              {mode === "voice" && <>
                <div className="bg-slate-50 rounded-lg p-3.5 mb-3 min-h-[48px] border border-slate-200 text-[13px]">
                  {v.busy ? <span className="flex items-center gap-2 text-blue-500"><Loader className="w-3.5 h-3.5 animate-spin" />Transcribing...</span>
                    : v.text ? <p className="text-slate-800">{v.text}</p>
                    : <p className="text-slate-400 italic">{v.rec ? "Listening..." : "Press Record and speak"}</p>}
                  {v.rec && <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-75 ${v.level > 30 ? "bg-emerald-500" : v.level > 5 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${v.level}%` }} /></div>}
                </div>
                {v.err && <p className="text-red-500 text-[11px] mb-2">{v.err}</p>}
                {v.devs.length > 1 && <select value={v.dev} onChange={e => v.setDev(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] text-slate-600 mb-2">{v.devs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 6)}`}</option>)}</select>}
                <div className="flex items-center gap-2">
                  <button onClick={v.rec ? v.stop : v.start} disabled={v.busy} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold transition cursor-pointer shadow-sm ${v.rec ? "bg-red-500 hover:bg-red-600 text-white animate-pulse" : "bg-blue-500 hover:bg-blue-600 text-white"}`}>
                    {v.rec ? <><MicOff className="w-3.5 h-3.5" />Stop</> : <><Mic className="w-3.5 h-3.5" />Record</>}
                  </button>
                  <button onClick={send} disabled={!v.text.trim() || sending || v.rec || v.busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-30 transition cursor-pointer shadow-sm"><Send className="w-3.5 h-3.5" />Send</button>
                </div>
              </>}
            </div>
          </div>

          {/* Parsed Items */}
          {bay.items?.length > 0 && (
            <div className="flex flex-wrap gap-2 animate-fade">
              {bay.items.map((it, i) => (
                <span key={i} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border ${it.item_type === "PART" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-purple-50 text-purple-700 border-purple-200"}`}>
                  {it.description}{it.hours ? ` (${it.hours}h)` : ""}
                </span>
              ))}
            </div>
          )}

          {/* Results + Billing side by side */}
          {(bay.results?.results?.length > 0 || hasBill) && (
            <div className="grid lg:grid-cols-2 gap-4 animate-fade">
              {bay.results?.results?.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-2.5 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-widest font-bold text-slate-400">Parts Found</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {bay.results.results.map((p, i) => (
                      <div key={i} className="px-5 py-3 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-slate-900 truncate">{p.product_name}</p>
                          <p className="text-[10px] text-slate-400 mono mt-0.5">#{p.part_number}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${p.in_stock ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>{p.in_stock ? "In Stock" : "Out"}</span>
                            {p.source_url && <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:text-blue-600 flex items-center gap-0.5">View <ArrowUpRight className="w-2.5 h-2.5" /></a>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-base font-bold text-slate-900">{String(p.price).startsWith("$") ? p.price : `$${p.price}`}</span>
                          <p className="text-[9px] text-slate-400 uppercase font-bold">{p.vendor}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasBill && <BillingPanel billing={bay.billing} />}
            </div>
          )}

          {/* Terminal */}
          <div className="h-[260px]">
            <AgentLog logs={bay.logs} bayNumber={sel} />
          </div>
        </div>

        <footer className="px-5 py-3 text-center text-slate-400 text-[11px] border-t border-slate-200">
          &copy; 2026 BayOps AI &middot; Autonomous service bay workflows
        </footer>
      </main>
    </div>
  );
}
