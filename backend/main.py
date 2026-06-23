import asyncio
import json
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from schemas import ChatRequest, ChatMessage, BayStatus, AgentStatus, ShopConfig, MechanicIntent
from parts_agent import lookup_parts
from billing import calculate_billing
from browser_agent import run_browser_checkout
from chat_agent import process_chat_message

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


async def recalculate_billing(bay_id: str):
    bay = bays[bay_id]
    bay.billing = calculate_billing(bay.all_items, bay.all_results, shop_config)


async def execute_intent(intent: MechanicIntent, bay_id: str) -> dict:
    """Shared pipeline: update bay state, search parts, recalc billing. Returns search results."""
    bay = bays[bay_id]

    if intent.vehicle.year != "N/A" and intent.vehicle.make != "N/A":
        bay.vehicle = intent.vehicle
    if intent.technician_name != "Unknown":
        bay.technician_name = intent.technician_name

    bay.items = intent.items
    bay.all_items.extend(intent.items)

    has_parts = any(i.item_type == "PART" for i in intent.items)
    search_results = {"results": [], "summary": ""}

    if has_parts:
        bay.logs.append("Searching AutoZone...")
        search_results = await lookup_parts(intent)
        bay.results = search_results
        if search_results.get("results"):
            bay.all_results.extend(search_results["results"])

    await recalculate_billing(bay_id)
    return search_results


def start_browser_thread(intent, search_results, bay_id):
    def _run():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_browser_work(intent, search_results, bay_id))
        finally:
            loop.close()
    threading.Thread(target=_run, daemon=True).start()


async def _browser_work(intent, search_results, bay_id):
    import traceback

    async def log_cb(msg: str):
        if bay_id in bays:
            bays[bay_id].logs.append(msg)
        print(f"[Browser Bay {bay_id}] {msg}", flush=True)

    try:
        bays[bay_id].status = AgentStatus.BROWSING
        outcomes = await run_browser_checkout(intent, search_results, log_cb)

        cart_items = outcomes.get("cart_items", [])
        if cart_items:
            part_results = [r for r in bays[bay_id].all_results if r.get("description")]
            for i, ci in enumerate(cart_items):
                if i < len(part_results) and ci.get("price", 0) > 0:
                    part_results[i]["price"] = f"${ci['price']:.2f}"
                    if ci.get("part_number"):
                        part_results[i]["part_number"] = ci["part_number"]
            bays[bay_id].billing = calculate_billing(bays[bay_id].all_items, bays[bay_id].all_results, shop_config)
            bays[bay_id].logs.append(f"Billing synced: ${bays[bay_id].billing.total:.2f}")

        bays[bay_id].status = AgentStatus.COMPLETE
        bays[bay_id].results["browser"] = outcomes
    except Exception as e:
        print(f"[Browser Bay {bay_id}] CRASH: {traceback.format_exc()}", flush=True)
        bays[bay_id].status = AgentStatus.ERROR
        bays[bay_id].logs.append(f"Browser failed: {str(e)}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    for i in range(1, 7):
        bays[str(i)] = BayStatus(bay_number=str(i))
    yield

app = FastAPI(title="BayOps AI", version="1.0.0", lifespan=lifespan)

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


@app.post("/api/tts")
async def text_to_speech(req: dict):
    """Convert text to speech using ElevenLabs TTS."""
    from fastapi.responses import Response

    api_key = os.getenv("ELEVENLABS_API_KEY")
    text = req.get("text", "")
    if not api_key or not text:
        return Response(content=b"", media_type="audio/mpeg")

    voice_id = "JBFqnCBsd6RMkjVDRZzb"

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
            headers={"xi-api-key": api_key, "Content-Type": "application/json"},
            json={
                "text": text,
                "model_id": "eleven_turbo_v2_5",
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
            },
        )

    if resp.status_code != 200:
        return Response(content=b"", media_type="audio/mpeg")

    return Response(content=resp.content, media_type="audio/mpeg")


@app.post("/api/chat")
async def chat(req: ChatRequest):
    bay_id = req.bay_number
    if bay_id not in bays:
        bays[bay_id] = BayStatus(bay_number=bay_id)

    bay = bays[bay_id]
    now = datetime.now().isoformat()

    # Add user message to history
    bay.chat_history.append(ChatMessage(role="user", content=req.message, timestamp=now))

    # Call the conversational agent
    try:
        result = await process_chat_message(bay, req.message)
    except Exception as e:
        reply = f"Sorry, something went wrong: {str(e)}"
        bay.chat_history.append(ChatMessage(role="assistant", content=reply, timestamp=now))
        return {"reply": reply, "response_type": "message", "billing": None, "parts_results": None}

    reply = result.get("reply", "")
    response_type = result.get("response_type", "message")
    action_data = result.get("action_data")

    billing_out = None
    parts_out = None

    # Execute action if the agent decided to act
    if response_type == "action" and action_data:
        try:
            action_type = action_data.get("action", "")
            items_data = action_data.get("items", [])

            if action_type == "REMOVE_ITEM":
                remove_desc = items_data[0].get("description", "").lower() if items_data else ""
                if remove_desc:
                    before = len(bay.all_items)
                    bay.all_items = [it for it in bay.all_items if remove_desc not in it.description.lower()]
                    bay.all_results = [r for r in bay.all_results if remove_desc not in r.get("description", "").lower()]
                    bay.items = [it for it in bay.items if remove_desc not in it.description.lower()]
                    removed = before - len(bay.all_items)
                    await recalculate_billing(bay_id)
                    if removed > 0:
                        reply = f"Removed. Total: ${bay.billing.total:.2f}."
                    else:
                        reply = f"Couldn't find that item on the estimate."

            elif action_type == "CHECKOUT":
                # Fill in missing fields from bay state for MechanicIntent
                if not action_data.get("vehicle") and bay.vehicle:
                    action_data["vehicle"] = {"year": bay.vehicle.year, "make": bay.vehicle.make, "model": bay.vehicle.model, "vin": None}
                action_data.setdefault("bay_number", bay_id)
                action_data.setdefault("technician_name", bay.technician_name or "Unknown")
                action_data.setdefault("vehicle", {"year": "N/A", "make": "N/A", "model": "N/A", "vin": None})
                action_data.setdefault("items", [])

                intent = MechanicIntent(**action_data)
                search_results = bay.results if bay.results.get("results") else {"results": [], "summary": ""}
                start_browser_thread(intent, search_results, bay_id)
                bay.logs.append("Browser checkout launched.")
                reply += f" Opening AutoZone checkout..."

            else:
                # SOURCE_PARTS / ADD_LABOR — fill missing fields from bay state
                action_data.setdefault("bay_number", bay_id)
                action_data.setdefault("technician_name", bay.technician_name or "Unknown")
                if not action_data.get("vehicle") and bay.vehicle:
                    action_data["vehicle"] = {"year": bay.vehicle.year, "make": bay.vehicle.make, "model": bay.vehicle.model, "vin": None}
                action_data.setdefault("vehicle", {"year": "N/A", "make": "N/A", "model": "N/A", "vin": None})

                intent = MechanicIntent(**action_data)
                search_results = await execute_intent(intent, bay_id)
                parts_out = search_results

                if search_results.get("results"):
                    parts_info = ", ".join(
                        f"{r.get('product_name', r.get('description', ''))} at {r.get('price', 'N/A')}"
                        for r in search_results["results"]
                    )
                    reply += f" Found: {parts_info}."

                if bay.billing.total > 0:
                    reply += f" Current total: ${bay.billing.total:.2f}."

                # Auto-launch browser to add parts to cart
                has_parts = any(i.item_type == "PART" for i in intent.items)
                if has_parts and search_results.get("results"):
                    start_browser_thread(intent, search_results, bay_id)
                    reply += " Opening AutoZone to add to cart..."

            billing_out = bay.billing.model_dump()
            bay.status = AgentStatus.COMPLETE

        except Exception as e:
            reply += f" (Error: {str(e)[:80]})"
            bay.status = AgentStatus.ERROR

    # Add assistant reply to history
    bay.chat_history.append(ChatMessage(
        role="assistant",
        content=reply,
        timestamp=datetime.now().isoformat(),
        has_action=(response_type == "action"),
    ))

    # Trim history to last 20 messages
    if len(bay.chat_history) > 20:
        bay.chat_history = bay.chat_history[-20:]

    if billing_out:
        await manager.broadcast({"type": "billing_update", "bay": bay_id, "billing": billing_out})

    return {
        "reply": reply,
        "response_type": response_type,
        "billing": billing_out,
        "parts_results": parts_out,
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
