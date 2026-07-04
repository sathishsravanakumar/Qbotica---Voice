# BayOps AI — Design Document

**Version:** 1.1 | **Date:** July 2026

---

## What It Is

Voice-driven parts ordering assistant for auto repair shops. A mechanic speaks from the bay — BayOps AI handles the conversation, searches parts prices across vendors, builds the estimate, and adds items to cart automatically.

---

## How It Works

```
Mechanic speaks/types
        ↓
Chat Agent (Groq) — collects name, bay, vehicle, parts via conversation
        ↓
Parts Agent — searches AutoZone, O'Reilly, Advance Auto in parallel (DuckDuckGo)
        ↓
Billing — applies 25% markup + 8.25% tax, shows live estimate
        ↓
Browser Agent (background) — opens vendor site, adds to cart
        ↓
Excel Export (on demand) — saves order to Desktop .xlsx, updates live on every billing change
```

All updates broadcast to the frontend in real time via WebSocket.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React + Vite + Tailwind CSS |
| Backend | Python + FastAPI |
| AI Conversation | Groq (`llama-3.3-70b-versatile`) |
| Parts Search | DuckDuckGo (free, no key) |
| Speech-to-Text | ElevenLabs Scribe v1 |
| Text-to-Speech | ElevenLabs TTS |
| Browser Automation | Playwright (fallback) or Claude Computer Use |
| Excel Creation | openpyxl |
| Excel Live Updates | xlwings (Windows COM) |
| Real-time | FastAPI WebSocket |

---

## Files

```
backend/
  main.py            — FastAPI server, all endpoints, WebSocket, bay state
  chat_agent.py      — Conversational AI; enforces required fields before acting
  parts_agent.py     — Parallel vendor search + Groq price extraction
  billing.py         — Markup, labor, tax calculation
  browser_agent.py   — Playwright / Claude Computer Use cart automation
  excel_export.py    — openpyxl file creation + xlwings live COM updates
  schemas.py         — Pydantic models (BayStatus, BillingLineItem, etc.)
  llm_parser.py      — One-shot LLM parser (used by voice flow)
  requirements.txt

frontend/src/
  App.jsx            — Dashboard (chat, parts table, billing panel, export button)
  HomePage.jsx       — Landing page
  components/        — ChatThread, BillingPanel, BayCard, AgentLog
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/chat` | POST | Send a chat message, get AI response + trigger actions |
| `/api/transcribe` | POST | Audio file → text (ElevenLabs) |
| `/api/tts` | POST | Text → speech (ElevenLabs) |
| `/api/bays` | GET | All 6 bay states |
| `/api/bays/{id}/billing` | GET | Bay billing breakdown |
| `/api/bays/{id}/switch-vendor` | POST | Override vendor for a part |
| `/api/bays/{id}/remove-item` | POST | Remove a part or labor item from estimate |
| `/api/bays/{id}/edit-item` | POST | Change quantity/hours of an item |
| `/api/bays/{id}/export-excel` | POST | Export order to Desktop .xlsx + open in Excel |
| `/api/bays/{id}/clear` | POST | Reset bay |
| `/ws` | WebSocket | Real-time push for all state changes |

---

## Bay State

Each of the 6 bays holds:
- `vehicle` — year, make, model
- `technician_name`
- `all_items` — accumulated parts + labor across conversation turns
- `all_results` — accumulated search results (for vendor switching)
- `billing` — live estimate (parts, labor, tax, total)
- `chat_history` — full conversation per bay
- `logs` — browser agent terminal output

State is in-memory only — resets on server restart.

---

## Shop Configuration

```python
labor_rate     = $150.00 / hr
parts_markup   = 25%
tax_rate       = 8.25%
```

Configurable in `ShopConfig` in `schemas.py`.

---

## Excel Export

- Click **Export to Excel** in the billing panel → creates `BayOps_Order_YYYYMMDD_HHMMSS.xlsx` on the Desktop and opens it in Excel via xlwings COM
- Every subsequent billing change (new part, labor, vendor switch) auto-updates the open workbook live — cursor visibly moves through cells as data is rewritten
- On bay reset, the live link is severed

---

## API Keys Required

| Key | Service | Required? |
|-----|---------|-----------|
| `GROQ_API_KEY` | Conversation + price extraction | Yes |
| `ELEVENLABS_API_KEY` | STT + TTS | Yes (for voice) |
| `ANTHROPIC_API_KEY` | Claude Computer Use browser agent | No — Playwright fallback used |

---

## Roadmap

- Agent 2: Auto-create repair orders in Tekmetric / Shop-Ware
- Agent 3: Customer SMS quote + approval via Twilio
- CAT-based exact fitment lookup
- More vendors (WorldPac, NAPA, RockAuto)
