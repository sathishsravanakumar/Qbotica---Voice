import asyncio
import re
import random
from typing import Callable, Awaitable
from playwright.async_api import async_playwright
from schemas import MechanicIntent

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


async def scrape_cart(page) -> dict:
    """Scrape product names, prices, and subtotal from the AutoZone cart page."""
    await asyncio.sleep(3)

    try:
        body_text = await page.inner_text("body")
    except Exception:
        return {"cart_items": [], "cart_total": 0}

    cart_items = []
    lines = [l.strip() for l in body_text.split("\n") if l.strip()]

    for i, line in enumerate(lines):
        if line.startswith("Part #") or line.startswith("Part#"):
            part_number = line.replace("Part #", "").replace("Part#", "").strip()
            name = ""
            for j in range(i - 1, max(0, i - 6), -1):
                candidate = lines[j]
                if len(candidate) > 8 and not candidate.startswith("$") and "Pickup" not in candidate and "Delivery" not in candidate and "delivery" not in candidate and "stock" not in candidate.lower():
                    name = candidate
                    break

            price = 0.0
            for j in range(max(0, i - 4), min(len(lines), i + 4)):
                m = re.search(r"\$(\d+\.?\d*)", lines[j])
                if m:
                    price = float(m.group(1))
                    break

            if name or part_number:
                cart_items.append({
                    "name": name,
                    "part_number": part_number,
                    "price": price,
                })

    cart_total = 0.0
    for line in lines:
        if "subtotal" in line.lower():
            m = re.search(r"\$(\d+[,\d]*\.?\d*)", line)
            if m:
                cart_total = float(m.group(1).replace(",", ""))
                break

    if not cart_total and cart_items:
        cart_total = sum(it["price"] for it in cart_items)

    return {"cart_items": cart_items, "cart_total": cart_total}


async def run_browser_checkout(
    intent: MechanicIntent,
    search_results: dict,
    log_callback: Callable[[str], Awaitable[None]],
) -> dict:
    vehicle = intent.vehicle
    v_str = f"{vehicle.year} {vehicle.make} {vehicle.model}"
    parts = search_results.get("results", [])
    if not parts:
        await log_callback("No parts to add to cart.")
        return {"status": "no_parts", "cart_items": [], "cart_total": 0}

    print(f"[BrowserAgent] Starting for {v_str}, {len(parts)} parts")
    await log_callback(f"Launching browser for {v_str}...")

    print("[BrowserAgent] Calling async_playwright().start()...")
    pw = await async_playwright().start()
    print("[BrowserAgent] Playwright started OK")
    browser = await pw.chromium.launch(
        headless=False,
        args=["--disable-blink-features=AutomationControlled", "--no-first-run"],
    )
    context = await browser.new_context(
        user_agent=UA,
        viewport={"width": 1366, "height": 768},
        locale="en-US",
    )
    await context.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = { runtime: {} };
    """)

    page = await context.new_page()
    added = []

    async def dismiss_cookies():
        try:
            btn = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept All"), button:has-text("Got it")')
            if await btn.count() > 0:
                await btn.first.click()
                await asyncio.sleep(1)
        except:
            pass

    for part in parts:
        desc = part.get("description", "unknown")
        url = part.get("source_url", "")

        if not url or "autozone.com" not in url:
            search_term = f"{vehicle.year} {vehicle.make} {vehicle.model} {desc}"
            url = f"https://www.autozone.com/searchresult?searchText={search_term.replace(' ', '+')}"

        await log_callback(f"Opening: {desc}")

        try:
            await page.goto(url, timeout=25000)
            try:
                await page.wait_for_load_state("networkidle", timeout=10000)
            except:
                pass
            await asyncio.sleep(3 + random.random())
            await dismiss_cookies()

            body = await page.text_content("body") or ""
            if "access" in body.lower() and "restricted" in body.lower():
                await log_callback("Blocked — trying search fallback...")
                search_term = f"{vehicle.year} {vehicle.make} {vehicle.model} {desc}"
                await page.goto(f"https://www.autozone.com/searchresult?searchText={search_term.replace(' ', '+')}", timeout=25000)
                await asyncio.sleep(4)
                await dismiss_cookies()

            add_btn = page.locator('button:has-text("Cart")').first
            try:
                await add_btn.wait_for(state="visible", timeout=8000)
                await asyncio.sleep(0.5 + random.random())
                await add_btn.click()
                await log_callback(f"Added to cart: {desc}")
                added.append(desc)
                await asyncio.sleep(2 + random.random())
                continue
            except:
                pass

            await log_callback(f"Clicking first product for {desc}...")
            product = page.locator('a[href*="/p/"]').first
            try:
                await product.wait_for(state="visible", timeout=6000)
                await asyncio.sleep(0.5 + random.random())
                await product.click()
                await asyncio.sleep(4 + random.random())
                await dismiss_cookies()

                add_btn2 = page.locator('button:has-text("Cart")').first
                await add_btn2.wait_for(state="visible", timeout=8000)
                await asyncio.sleep(0.5 + random.random())
                await add_btn2.click()
                await log_callback(f"Added to cart: {desc}")
                added.append(desc)
                await asyncio.sleep(2 + random.random())
            except Exception as e:
                await log_callback(f"Could not add {desc}: {str(e)[:60]}")

        except Exception as e:
            await log_callback(f"Error for {desc}: {str(e)[:60]}")

    # Go to cart and scrape real prices
    await log_callback("Opening cart page...")
    cart_data = {"cart_items": [], "cart_total": 0}
    try:
        await page.goto("https://www.autozone.com/cart", timeout=20000)
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except:
            pass

        cart_data = await scrape_cart(page)
        await log_callback(f"Cart: {len(cart_data['cart_items'])} item(s), total ${cart_data['cart_total']:.2f}")

        for it in cart_data["cart_items"]:
            await log_callback(f"  {it['name']} (#{it['part_number']}) — ${it['price']:.2f}")

        await log_callback(f"Browser stays open for you.")
    except Exception as e:
        await log_callback(f"Cart error: {str(e)[:60]}")

    return {
        "status": "checkout_ready",
        "items_added": added,
        "cart_items": cart_data["cart_items"],
        "cart_total": cart_data["cart_total"],
        "message": f"Added {len(added)} part(s) to AutoZone cart for {v_str}",
    }
