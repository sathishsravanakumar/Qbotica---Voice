# BayOps AI — Design Document

**Version:** 1.3 | **Date:** July 2026

---

## What It Is

Voice-driven parts ordering assistant for auto repair shops. A mechanic speaks from the bay — BayOps AI handles the conversation, verifies fitment, searches parts prices across vendors in parallel, builds the estimate, and adds items to cart automatically.

---

## How It Works

```
Mechanic speaks/types
        ↓
Chat Agent (Groq) — collects name, bay, vehicle, parts via conversation
        ↓
Fitment Agent — NHTSA vPIC lookup + Groq verification (confirms part fits vehicle)
        ↓
Parts Agent — parallel async search across AutoZone, NAPA Auto Parts, Advance Auto (DuckDuckGo)
             ↳ In-process cache (10-min TTL) skips repeat searches
             ↳ Price sanity check rejects hallucinated prices (<$0.50 or >$5,000)
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
| Fitment Verification | NHTSA vPIC API + Groq reasoning |
| Parts Search | DuckDuckGo (free, no key) + in-process session cache |
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
  parts_agent.py     — Parallel vendor search + Groq price extraction + session cache
  fitment_agent.py   — NHTSA vPIC lookup + Groq fitment verification
  billing.py         — Markup, labor, tax calculation
  browser_agent.py   — Playwright / Claude Computer Use cart automation
  excel_export.py    — openpyxl file creation + xlwings live COM updates
  schemas.py         — Pydantic models (BayStatus, BillingLineItem, etc.)
  utils.py           — Shared utilities (parse_price, parse_price_float)
  requirements.txt

frontend/src/
  App.jsx            — Dashboard (chat, parts table, billing panel, export/copy buttons)
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
| `/api/bays/{id}/override-fitment` | POST | Mark a fitment warning as accepted |
| `/api/bays/{id}/export-excel` | POST | Export order to Desktop .xlsx + open in Excel |
| `/api/bays/{id}/clear` | POST | Reset bay |
| `/ws` | WebSocket | Real-time push for all state changes |

### WebSocket Event Types

| Event | Direction | Payload |
|-------|-----------|---------|
| `search_started` | Server → Client | `{bay, count}` — triggers search spinner |
| `search_complete` | Server → Client | `{bay, results}` — dismisses spinner, shows parts table |
| `billing_update` | Server → Client | `{bay, billing}` — refreshes live estimate panel |
| `fitment_warning` | Server → Client | `{bay, halted, issues, clarification_needed}` — shows fitment card |
| `cart_verified` | Server → Client | `{bay, verified, cart_total, expected_total, mismatch, cart_items}` — plays chime, shows confirmation |
| `agent_log` | Server → Client | `{bay, message}` — appends a line to the agent log panel |
| `bay_cleared` | Server → Client | `{bay}` — resets all UI state for that bay |

### Chat Action Types (`action` field in `/api/chat`)

| Action | Meaning |
|--------|---------|
| `SOURCE_PARTS` | Search vendors and compare prices |
| `ADD_LABOR` | Add labor hours to estimate |
| `CHECKOUT` | Open browser, add parts to cart |
| `REMOVE_ITEM` | Remove a part or labor line |
| `EDIT_ITEM` | Change quantity or hours |
| `SET_PRICE` | Manually override a part price ("set brake pads to $45") |

---

## Bay State

Each of the 6 bays holds:
- `vehicle` — year, make, model
- `technician_name`
- `all_items` — accumulated parts + labor across conversation turns
- `all_results` — accumulated search results (for vendor switching + price override)
- `billing` — live estimate (parts, labor, tax, total)
- `chat_history` — full conversation per bay
- `logs` — browser agent terminal output

State is in-memory only — resets on server restart.

---

## Search Architecture

Parts search runs with `asyncio.gather` so all parts in a single request are searched concurrently. Each vendor is also searched concurrently within a part.

**Per-part flow (one Groq call total, not one per vendor):**
1. Three vendor DDG fetches run in parallel via `run_in_executor` (one `site:{domain}` query each, max 5 results)
2. If DDG returns nothing for a vendor, an `httpx` direct-GET fallback hits the vendor's search page and parses embedded `"price":"XX.XX"` JSON patterns from the HTML
3. All three vendors' raw results are combined into a single Groq call (`extract_all_vendors`) — the model receives one labelled section per vendor and returns a `vendors` array. This reduces Groq calls from 3 per part to 1 per part (9 → 3 for a typical 3-part request)
4. Snippet and title text is capped at 150/120 characters per result, and at most 3 results per vendor are sent, keeping the extraction prompt compact

A dict-based cache (`_SEARCH_CACHE`) keyed on `{year}|{make}|{model}|{description}` stores results for 10 minutes, preventing redundant DDG hits when the same part is re-queried within a session.

After extraction, a sanity check rejects prices below $0.50 or above $5,000 (replaced with "See website") to prevent hallucinated values entering billing. DDG searches retry once with a 0.5 s delay on transient failure.

**Chat agent token controls:** history sent to Groq is capped at the last 8 messages (4 turns); the completion is bounded by `max_tokens=512`; bay context omits verbose product names and sends only description + price + vendor for already-found parts.

---

## Fitment Verification

When parts are found, `fitment_agent.py` calls NHTSA vPIC to normalize the vehicle (decode make/model IDs, trim levels, engine variants) then asks Groq whether each part is likely compatible. NHTSA responses are cached in-process per `{vin}|{year}|{make}|{model}` to avoid repeat API calls within a session. Results are broadcast as `fitment_warning` events. Mechanics can override a warning via the frontend toggle or the `/api/bays/{id}/override-fitment` endpoint; the override is stored on the bay and respected in subsequent billing.

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

- Click **Export to Excel** → creates `BayOps_Order_YYYYMMDD_HHMMSS.xlsx` on the Desktop and opens it in Excel via xlwings COM
- Every subsequent billing change auto-updates the open workbook live
- Labor sub-headers and total rows are rewritten on every update to survive `clear_contents()` calls
- On bay reset, the live link is severed

---

## UX Features

| Feature | How it works |
|---------|-------------|
| Search spinner | `search_started` WebSocket event shows a spinner card during the 3–10 s vendor search |
| Product name | Parts panel shows mechanic's description + actual product name from vendor |
| Confirm before clear | Trash button requires inline Yes/No confirmation before wiping a bay |
| Copy estimate | One-click plain-text copy of the full estimate for pasting into a shop management system |
| Expandable agent log | Toggle between compact (180 px) and full-height (400 px) terminal view |
| Mobile sidebar | Hamburger menu slides sidebar in/out on small screens; overlay tap dismisses |
| Cart chime | Web Audio API plays a short 880 Hz tone when `cart_verified` fires |

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `GROQ_API_KEY` | — | Required — AI conversation + price extraction |
| `ELEVENLABS_API_KEY` | — | Required for voice — STT + TTS |
| `ANTHROPIC_API_KEY` | — | Optional — Claude Computer Use browser agent |
| `BROWSER_HEADLESS` | `false` | Set `true` to run Playwright browser in background |

---

## Roadmap

- Agent 2: Auto-create repair orders in Tekmetric / Shop-Ware
- Agent 3: Customer SMS quote + approval via Twilio
- SQLite persistence — bay state survives server restarts
- Order history — completed jobs stored and searchable
- More vendors (WorldPac, RockAuto)
- PDF export for print-ready estimates
