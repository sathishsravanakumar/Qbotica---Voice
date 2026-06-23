const S = {
  IDLE: { dot: "bg-slate-300" },
  PARSING: { dot: "bg-amber-400 animate-pulse" },
  BROWSING: { dot: "bg-blue-400 animate-pulse" },
  COMPLETE: { dot: "bg-emerald-400" },
  ERROR: { dot: "bg-red-400" },
};

export default function BayCard({ bay, onSelect, isSelected }) {
  const s = S[bay.status] || S.IDLE;
  const v = bay.vehicle && bay.vehicle.year !== "N/A" ? bay.vehicle : null;
  const t = bay.billing?.total || 0;

  return (
    <button onClick={() => onSelect(bay.bay_number)}
      className={`w-full text-left rounded-lg px-3 py-2 transition-all cursor-pointer
        ${isSelected ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-blue-500" : s.dot}`} />
          <span className="text-[13px] font-medium">Bay {bay.bay_number}</span>
        </div>
        {t > 0 && <span className="text-[11px] mono font-semibold text-emerald-600">${t.toFixed(0)}</span>}
      </div>
      {v && <p className="text-[11px] mt-0.5 ml-4 text-slate-400">{v.year} {v.make} {v.model}</p>}
    </button>
  );
}
