from schemas import LineItem, BillingLineItem, BayBilling, ShopConfig
from utils import parse_price


def calculate_billing(
    all_items: list[LineItem],
    all_results: list[dict],
    config: ShopConfig = ShopConfig(),
) -> BayBilling:
    price_map: dict[str, dict] = {}
    for r in all_results:
        desc = r.get("description", "").lower().strip()
        if not desc:
            continue
        price = parse_price(r.get("price", ""))
        if desc not in price_map or (price and price > 0):
            price_map[desc] = r

    parts_items = []
    labor_items = []

    for item in all_items:
        if item.item_type == "LABOR":
            hours = item.hours or item.quantity or 1.0
            extended = hours * config.labor_rate
            labor_items.append(BillingLineItem(
                item_type="LABOR",
                description=item.description,
                quantity=hours,
                unit_cost=config.labor_rate,
                markup_pct=0.0,
                extended_price=round(extended, 2),
                source="Shop Labor",
            ))
        else:
            result = price_map.get(item.description.lower().strip(), {})
            unit_cost = parse_price(result.get("price", "")) or 0.0
            markup = config.parts_markup_pct
            extended = item.quantity * unit_cost * (1 + markup)
            parts_items.append(BillingLineItem(
                item_type="PART",
                description=item.description,
                quantity=item.quantity,
                unit_cost=round(unit_cost, 2),
                markup_pct=markup,
                extended_price=round(extended, 2),
                source=result.get("vendor", item.vendor or ""),
                source_url=result.get("source_url"),
            ))

    parts_sub = round(sum(p.extended_price for p in parts_items), 2)
    labor_sub = round(sum(l.extended_price for l in labor_items), 2)
    subtotal = round(parts_sub + labor_sub, 2)
    tax = round(subtotal * config.tax_rate, 2)

    return BayBilling(
        parts_items=parts_items,
        labor_items=labor_items,
        parts_subtotal=parts_sub,
        labor_subtotal=labor_sub,
        subtotal=subtotal,
        tax_rate=config.tax_rate,
        tax_amount=tax,
        total=round(subtotal + tax, 2),
    )
