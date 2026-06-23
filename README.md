# BayOps AI — Autonomous Voice-Driven Service Advisor

## The Problem: The "Bay-to-Desk" Bottleneck

A master technician earns $40–$60/hr turning wrenches. But they spend up to **25% of their shift** walking away from the car, cleaning grease off their hands, waiting for a Service Advisor, and manually building quotes in clunky Shop Management Systems like Mitchell 1, AllData, or Tekmetric.

**That's $39,000+ per tech per year in lost billable labor.**

## The Solution

BayOps AI is an autonomous Service Advisor that lives in the technician's headset. It listens to verbal diagnostics, autonomously navigates parts supplier websites, finds the cheapest/fastest parts, and builds the estimate — all while the tech stays under the car.

## The End-to-End Automation Loop

### 1. Voice Trigger (In the Bay)

The technician taps their headset without putting down their tools:

> *"Bay 4. The F-150 needs front brake pads and two front rotors. The calipers are fine. Order Motorcraft or premium aftermarket. Add 1.5 hours of labor. Send the estimate to the customer."*

### 2. Browser Execution (The Magic)

The AI parses the intent and spins up parallel browser agents:

- **Agent 1 — Parts Sourcing**: Logs into wholesale portals (WorldPac, AutoZone Commercial). Searches the exact VIN, compares price and delivery time, adds optimal parts to cart.
- **Agent 2 — Shop Management**: Logs into the shop's CRM (Shop-Ware, Tekmetric). Locates the Repair Order, inputs parts cost with markup, adds labor hours.
- **Agent 3 — Customer Comms**: Generates a mobile-friendly quote and sends SMS: *"Hi John, your F-150 needs front brakes. Total is $428. Click here to approve."*

### 3. Closure

Customer clicks "Approve" on their phone → Agent 1 auto-clicks "Checkout" on WorldPac → parts driver dispatched → technician hears in headset: *"Brakes approved. Parts arriving in 30 minutes. Proceed with tear down."*

---

## Current MVP Status

| Feature | Status |
|---------|--------|
| Voice input (ElevenLabs STT) | ✅ Working (Upload mode) |
| Text input | ✅ Working |
| Groq intent parsing (vehicle, parts, tech, bay) | ✅ Working |
| AutoZone web search with real prices | ✅ Working |
| Playwright browser → add to cart → show checkout | ✅ Working |
| Real-time WebSocket progress updates | ✅ Working |
| Live mic recording | ⚠️ Needs Windows mic permissions |
| Multi-vendor price comparison | 🔜 Planned |
| Shop Management System integration | 🔜 Planned |
| Customer SMS quotes (Twilio) | 🔜 Planned |
| Customer approval → auto-checkout | 🔜 Planned |

## Quick Start

### 1. Add API Keys

Create `backend/.env`:

```
GROQ_API_KEY=your_groq_key
ELEVENLABS_API_KEY=your_elevenlabs_key
```

- **Groq** (free): https://console.groq.com — voice parsing + search extraction
- **ElevenLabs** (free): https://elevenlabs.io — speech-to-text

### 2. Install & Run Backend

```bash
cd backend
pip install -r requirements.txt
playwright install chromium
python main.py
```

Runs on http://localhost:8000

### 3. Install & Run Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on http://localhost:5173

## Input Modes

| Mode | How |
|------|-----|
| **Type** | Type a command directly |
| **Upload** | Upload an audio file (.mp3, .wav, .m4a) — transcribed by ElevenLabs |
| **Voice** | Record from mic — requires Windows mic permissions |

### Example Command

> "Hey this is Mike in bay 3, I got a 2019 Honda Civic needs front brake pads and an oil filter from AutoZone"

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  React UI   │────▶│  FastAPI +   │────▶│  Groq LLM       │
│  (Vite)     │◀────│  WebSockets  │     │  (llama-3.3-70b)│
└─────────────┘     └──────┬───────┘     └─────────────────┘
                           │
                    ┌──────┴───────┐
                    │              │
              ┌─────▼─────┐ ┌─────▼──────┐
              │ DuckDuckGo│ │ Playwright  │
              │ Search    │ │ Browser     │
              │ (AutoZone)│ │ (Add→Cart)  │
              └───────────┘ └────────────┘
```

## Tech Stack

- **Frontend**: React 19 + Vite + Tailwind CSS v4 + Lucide Icons
- **Backend**: Python 3.11 + FastAPI + WebSockets
- **Voice Parsing**: Groq (llama-3.3-70b-versatile) — ~500 tokens/request
- **Speech-to-Text**: ElevenLabs Scribe v1
- **Web Search**: DuckDuckGo (free, no API key needed)
- **Browser Automation**: Playwright — zero LLM tokens, pure CSS selectors
- **Real-time Updates**: WebSocket broadcast to all connected clients

## Project Structure

```
backend/
  main.py             FastAPI server, WebSocket manager, ElevenLabs transcription
  llm_parser.py       Groq voice-to-JSON parser
  parts_agent.py      DuckDuckGo search + Groq price extraction (AutoZone only)
  browser_agent.py    Playwright automation (add to cart → checkout page)
  schemas.py          Pydantic data models
  .env                API keys (not committed)

frontend/
  src/App.jsx         Main dashboard — voice/upload/text input, results, terminal
  src/components/
    BayCard.jsx       Sidebar bay status cards
    AgentLog.jsx      Terminal-style agent log output
```

## API Token Usage (Groq Free Tier)

| Action | Tokens | Model |
|--------|--------|-------|
| Voice parsing | ~500 | llama-3.3-70b-versatile |
| Price extraction (per part) | ~1,000 | llama-3.3-70b-versatile |
| Browser automation | **0** | Playwright (no LLM) |
| **Total per request (2 parts)** | **~2,500** | — |

Groq free tier: 500,000 tokens/day → supports ~200 requests/day.
