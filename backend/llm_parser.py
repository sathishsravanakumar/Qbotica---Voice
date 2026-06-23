import json
import os
from groq import AsyncGroq
from schemas import MechanicIntent

SYSTEM_PROMPT = """You are a voice-command parser for an automotive repair shop.
Extract structured data from a mechanic's spoken transcript.

Rules:
- bay_number: The bay or stall number mentioned (e.g., "bay 3" -> "3"). Default to "1" if not mentioned.
- technician_name: The mechanic's name if mentioned, otherwise "Unknown"
- vehicle: Extract year, make, model. Set vin to null unless mentioned.
  If no vehicle is mentioned and this is just a labor/update command, use the previous vehicle context or set year/make/model to "N/A".
- items: Extract each part or labor item.
  For PARTS: set item_type to "PART". Set quantity (default 1). Set vendor if named, else null. Set hours to null.
  For LABOR: set item_type to "LABOR". Put the number of hours in "hours" (e.g., "1.5 hours of labor" -> hours: 1.5). Default hours to 1.0 if not specified. Set description to the labor type (e.g., "Brake job labor"). Set vendor to null.
- action: Usually "SOURCE_PARTS". Use "ADD_LABOR" if only labor is mentioned. Use "UPDATE_ESTIMATE" for estimate/quote requests.

You MUST respond with ONLY valid JSON matching this exact schema:
{
  "bay_number": "string",
  "technician_name": "string",
  "vehicle": {"year": "string", "make": "string", "model": "string", "vin": null},
  "items": [
    {"item_type": "PART", "description": "string", "quantity": 1.0, "vendor": "string or null", "hours": null},
    {"item_type": "LABOR", "description": "Brake job labor", "quantity": 1.0, "vendor": null, "hours": 1.5}
  ],
  "action": "SOURCE_PARTS"
}"""


async def parse_voice_transcript(transcript: str) -> MechanicIntent:
    client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))

    response = await client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f'Mechanic transcript: "{transcript}"'},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )

    parsed = json.loads(response.choices[0].message.content)
    return MechanicIntent(**parsed)
