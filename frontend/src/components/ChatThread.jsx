import { useEffect, useRef } from "react";
import { Mic, MicOff, Loader, Bot, User, Send, Upload } from "lucide-react";

export default function ChatThread({ messages, sending, status, onMicToggle, isRecording, audioLevel, onTextSend, onFileUpload }) {
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, status]);

  return (
    <div className="flex flex-col h-full">

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3 min-h-0">
        {messages.length === 0 && !status && (
          <div className="text-center py-16">
            <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Bot className="w-7 h-7 text-amber-600" />
            </div>
            <p className="text-base font-semibold text-slate-700">Hi, I'm your Service Advisor</p>
            <p className="text-sm text-slate-400 mt-1 max-w-xs mx-auto">Press the mic and tell me what you need — vehicle, parts, labor. I'll handle the rest.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade`}>
            <div className={`flex items-end gap-2 max-w-[80%] ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0
                ${msg.role === "user" ? "bg-amber-600" : "bg-slate-100"}`}>
                {msg.role === "user" ? <User className="w-3.5 h-3.5 text-white" /> : <Bot className="w-3.5 h-3.5 text-slate-500" />}
              </div>
              <div className={`rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed
                ${msg.role === "user"
                  ? "bg-amber-600 text-white rounded-br-md"
                  : "bg-slate-100 text-slate-800 rounded-bl-md"}`}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {/* Status indicator */}
        {status && (
          <div className="flex justify-start animate-fade">
            <div className="flex items-end gap-2">
              <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <Bot className="w-3.5 h-3.5 text-slate-500" />
              </div>
              <div className="bg-slate-100 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-slate-500 italic">
                {status}
              </div>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input Bar */}
      <div className="border-t border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Text input */}
          <form onSubmit={(e) => { e.preventDefault(); const v = inputRef.current?.value?.trim(); if (v) { onTextSend(v); inputRef.current.value = ""; } }} className="flex-1 flex items-center gap-2">
            <input ref={inputRef} type="text" placeholder="Or type here..."
              className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-300 focus:ring-1 focus:ring-amber-100" />
            <button type="submit" className="p-2 text-slate-400 hover:text-amber-600 transition cursor-pointer">
              <Send className="w-4 h-4" />
            </button>
          </form>

          {/* Upload audio */}
          <label className="w-10 h-10 rounded-full bg-slate-100 hover:bg-amber-50 flex items-center justify-center cursor-pointer transition shrink-0" title="Upload audio file">
            <Upload className="w-4 h-4 text-slate-500" />
            <input type="file" accept="audio/*" className="hidden" onChange={onFileUpload} disabled={sending} />
          </label>

          {/* Mic button */}
          <button
            onClick={onMicToggle}
            disabled={sending}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-lg disabled:opacity-40 shrink-0
              ${isRecording
                ? "bg-red-500 hover:bg-red-600 text-white scale-110 animate-pulse"
                : "bg-amber-600 hover:bg-amber-500 text-white"}`}
          >
            {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
        </div>

        {/* Audio level */}
        {isRecording && (
          <div className="mt-2 h-1 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-75 ${audioLevel > 30 ? "bg-emerald-500" : audioLevel > 5 ? "bg-amber-400" : "bg-red-400"}`}
              style={{ width: `${audioLevel}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
