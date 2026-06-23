import json
import os
from groq import AsyncGroq
from schemas import ChatMessage, BayStatus

SYSTEM_PROMPT = """You are BayOps AI, a service advisor at an automotive repair shop. You have a conversation with a mechanic about what they need.

Your job:
1. Gather: vehicle (year/make/model), bay number, and which parts or labor are needed
2. If any critical info is missing (especially vehicle), ask for it — keep it short
3. When you have enough info to search for parts, do it
4. After finding parts or adding labor, report the result and ask if anything else is needed
5. When user confirms adding to cart, proceed with checkout

Rules:
- Keep responses SHORT — 1-2 sentences max. This is voice-driven.
- Bay number can default to the current bay if not specified
- Technician name defaults to "Unknown" — don't ask for it
- If user says "yes", "go ahead", "do it" — that's confirmation to proceed
- For labor: extract hours. Default to 1 hour if not specified.
- Always be helpful and conversational, like a real service advisor

You MUST respond with ONLY valid JSON:
{
  "response_type": "question" | "action" | "message",
  "reply": "Your short response to the mechanic",
  "action_data": null | {
    "bay_number": "string",
    "technician_name": "string",
    "vehicle": {"year": "string", "make": "string", "model": "string", "vin": null},
    "items": [{"item_type": "PART|LABOR", "description": "string", "quantity": 1.0, "vendor": null, "hours": null}],
    "action": "SOURCE_PARTS | ADD_LABOR | CHECKOUT | REMOVE_ITEM"
  }
}

response_type meanings:
- "question": You need more info from the mechanic. action_data must be null.
- "action": You have enough info to act. action_data must contain the intent.
- "message": Informational reply (e.g., reporting totals, acknowledging). action_data must be null.

action meanings:
- "SOURCE_PARTS": Search for parts (first time mentioning parts)
- "ADD_LABOR": Add labor hours only
- "CHECKOUT": User confirmed, add parts to cart and go to checkout
- "REMOVE_ITEM": Remove an item from the estimate. Put the item description in items[0].description."""


def build_bay_context(bay: BayStatus) -> str:
    parts = []
    parts.append(f"Bay: {bay.bay_number}")
    if bay.vehicle and bay.vehicle.year != "N/A":
        parts.append(f"Vehicle: {bay.vehicle.year} {bay.vehicle.make} {bay.vehicle.model}")
    else:
        parts.append("Vehicle: Not set yet")
    if bay.technician_name and bay.technician_name != "Unknown":
        parts.append(f"Technician: {bay.technician_name}")

    if bay.all_items:
        items_str = ", ".join(
            f"{it.description} ({'$' + str(round(it.quantity * 150, 2)) if it.item_type == 'LABOR' else it.description})"
            for it in bay.all_items
        )
        parts.append(f"Items on estimate: {items_str}")

    if bay.billing and bay.billing.total > 0:
        parts.append(f"Current total: ${bay.billing.total:.2f}")

    if bay.results and bay.results.get("results"):
        for r in bay.results["results"]:
            parts.append(f"Found: {r.get('product_name', '')} at {r.get('price', 'N/A')} from {r.get('vendor', '')}")

    return "Current bay state:\n" + "\n".join(f"- {p}" for p in parts)


async def process_chat_message(
    bay: BayStatus,
    user_message: str,
) -> dict:
    client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))

    bay_context = build_bay_context(bay)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": bay_context},
    ]

    for msg in bay.chat_history[-10:]:
        messages.append({"role": msg.role, "content": msg.content})

    messages.append({"role": "user", "content": user_message})

    response = await client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        temperature=0.3,
        response_format={"type": "json_object"},
    )

    parsed = json.loads(response.choices[0].message.content)

    if "response_type" not in parsed:
        parsed["response_type"] = "message"
    if "reply" not in parsed:
        parsed["reply"] = "I didn't quite get that. Could you repeat?"
    if "action_data" not in parsed:
        parsed["action_data"] = None

    return parsed
