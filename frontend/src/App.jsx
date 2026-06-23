import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, Home, ChevronRight, ArrowUpRight, Wrench, Volume2, VolumeX } from "lucide-react";
import BayCard from "./components/BayCard.jsx";
import AgentLog from "./components/AgentLog.jsx";
import BillingPanel from "./components/BillingPanel.jsx";
import ChatThread from "./components/ChatThread.jsx";

const WS_URL = `ws://${window.location.hostname}:8000/ws`;
const API = "/api";

export default function App() {
  const nav = useNavigate();
  const [bays, setBays] = useState({});
  const [sel, setSel] = useState("1");
  const [chatMessages, setChatMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const wsRef = useRef(null);
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const afRef = useRef(null);

  // Load bays
  useEffect(() => {
    fetch(`${API}/bays`).then(r => r.json()).then(d => {
      setBays(d);
      if (d[sel]?.chat_history) setChatMessages(d[sel].chat_history);
    }).catch(() => {
      const o = {}; for (let i = 1; i <= 6; i++) o[String(i)] = { bay_number: String(i), status: "IDLE", vehicle: null, technician_name: null, items: [], logs: [], results: {}, chat_history: [] };
      setBays(o);
    });
  }, []);

  useEffect(() => {
    const bay = bays[sel];
    if (bay?.chat_history) setChatMessages(bay.chat_history);
    else setChatMessages([]);
  }, [sel]);

  // WebSocket
  useEffect(() => {
    function conn() {
      const w = new WebSocket(WS_URL);
      w.onmessage = e => {
        const d = JSON.parse(e.data), id = d.bay;
        setBays(p => {
          const b = p[id]; if (!b) return p;
          const u = { ...b };
          if (d.type === "status_update") u.status = d.status;
          else if (d.type === "parsed") { u.vehicle = d.intent.vehicle; u.technician_name = d.intent.technician_name; u.items = d.intent.items; }
          else if (d.type === "search_complete") u.results = d.results;
          else if (d.type === "billing_update") u.billing = d.billing;
          else if (d.type === "bay_cleared") { if (id === sel) setChatMessages([]); return { ...p, [id]: { bay_number: id, status: "IDLE", vehicle: null, technician_name: null, items: [], logs: [], results: {}, billing: null, chat_history: [] } }; }
          else if (d.type === "agent_log") u.logs = [...u.logs, d.message];
          else if (d.type === "agent_complete") { u.status = d.status; u.results = d.results; }
          else if (d.type === "agent_error") { u.status = d.status; u.logs = [...u.logs, d.error]; }
          return { ...p, [id]: u };
        });
      };
      w.onclose = () => setTimeout(conn, 2000);
      wsRef.current = w;
    }
    conn();
    return () => wsRef.current?.close();
  }, [sel]);

  // --- Core: send message to chat agent and speak reply ---
  async function sendToAgent(text) {
    if (!text.trim() || sending) return;
    setSending(true);
    setStatus(null);

    setChatMessages(prev => [...prev, { role: "user", content: text.trim(), timestamp: new Date().toISOString() }]);

    try {
      setStatus("Thinking...");
      const r = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim(), bay_number: sel }),
      });
      const d = await r.json();

      setChatMessages(prev => [...prev, {
        role: "assistant", content: d.reply,
        timestamp: new Date().toISOString(),
        has_action: d.response_type === "action",
      }]);
      setStatus(null);

      if (d.billing) setBays(p => ({ ...p, [sel]: { ...p[sel], billing: d.billing } }));
      if (d.parts_results) setBays(p => ({ ...p, [sel]: { ...p[sel], results: d.parts_results } }));

      // Speak the reply
      if (d.reply && voiceOn) {
        setStatus("Speaking...");
        try {
          const tts = await fetch(`${API}/tts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: d.reply }),
          });
          if (tts.ok) {
            const blob = await tts.blob();
            if (blob.size > 0) {
              const url = URL.createObjectURL(blob);
              const audio = new Audio(url);
              audio.onended = () => { URL.revokeObjectURL(url); setStatus(null); };
              await audio.play().catch(() => {});
            } else { setStatus(null); }
          } else { setStatus(null); }
        } catch { setStatus(null); }
      }
    } catch {
      setChatMessages(prev => [...prev, { role: "assistant", content: "Sorry, something went wrong.", timestamp: new Date().toISOString() }]);
      setStatus(null);
    } finally {
      setSending(false);
    }
  }

  // --- Mic: record → transcribe → auto-send ---
  const toggleMic = useCallback(async () => {
    if (isRecording) {
      // Stop recording
      const m = mrRef.current;
      if (m?.state === "recording") { m.requestData(); setTimeout(() => m.stop(), 200); }
      setIsRecording(false);
      return;
    }

    // Start recording
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 256; src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      (function tick() { an.getByteFrequencyData(buf); setAudioLevel(Math.min(100, buf.reduce((a, b) => a + b, 0) / buf.length * 2)); afRef.current = requestAnimationFrame(tick); })();

      const mt = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType: mt });
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };

      mr.onstop = async () => {
        cancelAnimationFrame(afRef.current); setAudioLevel(0); ctx.close(); stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType }); chunksRef.current = [];
        if (blob.size < 5000) return;

        // Auto-transcribe
        setStatus("Transcribing...");
        setSending(true);
        try {
          const fd = new FormData(); fd.append("audio", blob, "r.webm");
          const r = await fetch(`${API}/transcribe`, { method: "POST", body: fd });
          const d = await r.json();
          if (d.transcript?.trim()) {
            setStatus(null);
            await sendToAgent(d.transcript.trim());
          } else {
            setStatus(null); setSending(false);
          }
        } catch { setStatus(null); setSending(false); }
      };

      mrRef.current = mr; mr.start(1000); setIsRecording(true);
    } catch { /* mic error */ }
  }, [isRecording, sel, voiceOn, sending]);

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || sending) return;
    setSending(true);
    setStatus("Transcribing audio...");
    try {
      const fd = new FormData();
      fd.append("audio", file, file.name);
      const r = await fetch(`${API}/transcribe`, { method: "POST", body: fd });
      const d = await r.json();
      setStatus(null);
      if (d.transcript?.trim()) {
        await sendToAgent(d.transcript.trim());
      } else {
        setSending(false);
      }
    } catch {
      setStatus(null);
      setSending(false);
    }
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
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Online
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
              <button onClick={() => setVoiceOn(v => !v)}
                className={`p-1.5 rounded-md transition cursor-pointer ${voiceOn ? "text-blue-500 hover:bg-blue-50" : "text-slate-300 hover:bg-slate-50"}`}
                title={voiceOn ? "Mute" : "Unmute"}>
                {voiceOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>
              <button onClick={async () => { await fetch(`${API}/bays/${sel}/clear`, { method: "POST" }); }}
                className="p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 transition cursor-pointer" title="Clear Bay">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 max-w-5xl mx-auto w-full flex flex-col p-4 lg:p-6 gap-4">

          {/* Chat */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1" style={{ minHeight: "400px" }}>
            <ChatThread
              messages={chatMessages}
              sending={sending}
              status={status}
              onMicToggle={toggleMic}
              isRecording={isRecording}
              audioLevel={audioLevel}
              onTextSend={sendToAgent}
              onFileUpload={handleFileUpload}
            />
          </div>

          {/* Results + Billing */}
          {(bay.results?.results?.length > 0 || hasBill) && (
            <div className="grid lg:grid-cols-2 gap-4 animate-fade">
              {bay.results?.results?.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-2.5 border-b border-slate-100">
                    <span className="text-[11px] uppercase tracking-widest font-bold text-slate-400">Parts Found</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {bay.results.results.map((p, i) => (
                      <div key={i} className="px-5 py-3 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-slate-900 truncate">{p.product_name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${p.in_stock ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>{p.in_stock ? "In Stock" : "Out"}</span>
                            {p.source_url && <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline flex items-center gap-0.5">View <ArrowUpRight className="w-2.5 h-2.5" /></a>}
                          </div>
                        </div>
                        <span className="text-base font-bold text-slate-900">{String(p.price).startsWith("$") ? p.price : `$${p.price}`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasBill && <BillingPanel billing={bay.billing} />}
            </div>
          )}

          {/* Terminal */}
          {bay.logs?.length > 0 && (
            <div className="h-[180px]">
              <AgentLog logs={bay.logs} bayNumber={sel} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
