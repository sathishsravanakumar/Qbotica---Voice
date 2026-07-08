import re


def parse_price(price_str: str) -> float | None:
    """Extract a dollar amount from a string. Returns None if no price found."""
    if not price_str:
        return None
    match = re.search(r'\$?([\d,]+\.?\d*)', str(price_str).replace(',', ''))
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            return None
    return None


def parse_price_float(price_str: str) -> float:
    """Like parse_price but always returns a float (0.0 on failure)."""
    return parse_price(price_str) or 0.0
