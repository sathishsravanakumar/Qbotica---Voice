import asyncio
import json
import os
from ddgs import DDGS
from groq import AsyncGroq
from schemas import MechanicIntent

VENDORS = [
    {"name": "AutoZone",           "domain": "autozone.com"},
    {"name": "O'Reilly Auto Parts", "domain": "oreillyauto.com"},
    {"name": "Advance Auto Parts",  "domain": "advanceautoparts.com"},
]

EXTRACT_PROMPT = """You are an automotive parts price extractor. I give you web search results for a car part. Extract the BEST product match.

CRITICAL RULES:
- Look for ANY dollar amount in titles or snippets: "$29.99", "starting at $20", "from $15", "as low as $8.99"
- If you see a price range, use the starting price (e.g. "from $15" -> "$15.00")
- product_name must include the brand (e.g. "Duralast Gold Brake Pads")
- source_url MUST be an exact URL from the search results — never make one up
- If absolutely NO price exists in any snippet, write "See website"

Return ONLY valid JSON:
{
  "product_name": "Brand + product name",
  "part_number": "Part number if visible, else N/A",
  "price": "$XX.XX",
  "in_stock": true,
  "fitment": "Exact Fit",
  "source_url": "exact URL from results",
  "snippet": "One line about the product"
}"""


def search_vendor_results(year: str, make: str, model: str, description: str, domain: str) -> list[dict]:
    """Search DuckDuckGo for a part on a specific vendor site."""
    queries = [
        f"site:{domain} {year} {make} {model} {description}",
        f"{domain} {year} {make} {model} {description} price",
    ]
    all_results = []
    for q in queries:
        try:
            all_results += DDGS().text(q, max_results=4)
        except Exception:
            pass
    return [r for r in all_results if domain in r.get("href", "")]


async def extract_part_info(
    search_results: list[dict],
    year: str, make: str, model: str,
    description: str,
    vendor_name: str,
) -> dict:
    """Use Groq to extract price and product info from search results."""
    if not search_results:
        return {
            "product_name": description,
            "part_number": "N/A",
            "price": "See website",
            "in_stock": True,
            "fitment": "Exact Fit",
            "source_url": "",
            "snippet": f"Visit {vendor_name} directly",
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
            {"role": "user", "content": f"Vehicle: {year} {make} {model}\nPart: {description}\nVendor: {vendor_name}\n\nSearch results:\n{formatted}"},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


def parse_price_float(price_str: str) -> float:
    """Extract a float from a price string like '$29.99'."""
    import re
    m = re.search(r'\$?([\d,]+\.?\d*)', str(price_str).replace(',', ''))
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    return 0.0


async def search_all_vendors(
    year: str, make: str, model: str, description: str
) -> list[dict]:
    """Search all vendors concurrently and return options sorted by price."""

    async def search_one(vendor: dict) -> dict:
        raw = await asyncio.get_event_loop().run_in_executor(
            None,
            search_vendor_results,
            year, make, model, description, vendor["domain"],
        )
        info = await extract_part_info(raw, year, make, model, description, vendor["name"])
        info["vendor"] = vendor["name"]
        info["domain"] = vendor["domain"]
        return info

    results = await asyncio.gather(*[search_one(v) for v in VENDORS], return_exceptions=True)

    vendor_options = []
    for r in results:
        if isinstance(r, Exception):
            continue
        vendor_options.append(r)

    # Keep original vendor order as tie-breaker (AutoZone first by default)
    vendor_order = {v["name"]: i for i, v in enumerate(VENDORS)}
    vendor_options.sort(key=lambda x: (
        parse_price_float(x.get("price", "0")) == 0,   # priced items first
        parse_price_float(x.get("price", "0")),          # then by price ascending
        vendor_order.get(x.get("vendor", ""), 99),       # then AutoZone before others
    ))
    return vendor_options


async def lookup_parts(intent: MechanicIntent) -> dict:
    """Search all vendors for each part and return results with vendor comparison."""
    part_items = [item for item in intent.items if item.item_type == "PART"]

    if not part_items:
        return {"results": [], "summary": "No parts to search — only labor items."}

    vehicle = intent.vehicle
    results = []

    for item in part_items:
        vendor_options = await search_all_vendors(
            vehicle.year, vehicle.make, vehicle.model, item.description
        )

        if not vendor_options:
            continue

        # Best option is first (cheapest with a price, or first if none have prices)
        best = vendor_options[0]

        result = {
            "description": item.description,
            "product_name": best.get("product_name", item.description),
            "part_number": best.get("part_number", "N/A"),
            "price": best.get("price", "See website"),
            "vendor": best.get("vendor", "AutoZone"),
            "in_stock": best.get("in_stock", True),
            "fitment": best.get("fitment", "Exact Fit"),
            "source_url": best.get("source_url", ""),
            "snippet": best.get("snippet", ""),
            "vendor_options": vendor_options,
        }
        results.append(result)

    vendors_searched = ", ".join(v["name"] for v in VENDORS)
    return {
        "results": results,
        "summary": f"Found {len(results)} part(s) for {vehicle.year} {vehicle.make} {vehicle.model} — compared {vendors_searched}.",
    }
