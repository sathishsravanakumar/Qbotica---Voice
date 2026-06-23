import { Package, Clock } from "lucide-react";

function $(v) { return typeof v === "number" ? `$${v.toFixed(2)}` : "—"; }

export default function BillingPanel({ billing }) {
  if (!billing) return null;
  const { parts_items, labor_items, parts_subtotal, labor_subtotal, tax_rate, tax_amount, total } = billing;
  if (!parts_items.length && !labor_items.length) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden animate-fade">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widest font-bold text-slate-400">Estimate</span>
        <span className="text-emerald-600 font-bold text-base mono">{$(total)}</span>
      </div>

      <div className="p-5 space-y-4">
        {parts_items.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Package className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-[10px] uppercase tracking-widest text-blue-500 font-bold">Parts</span>
            </div>
            {parts_items.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-800 capitalize">{p.description}</span>
                  {p.source && <span className="ml-2 text-[10px] text-slate-400">{p.source}</span>}
                </div>
                <div className="flex items-center gap-4 shrink-0 ml-3">
                  {p.unit_cost > 0
                    ? <span className="text-[11px] text-slate-400 mono">{$(p.unit_cost)} +{Math.round(p.markup_pct * 100)}%</span>
                    : <span className="text-[11px] text-amber-500 font-medium">Pending</span>}
                  <span className="font-semibold text-slate-800 mono w-16 text-right">{$(p.extended_price)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {labor_items.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Clock className="w-3.5 h-3.5 text-purple-500" />
              <span className="text-[10px] uppercase tracking-widest text-purple-500 font-bold">Labor</span>
            </div>
            {labor_items.map((l, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 text-sm">
                <span className="font-medium text-slate-800 capitalize">{l.description}</span>
                <div className="flex items-center gap-4 shrink-0 ml-3">
                  <span className="text-[11px] text-slate-400 mono">{l.quantity.toFixed(1)}h x {$(l.unit_cost)}</span>
                  <span className="font-semibold text-slate-800 mono w-16 text-right">{$(l.extended_price)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-slate-50 rounded-lg p-4 space-y-1.5 text-[13px]">
          {parts_subtotal > 0 && <div className="flex justify-between text-slate-500"><span>Parts</span><span className="mono">{$(parts_subtotal)}</span></div>}
          {labor_subtotal > 0 && <div className="flex justify-between text-slate-500"><span>Labor</span><span className="mono">{$(labor_subtotal)}</span></div>}
          <div className="flex justify-between text-slate-500"><span>Tax ({(tax_rate * 100).toFixed(1)}%)</span><span className="mono">{$(tax_amount)}</span></div>
          <div className="border-t border-slate-200 pt-2 mt-2 flex justify-between items-center">
            <span className="font-bold text-slate-900 text-sm">Total</span>
            <span className="font-bold text-emerald-600 text-xl mono">{$(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
