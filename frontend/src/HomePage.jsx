import { useNavigate } from "react-router-dom";
import { Mic, Bot, DollarSign, Zap, Clock, ArrowRight, Wrench, Globe, BarChart3, ChevronRight } from "lucide-react";

const stats = [
  { value: "20min", label: "Saved Per Repair Order", color: "text-blue-600" },
  { value: "25%", label: "Revenue Leakage Eliminated", color: "text-emerald-600" },
  { value: "$39k+", label: "Annual Boost Per Technician", color: "text-purple-600" },
];

const features = [
  {
    icon: Mic,
    title: "Hands-Free Voice Input",
    desc: "Technicians dictate from under the car. Our AI parses vehicle, parts, and labor from natural speech.",
    color: "bg-blue-50 text-blue-600",
  },
  {
    icon: Bot,
    title: "Autonomous Browser Agent",
    desc: "Playwright navigates AutoZone, finds the right part, adds to cart, and shows the checkout page — zero manual clicks.",
    color: "bg-purple-50 text-purple-600",
  },
  {
    icon: DollarSign,
    title: "Live Billing & Estimates",
    desc: "Parts cost with 45% markup, labor at shop rate, tax — all calculated in real-time per bay. Accumulates across voice commands.",
    color: "bg-emerald-50 text-emerald-600",
  },
];

const workflow = [
  { step: "01", title: "Voice Command", desc: "Mechanic speaks: vehicle, parts needed, labor hours", icon: Mic },
  { step: "02", title: "AI Parsing", desc: "Groq extracts structured intent in under 1 second", icon: Zap },
  { step: "03", title: "Web Search", desc: "DuckDuckGo finds real AutoZone product URLs and prices", icon: Globe },
  { step: "04", title: "Add to Cart", desc: "Playwright opens the browser and adds parts to the AutoZone cart", icon: Wrench },
  { step: "05", title: "Billing Updated", desc: "Estimate recalculates with markup, labor, and tax", icon: BarChart3 },
];

const techStack = [
  { name: "Groq LLM", detail: "llama-3.3-70b — voice parsing in <1s", tag: "PARSING" },
  { name: "Playwright", detail: "Headless browser automation — zero LLM tokens", tag: "BROWSER" },
  { name: "ElevenLabs", detail: "Scribe v1 — speech-to-text transcription", tag: "VOICE" },
  { name: "DuckDuckGo", detail: "Free web search — no API key needed", tag: "SEARCH" },
  { name: "FastAPI", detail: "WebSocket real-time updates to all clients", tag: "BACKEND" },
  { name: "React + Tailwind", detail: "Light-themed dashboard with live billing", tag: "FRONTEND" },
];

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#f8fafc]" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-500 rounded flex items-center justify-center text-white font-bold text-lg">B</div>
            <span className="font-bold text-xl tracking-tight text-slate-900">BayOps AI</span>
          </div>
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm transition-all cursor-pointer shadow-sm"
          >
            Open Dashboard <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center lg:text-left">
        <div className="lg:flex lg:items-center lg:gap-16">
          <div className="lg:flex-1">
            <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-bold uppercase tracking-widest">
              Autonomous Service Advisor
            </span>
            <h1 className="text-4xl lg:text-6xl font-bold mt-5 mb-6 tracking-tight leading-tight text-slate-900">
              The "Zero-UI" OS for<br />Automotive Bays
            </h1>
            <p className="text-lg text-slate-600 max-w-xl leading-relaxed mb-8">
              BayOps AI lets master technicians order parts and build estimates <strong>without ever putting down their tools</strong>.
              Voice in, parts sourced, estimate built — all autonomous.
            </p>
            <div className="flex flex-wrap gap-4 justify-center lg:justify-start">
              <button
                onClick={() => navigate("/dashboard")}
                className="flex items-center gap-2 px-8 py-3.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-bold text-base transition-all cursor-pointer shadow-lg shadow-blue-500/25"
              >
                Launch Dashboard <ArrowRight className="w-5 h-5" />
              </button>
              <a
                href="#how-it-works"
                className="flex items-center gap-2 px-8 py-3.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold text-base hover:bg-slate-50 transition-all cursor-pointer"
              >
                See How It Works
              </a>
            </div>
          </div>

          {/* Stats cards */}
          <div className="lg:flex-1 mt-12 lg:mt-0 grid gap-4">
            {stats.map((s, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow flex items-center gap-5">
                <div className={`text-4xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-sm text-slate-500 font-semibold uppercase tracking-wide">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The Problem */}
      <section className="bg-slate-900 text-white py-16">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center gap-3 mb-4">
            <Clock className="w-5 h-5 text-red-400" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-red-400">The Problem</h2>
          </div>
          <h3 className="text-3xl font-bold mb-4">The "Bay-to-Desk" Bottleneck</h3>
          <p className="text-slate-400 text-lg max-w-3xl leading-relaxed mb-10">
            A master technician earns $40–$60/hr turning wrenches. But they spend up to <strong className="text-white">25% of their shift</strong> walking
            to the front desk, cleaning grease off their hands, waiting for a Service Advisor, and manually building quotes in clunky Shop Management Systems.
          </p>
          <div className="grid md:grid-cols-4 gap-4">
            {["Walk to desk", "Wait for computer", "Search portals", "Enter into SMS"].map((step, i) => (
              <div key={i} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5 text-center">
                <div className="text-3xl font-bold text-red-400 mb-1">{[8, 5, 12, 10][i]}min</div>
                <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">{step}</div>
              </div>
            ))}
          </div>
          <p className="text-slate-500 text-sm mt-4">35 minutes of lost billable time per repair order</p>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-slate-900 mb-4">How BayOps Solves It</h2>
        <p className="text-slate-500 max-w-2xl mb-12">Three capabilities working in concert to eliminate the desk bottleneck entirely.</p>
        <div className="grid md:grid-cols-3 gap-8">
          {features.map((f, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm hover:shadow-md transition-shadow">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-6 ${f.color}`}>
                <f.icon className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-lg text-slate-900 mb-2">{f.title}</h3>
              <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Workflow */}
      <section id="how-it-works" className="bg-white border-y border-slate-200 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-slate-900 mb-4">The Execution Loop</h2>
          <p className="text-slate-500 max-w-2xl mb-12">One voice command triggers the entire pipeline — from parsing to checkout.</p>
          <div className="space-y-4">
            {workflow.map((w, i) => (
              <div key={i} className="flex items-center gap-6 bg-slate-50 rounded-2xl p-6 border border-slate-200 hover:bg-blue-50 hover:border-blue-200 transition-all group">
                <div className="w-12 h-12 rounded-xl bg-blue-500 text-white flex items-center justify-center font-bold text-sm shrink-0 group-hover:scale-110 transition-transform">
                  {w.step}
                </div>
                <w.icon className="w-5 h-5 text-slate-400 shrink-0" />
                <div className="flex-1">
                  <h4 className="font-bold text-slate-900">{w.title}</h4>
                  <p className="text-sm text-slate-500">{w.desc}</p>
                </div>
                {i < workflow.length - 1 && <ChevronRight className="w-4 h-4 text-slate-300" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-slate-900 mb-4">The Tech Stack</h2>
        <p className="text-slate-500 max-w-2xl mb-12">Built on free-tier APIs and open-source libraries. Zero cost to run.</p>
        <div className="grid md:grid-cols-3 gap-4">
          {techStack.map((t, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-sm transition-shadow">
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200">
                  {t.tag}
                </span>
              </div>
              <h4 className="font-bold text-slate-900">{t.name}</h4>
              <p className="text-xs text-slate-400 mt-1">{t.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-blue-500 py-16">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4">Ready to eliminate the bottleneck?</h2>
          <p className="text-blue-100 text-lg mb-8">Open the dashboard and try a voice command right now.</p>
          <button
            onClick={() => navigate("/dashboard")}
            className="px-10 py-4 rounded-xl bg-white text-blue-600 font-bold text-base hover:bg-blue-50 transition-all cursor-pointer shadow-xl"
          >
            Launch BayOps Dashboard
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 text-center text-slate-400 text-sm border-t border-slate-200 bg-white">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-5 h-5 bg-blue-500 rounded flex items-center justify-center text-white text-[10px] font-bold">B</div>
          <span className="font-bold text-slate-600">BayOps AI</span>
        </div>
        &copy; 2026 BayOps Systems. Autonomous service bay workflows.
      </footer>
    </div>
  );
}
