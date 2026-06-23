import json
import os
from ddgs import DDGS
from groq import AsyncGroq
from schemas import MechanicIntent

EXTRACT_PROMPT = """You are an automotive parts price extractor. I give you AutoZone search results for a car part. Extract the best product match.

RULES:
- ONLY pick results from autozone.com
- Look for any dollar amount: "$29.99", "starting at $20", "from $15"
- product_name must include brand (e.g. "Duralast Gold Brake Pads")
- source_url MUST be an exact autozone.com URL from the results
- If no price found, write "See AutoZone"

Return ONLY valid JSON:
{
  "product_name": "Brand + product name",
  "part_number": "Part number or N/A",
  "price": "$XX.XX",
  "vendor": "AutoZone",
  "in_stock": true,
  "fitment": "Exact Fit",
  "source_url": "exact autozone.com URL",
  "snippet": "One line about the product"
}"""


def search_part(year: str, make: str, model: str, description: str) -> list[dict]:
    queries = [
        f"site:autozone.com {year} {make} {model} {description}",
        f"autozone.com {year} {make} {model} {description} price",
    ]

    all_results = []
    with DDGS() as ddgs:
        for q in queries:
            try:
                all_results += ddgs.text(q, max_results=5)
            except Exception:
                pass

    return [r for r in all_results if "autozone.com" in r.get("href", "")]


async def extract_part_info(search_results: list[dict], year: str, make: str, model: str, description: str) -> dict:
    if not search_results:
        return {
            "product_name": description,
            "part_number": "N/A",
            "price": "See AutoZone",
            "vendor": "AutoZone",
            "in_stock": True,
            "fitment": "Exact Fit",
            "source_url": f"https://www.autozone.com/searchresult?searchText={year}+{make}+{model}+{description.replace(' ', '+')}",
            "snippet": "Search AutoZone directly",
        }

    formatted = "\n\n".join(
        f"Title: {r.get('title', '')}\nURL: {r.get('href', '')}\nSnippet: {r.get('body', '')}"
        for r in search_results
    )

    client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
    response = await client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": EXTRACT_PROMPT},
            {"role": "user", "content": f"Vehicle: {year} {make} {model}\nPart: {description}\n\nSearch results:\n{formatted}"},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )

    return json.loads(response.choices[0].message.content)


async def lookup_parts(intent: MechanicIntent) -> dict:
    part_items = [item for item in intent.items if item.item_type == "PART"]

    if not part_items:
        return {"results": [], "summary": "No parts to search — only labor items."}

    vehicle = intent.vehicle
    results = []

    for item in part_items:
        search_results = search_part(vehicle.year, vehicle.make, vehicle.model, item.description)
        extracted = await extract_part_info(search_results, vehicle.year, vehicle.make, vehicle.model, item.description)
        extracted["description"] = item.description
        results.append(extracted)

    return {
        "results": results,
        "summary": f"Found {len(results)} part(s) for {vehicle.year} {vehicle.make} {vehicle.model} on AutoZone.",
    }
