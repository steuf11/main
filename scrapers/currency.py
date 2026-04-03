"""
Price normalization — always returns a USD value for uniform comparison.
"""


def normalize_price(raw_price: float, currency: str, sol_usd_price: float) -> dict:
    """
    Normalize a listing price to USD.

    Returns a dict with:
      listing_price_usd     — float, always in USD
      listing_price_display — human-readable string
      currency              — "USDC" | "SOL"
      sol_amount            — (SOL only) original SOL amount
      sol_price_used        — (SOL only) SOL/USD rate used
    """
    if currency == "USDC":
        return {
            "listing_price_usd": raw_price,
            "listing_price_display": f"${raw_price:.2f} USDC",
            "currency": "USDC",
        }
    elif currency == "SOL":
        usd_value = round(raw_price * sol_usd_price, 2)
        return {
            "listing_price_usd": usd_value,
            "listing_price_display": (
                f"{raw_price:.4g} SOL (≈${usd_value:.2f} @ ${sol_usd_price:.2f}/SOL)"
            ),
            "currency": "SOL",
            "sol_amount": raw_price,
            "sol_price_used": sol_usd_price,
        }
    else:
        raise ValueError(f"Unknown currency: {currency}")
