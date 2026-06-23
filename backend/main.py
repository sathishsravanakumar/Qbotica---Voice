import asyncio
import json
import os
import threading
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from schemas import VoiceCommandRequest, BayStatus, AgentStatus, ShopConfig
from llm_parser import parse_voice_transcript
from parts_agent import lookup_parts
from billing import calculate_billing
from browser_agent import run_browser_checkout

load_dotenv()

bays: dict[str, BayStatus] = {}
shop_config = ShopConfig()


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        data = json.dumps(message)
        for conn in list(self.active_connections):
            try:
                await conn.send_text(data)
            except Exception:
                self.active_connections.remove(conn)

manager = ConnectionManager()


async def recalculate_and_broadcast_billing(bay_id: str):
    bay = bays[bay_id]
    bay.billing = calculate_billing(bay.all_items, bay.all_results, shop_config)
    await manager.broadcast({
        "type": "billing_update",
        "bay": bay_id,
        "billing": bay.billing.model_dump(),
    })


def start_browser_thread(intent, search_results, bay_id):
    """Run browser checkout in a separate thread with its own event loop."""
    def _run():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_browser_work(intent, search_results, bay_id))
        finally:
            loop.close()

    t = threading.Thread(target=_run, daemon=True)
    t.start()


async def _browser_work(intent, search_results, bay_id):
    import traceback

    async def log_cb(msg: str):
        if bay_id in bays:
            bays[bay_id].logs.append(msg)
        print(f"[Browser Bay {bay_id}] {msg}", flush=True)

    try:
        bays[bay_id].status = AgentStatus.BROWSING

        outcomes = await run_browser_checkout(intent, search_results, log_cb)

        # Update prices from actual cart data — match by index order
        cart_items = outcomes.get("cart_items", [])
        if cart_items:
            part_results = [r for r in bays[bay_id].all_results if r.get("description")]
            for i, ci in enumerate(cart_items):
                if i < len(part_results) and ci.get("price", 0) > 0:
                    part_results[i]["price"] = f"${ci['price']:.2f}"
                    if ci.get("part_number"):
                        part_results[i]["part_number"] = ci["part_number"]

            # Recalculate billing with real cart prices
            bays[bay_id].billing = calculate_billing(bays[bay_id].all_items, bays[bay_id].all_results, shop_config)
            bays[bay_id].logs.append(f"Billing synced with cart: ${bays[bay_id].billing.total:.2f}")
            print(f"[Browser Bay {bay_id}] Billing updated: ${bays[bay_id].billing.total:.2f}", flush=True)

        bays[bay_id].status = AgentStatus.COMPLETE
        bays[bay_id].results["browser"] = outcomes
        print(f"[Browser Bay {bay_id}] Task complete", flush=True)

    except Exception as e:
        print(f"[Browser Bay {bay_id}] CRASH: {traceback.format_exc()}", flush=True)
        bays[bay_id].status = AgentStatus.ERROR
        bays[bay_id].logs.append(f"Browser failed: {str(e)}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    for i in range(1, 7):
        bays[str(i)] = BayStatus(bay_number=str(i))
    yield

app = FastAPI(title="BayOps AI", version="0.5.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        return {"error": "ELEVENLABS_API_KEY not set in .env"}

    audio_bytes = await audio.read()

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": api_key},
            files={"file": (audio.filename or "recording.webm", audio_bytes, audio.content_type or "audio/webm")},
            data={"model_id": "scribe_v1"},
        )

    if resp.status_code != 200:
        return {"error": f"ElevenLabs error {resp.status_code}: {resp.text}"}

    return {"transcript": resp.json().get("text", "")}


@app.post("/api/voice-command")
async def voice_command(req: VoiceCommandRequest):
    bay_id = req.bay_number or "1"
    if bay_id not in bays:
        bays[bay_id] = BayStatus(bay_number=bay_id)

    bays[bay_id].status = AgentStatus.PARSING
    bays[bay_id].logs.append(f'Received: "{req.transcript}"')
    await manager.broadcast({"type": "status_update", "bay": bay_id, "status": "PARSING"})

    # Step 1: Parse
    try:
        intent = await parse_voice_transcript(req.transcript)
    except Exception as e:
        bays[bay_id].status = AgentStatus.ERROR
        return {"status": "error", "message": f"Parse failed: {str(e)}"}

    # Keep vehicle from previous command if this is a labor-only update
    if intent.vehicle.year != "N/A" and intent.vehicle.make != "N/A":
        bays[bay_id].vehicle = intent.vehicle
    if intent.technician_name != "Unknown":
        bays[bay_id].technician_name = intent.technician_name

    bays[bay_id].items = intent.items
    bays[bay_id].all_items.extend(intent.items)
    bays[bay_id].logs.append("Parsed successfully.")
    await manager.broadcast({"type": "parsed", "bay": bay_id, "intent": intent.model_dump()})

    # Step 2: Search for parts (skip if only labor items)
    has_parts = any(i.item_type == "PART" for i in intent.items)
    search_results = {"results": [], "summary": ""}

    if has_parts:
        bays[bay_id].logs.append("Searching AutoZone...")
        try:
            search_results = await lookup_parts(intent)
        except Exception as e:
            bays[bay_id].status = AgentStatus.ERROR
            return {"status": "error", "message": f"Search failed: {str(e)}", "parsed_intent": intent.model_dump()}

        bays[bay_id].results = search_results
        if search_results.get("results"):
            bays[bay_id].all_results.extend(search_results["results"])
        bays[bay_id].logs.append(search_results.get("summary", "Done."))
        await manager.broadcast({"type": "search_complete", "bay": bay_id, "results": search_results})

    # Step 3: Recalculate billing
    await recalculate_and_broadcast_billing(bay_id)
    bays[bay_id].logs.append(f"Billing updated: ${bays[bay_id].billing.total:.2f}")

    # Step 4: Auto-launch browser for parts (skip if labor-only)
    if has_parts and search_results.get("results"):
        start_browser_thread(intent, search_results, bay_id)

    bays[bay_id].status = AgentStatus.COMPLETE if not has_parts else bays[bay_id].status

    return {
        "status": "ok",
        "bay": bay_id,
        "parsed_intent": intent.model_dump(),
        "parts_results": search_results,
        "billing": bays[bay_id].billing.model_dump(),
    }


@app.get("/api/bays")
async def get_bays():
    return {bid: b.model_dump() for bid, b in bays.items()}


@app.get("/api/bays/{bay_id}/billing")
async def get_bay_billing(bay_id: str):
    if bay_id not in bays:
        return {"error": "Bay not found"}
    return bays[bay_id].billing.model_dump()


@app.post("/api/bays/{bay_id}/clear")
async def clear_bay(bay_id: str):
    if bay_id in bays:
        bays[bay_id] = BayStatus(bay_number=bay_id)
    await manager.broadcast({"type": "bay_cleared", "bay": bay_id})
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
