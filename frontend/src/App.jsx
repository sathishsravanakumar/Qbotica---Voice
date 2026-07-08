import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, Home, ChevronRight, ArrowUpRight, Wrench, Volume2, VolumeX, Menu, Copy } from "lucide-react";
import BayCard from "./components/BayCard.jsx";
import AgentLog from "./components/AgentLog.jsx";
import BillingPanel from "./components/BillingPanel.jsx";
import ChatThread from "./components/ChatThread.jsx";
import bayLogo from "./bay_logo.png";

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
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState(null);
  const [cartVerification, setCartVerification] = useState(null);
  const [fitmentWarning, setFitmentWarning] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [searchLoading, setSearchLoading] = useState(0);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
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
    setSearchLoading(0);
    setClearConfirm(false);
    setLogExpanded(false);
    setSidebarOpen(false);
  }, [sel]);

  // WebSocket
  useEffect(() => {
    let delay = 2000;
    function conn() {
      const w = new WebSocket(WS_URL);
      w.onopen = () => { delay = 2000; };
      w.onmessage = e => {
        const d = JSON.parse(e.data), id = d.bay;
        setBays(p => {
          const b = p[id]; if (!b) return p;
          const u = { ...b };
          if (d.type === "status_update") u.status = d.status;
          else if (d.type === "parsed") { u.vehicle = d.intent.vehicle; u.technician_name = d.intent.technician_name; u.items = d.intent.items; }
          else if (d.type === "search_complete") u.results = d.results;
          else if (d.type === "billing_update") u.billing = d.billing;
          else if (d.type === "search_started" && id === sel) { setSearchLoading(d.count || 1); }
          else if (d.type === "search_complete") { u.results = d.results; if (id === sel) setSearchLoading(0); }
          else if (d.type === "bay_cleared") { if (id === sel) { setChatMessages([]); setCartVerification(null); setFitmentWarning(null); setSearchLoading(0); setClearConfirm(false); setLogExpanded(false); } return { ...p, [id]: { bay_number: id, status: "IDLE", vehicle: null, technician_name: null, items: [], logs: [], results: {}, billing: null, chat_history: [] } }; }
          else if (d.type === "agent_log") u.logs = [...u.logs, d.message];
          else if (d.type === "agent_complete") { u.status = d.status; u.results = d.results; }
          else if (d.type === "agent_error") { u.status = d.status; u.logs = [...u.logs, d.error]; }
          else if (d.type === "cart_verified" && id === sel) { setCartVerification(d); playCartChime(); }
          else if (d.type === "fitment_warning" && id === sel) { setFitmentWarning(d); }
          return { ...p, [id]: u };
        });
      };
      w.onclose = () => { setTimeout(conn, delay); delay = Math.min(delay * 2, 30000); };
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
      setSearchLoading(0);
    }
  }

  function playCartChime() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
      setTimeout(() => ctx.close(), 700);
    } catch {}
  }

  function copyEstimate() {
    const b = bays[sel];
    if (!b?.billing) return;
    const { parts_items, labor_items, total, tax_amount, tax_rate } = b.billing;
    const veh = b.vehicle && b.vehicle.year !== "N/A"
      ? `${b.vehicle.year} ${b.vehicle.make} ${b.vehicle.model}` : null;
    const lines = [];
    if (veh) lines.push(`Vehicle: ${veh}`);
    if (b.technician_name && b.technician_name !== "Unknown") lines.push(`Technician: ${b.technician_name}`);
    lines.push("");
    if (parts_items?.length) {
      lines.push("PARTS");
      parts_items.forEach(p => lines.push(`  ${p.description} ×${p.quantity} — $${p.extended_price.toFixed(2)}`));
    }
    if (labor_items?.length) {
      lines.push("LABOR");
      labor_items.forEach(l => lines.push(`  ${l.description} ${l.quantity.toFixed(1)}h — $${l.extended_price.toFixed(2)}`));
    }
    lines.push("");
    lines.push(`Tax (${(tax_rate * 100).toFixed(1)}%): $${tax_amount.toFixed(2)}`);
    lines.push(`Total: $${total.toFixed(2)}`);
    navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2000);
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

  async function removeItem(description) {
    try {
      await fetch(`${API}/bays/${sel}/remove-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
    } catch {}
  }

  async function editQuantity(description, quantity) {
    try {
      await fetch(`${API}/bays/${sel}/edit-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, quantity }),
      });
    } catch {}
  }

  async function overrideFitment() {
    try {
      await fetch(`${API}/bays/${sel}/override-fitment`, { method: "POST" });
    } catch {}
    setFitmentWarning(null);
  }

  async function exportToExcel() {
    setExporting(true);
    setExportStatus(null);
    try {
      const r = await fetch(`${API}/bays/${sel}/export-excel`, { method: "POST" });
      const d = await r.json();
      if (d.status === "ok") {
        setExportStatus(`Saved: ${d.filename}`);
        setTimeout(() => setExportStatus(null), 6000);
      } else {
        setExportStatus("Export failed");
        setTimeout(() => setExportStatus(null), 4000);
      }
    } catch {
      setExportStatus("Export failed");
      setTimeout(() => setExportStatus(null), 4000);
    } finally {
      setExporting(false);
    }
  }

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

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed left-0 top-0 h-screen w-56 bg-[#111110] flex flex-col z-50 border-r border-[#1E1C18] transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}>
        <div className="p-4 pb-3 border-b border-[#1E1C18]">
          <button onClick={() => nav("/")} className="flex items-center gap-2 cursor-pointer group">
            <img src={bayLogo} alt="BayOps AI" className="h-7 w-auto" />
            <span className="font-bold text-white text-[15px] group-hover:text-amber-500 transition-colors">BayOps AI</span>
          </button>
        </div>
        <div className="px-2 pt-2">
          <button onClick={() => nav("/")} className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-slate-500 hover:text-amber-400 hover:bg-white/5 transition cursor-pointer text-[12px] font-medium">
            <Home className="w-3.5 h-3.5" /> Home
          </button>
        </div>
        <div className="px-4 pt-4 pb-1.5">
          <span className="text-[9px] uppercase tracking-[0.15em] text-slate-600 font-bold">Service Bays</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 space-y-px">
          {Object.values(bays).map(b => <BayCard key={b.bay_number} bay={b} onSelect={setSel} isSelected={sel === b.bay_number} />)}
        </nav>
        <div className="p-3 border-t border-[#1E1C18]">
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-500 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Online
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="lg:ml-56 flex-1 min-h-screen flex flex-col">

        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-200 px-5 py-2.5">
          <div className="flex items-center justify-between max-w-5xl mx-auto">
            <div className="flex items-center gap-1.5 text-[12px]">
              <button onClick={() => setSidebarOpen(v => !v)} className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-50 cursor-pointer mr-1">
                <Menu className="w-4 h-4" />
              </button>
              <button onClick={() => nav("/")} className="hidden lg:block text-slate-400 hover:text-amber-600 transition cursor-pointer font-medium">Home</button>
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
                className={`p-1.5 rounded-md transition cursor-pointer ${voiceOn ? "text-amber-600 hover:bg-amber-50" : "text-slate-300 hover:bg-slate-50"}`}
                title={voiceOn ? "Mute" : "Unmute"}>
                {voiceOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>
              {clearConfirm ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-red-500 font-medium">Clear bay?</span>
                  <button onClick={async () => { await fetch(`${API}/bays/${sel}/clear`, { method: "POST" }); setClearConfirm(false); }}
                    className="px-2 py-0.5 text-[10px] font-semibold bg-red-500 text-white rounded cursor-pointer hover:bg-red-600 transition">Yes</button>
                  <button onClick={() => setClearConfirm(false)}
                    className="px-2 py-0.5 text-[10px] text-slate-500 border border-slate-200 rounded cursor-pointer hover:bg-slate-50 transition">No</button>
                </div>
              ) : (
                <button onClick={() => setClearConfirm(true)}
                  className="p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 transition cursor-pointer" title="Clear Bay">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
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

          {/* Search loading card */}
          {searchLoading > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 flex items-center gap-3 animate-fade">
              <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="text-[13px] text-slate-500">
                Searching AutoZone, NAPA &amp; Advance Auto for {searchLoading} part{searchLoading > 1 ? "s" : ""}…
              </span>
            </div>
          )}

          {/* Results + Billing */}
          {(bay.results?.results?.length > 0 || hasBill) && (
            <div className="grid lg:grid-cols-2 gap-4 animate-fade">
              {bay.results?.results?.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-widest font-bold text-slate-400">Parts Found</span>
                    <span className="text-[9px] text-slate-400">Cheapest auto-selected</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {bay.results.results.map((p, i) => (
                      <div key={i} className="px-4 py-3">
                        {/* Part description + product name */}
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-0.5 capitalize">{p.description}</p>
                        {p.product_name && p.product_name !== p.description && (
                          <p className="text-[10px] text-slate-400 mb-1.5 truncate">{p.product_name}</p>
                        )}
                        {/* Vendor comparison rows */}
                        <div className="space-y-1">
                          {(p.vendor_options?.length > 0 ? p.vendor_options : [{
                            vendor: p.vendor, price: p.price, product_name: p.product_name,
                            source_url: p.source_url, in_stock: p.in_stock, part_number: p.part_number,
                          }]).map((opt, vi) => {
                            const isSelected = opt.vendor === p.vendor;
                            return (
                              <button
                                key={vi}
                                onClick={async () => {
                                  if (isSelected) return;
                                  try {
                                    await fetch(`${API}/bays/${sel}/switch-vendor`, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ description: p.description, vendor: opt.vendor }),
                                    });
                                  } catch {}
                                }}
                                className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all cursor-pointer
                                  ${isSelected
                                    ? "bg-amber-50 border border-amber-200"
                                    : "border border-transparent hover:bg-slate-50 hover:border-slate-200"
                                  }`}
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-amber-600 shrink-0" />}
                                  {!isSelected && <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />}
                                  <span className={`text-[12px] font-medium truncate ${isSelected ? "text-amber-700" : "text-slate-600"}`}>
                                    {opt.vendor}
                                  </span>
                                  <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded shrink-0 ${opt.in_stock ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
                                    {opt.in_stock ? "In Stock" : "Out"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className={`font-bold text-[13px] ${isSelected ? "text-amber-700" : "text-slate-700"}`}>
                                    {String(opt.price).startsWith("$") ? opt.price : opt.price === "See website" ? "—" : `$${opt.price}`}
                                  </span>
                                  {opt.source_url && (
                                    <a
                                      href={opt.source_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      className="text-blue-500 hover:text-blue-700"
                                    >
                                      <ArrowUpRight className="w-3 h-3" />
                                    </a>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasBill && (
                <div className="flex flex-col gap-2">
                  <BillingPanel billing={bay.billing} onRemove={removeItem} onEditQty={editQuantity} />
                  <button
                    onClick={exportToExcel}
                    disabled={exporting}
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-[13px] font-semibold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-sm"
                  >
                    {exporting ? (
                      <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Exporting...</>
                    ) : (
                      "Export to Excel"
                    )}
                  </button>
                  {exportStatus && (
                    <p className="text-[11px] text-emerald-700 font-medium text-center bg-emerald-50 rounded-lg py-1.5 px-3">
                      {exportStatus}
                    </p>
                  )}
                  <button
                    onClick={copyEstimate}
                    className="w-full py-2 px-4 bg-white hover:bg-slate-50 text-slate-600 text-[13px] font-medium rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 border border-slate-200"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copyDone ? "Copied!" : "Copy Estimate"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Terminal */}
          {bay.logs?.length > 0 && (
            <div className={logExpanded ? "h-[400px]" : "h-[180px]"} style={{ transition: "height 0.2s ease" }}>
              <AgentLog logs={bay.logs} bayNumber={sel} expanded={logExpanded} onToggleExpand={() => setLogExpanded(v => !v)} />
            </div>
          )}

          {/* Fitment Warning */}
          {fitmentWarning && fitmentWarning.bay === sel && (
            <div className={`rounded-xl border px-4 py-3 text-[13px] animate-fade ${
              fitmentWarning.halted
                ? "bg-red-50 border-red-200 text-red-800"
                : "bg-amber-50 border-amber-200 text-amber-800"
            }`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  {fitmentWarning.halted
                    ? "⛔ Order halted — fitment issue detected"
                    : "⚠ Fitment advisory — order is proceeding"}
                </span>
                <button onClick={() => setFitmentWarning(null)} className="ml-4 text-[10px] opacity-50 hover:opacity-100 cursor-pointer">✕</button>
              </div>
              {fitmentWarning.issues?.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[11px] opacity-80">
                  {fitmentWarning.issues.map((iss, i) => (
                    <li key={i}><span className="font-medium">{iss.part}</span>: {iss.issue}</li>
                  ))}
                </ul>
              )}
              {fitmentWarning.clarification_needed?.length > 0 && (
                <div className="mt-2 text-[11px] font-medium space-y-0.5">
                  {fitmentWarning.clarification_needed.map((q, i) => (
                    <p key={i}>→ {q}</p>
                  ))}
                </div>
              )}
              {fitmentWarning.halted && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={overrideFitment}
                    className="px-3 py-1 text-[11px] font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition cursor-pointer"
                  >
                    Proceed Anyway
                  </button>
                  <button
                    onClick={() => setFitmentWarning(null)}
                    className="px-3 py-1 text-[11px] text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Cart Verification */}
          {cartVerification && cartVerification.bay === sel && (
            <div className={`rounded-xl border px-4 py-3 text-[13px] animate-fade ${
              !cartVerification.verified
                ? "bg-slate-50 border-slate-200 text-slate-500"
                : cartVerification.mismatch
                  ? "bg-amber-50 border-amber-200 text-amber-800"
                  : "bg-emerald-50 border-emerald-200 text-emerald-800"
            }`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  {!cartVerification.verified
                    ? "Cart could not be verified — check cart manually"
                    : cartVerification.mismatch
                      ? `⚠ Cart total $${cartVerification.cart_total.toFixed(2)} differs from estimate $${cartVerification.expected_total.toFixed(2)}`
                      : `✓ Cart verified — ${cartVerification.cart_items.length} item(s), $${cartVerification.cart_total.toFixed(2)}`
                  }
                </span>
                <button onClick={() => setCartVerification(null)} className="ml-4 text-[10px] opacity-50 hover:opacity-100 cursor-pointer">✕</button>
              </div>
              {cartVerification.verified && cartVerification.cart_items.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[11px] opacity-80">
                  {cartVerification.cart_items.map((item, i) => (
                    <li key={i}>{item.name || item.description} {item.part_number && item.part_number !== "N/A" ? `— #${item.part_number}` : ""} ${(item.price || 0).toFixed(2)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
