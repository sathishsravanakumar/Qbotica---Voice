import { useEffect, useRef } from "react";
import { Terminal, Maximize2, Minimize2 } from "lucide-react";

export default function AgentLog({ logs, bayNumber, expanded, onToggleExpand }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  return (
    <div className="rounded-xl bg-slate-900 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800">
        <div className="flex items-center gap-1.5">
          <Terminal className="w-3 h-3 text-emerald-400" />
          <span className="text-[10px] font-semibold mono text-slate-400 uppercase tracking-widest">Terminal — Bay {bayNumber}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleExpand}
            title={expanded ? "Collapse" : "Expand"}
            className="text-slate-500 hover:text-slate-300 transition cursor-pointer"
          >
            {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
          <div className="flex gap-1">
            <span className="w-2 h-2 rounded-full bg-[#ff5f57]" />
            <span className="w-2 h-2 rounded-full bg-[#febc2e]" />
            <span className="w-2 h-2 rounded-full bg-[#28c840]" />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 mono text-[11px] leading-5 min-h-0">
        {logs.length === 0 ? (
          <span className="text-slate-600">$ awaiting input_</span>
        ) : logs.map((log, i) => (
          <div key={i} className="flex gap-2 animate-slide" style={{ animationDelay: `${Math.min(i * 10, 200)}ms` }}>
            <span className="text-slate-600 select-none shrink-0 w-4 text-right">{i + 1}</span>
            <span className="text-emerald-400">{log}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
