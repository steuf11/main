"""
Argus pricing — fetches PSA and Fanatics market values for graded Pokemon cards.
Caches results in SQLite to avoid redundant API calls.
"""

import re
import requests
from datetime import datetime, timezone, timedelta
from database import get_db
from config import MIN_ARGUS_USD

# Cache TTL: re-fetch after 24 hours
CACHE_TTL_HOURS = 24

PSA_SEARCH_URL = "https://www.psacard.com/auctionprices"
FANATICS_SEARCH_URL = "https://www.fanatics.com/trading-cards/search"


def normalize_card_key(card_name: str, grader: str, grade: str) -> str:
    """Create a cache key from card attributes."""
    cleaned = re.sub(r"[^a-zA-Z0-9 ]", "", card_name).strip().lower()
    return f"{cleaned}|{grader.upper()}|{grade}"


def fetch_psa_price(card_name: str, grader: str, grade: str) -> float | None:
    """Attempt to fetch PSA auction average for a card. Returns USD or None."""
    try:
        # PSA doesn't have a clean public API — use search page scraping
        query = f"{card_name} {grader} {grade}".strip()
        r = requests.get(
            PSA_SEARCH_URL,
            params={"q": query},
            timeout=10,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        if r.status_code != 200:
            return None
        # Try to find average sale price in response
        # This is a best-effort parse; PSA changes their HTML regularly
        match = re.search(r'avg["\s:]*\$?([\d,]+\.?\d*)', r.text, re.IGNORECASE)
        if match:
            return float(match.group(1).replace(",", ""))
        return None
    except Exception as e:
        print(f"[Argus] PSA fetch error: {e}")
        return None


def fetch_fanatics_price(card_name: str, grader: str, grade: str) -> float | None:
    """Attempt to fetch Fanatics listed price for a card. Returns USD or None."""
    try:
        query = f"{card_name} {grader} {grade}".strip()
        r = requests.get(
            FANATICS_SEARCH_URL,
            params={"query": query},
            timeout=10,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        if r.status_code != 200:
            return None
        match = re.search(r'price["\s:]*\$?([\d,]+\.?\d*)', r.text, re.IGNORECASE)
        if match:
            return float(match.group(1).replace(",", ""))
        return None
    except Exception as e:
        print(f"[Argus] Fanatics fetch error: {e}")
        return None


def get_argus_price(card_name: str, grader: str, grade: str) -> dict | None:
    """
    Get the argus (reference) price for a card.
    Checks cache first, then fetches from PSA + Fanatics.
    Returns dict with psa_usd, fanatics_usd, avg_usd, confidence or None.
    """
    card_key = normalize_card_key(card_name, grader, grade)

    # Check cache
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM argus_cache WHERE card_key = ?", (card_key,)
        ).fetchone()

    if row:
        fetched = datetime.fromisoformat(row["fetched_at"])
        if datetime.now(timezone.utc) - fetched < timedelta(hours=CACHE_TTL_HOURS):
            return {
                "psa_usd": row["psa_usd"],
                "fanatics_usd": row["fanatics_usd"],
                "avg_usd": row["avg_usd"],
                "confidence": row["confidence"],
            }

    # Fetch fresh
    psa = fetch_psa_price(card_name, grader, grade)
    fanatics = fetch_fanatics_price(card_name, grader, grade)

    # Calculate average
    prices = [p for p in [psa, fanatics] if p and p > 0]
    if not prices:
        return None

    avg = sum(prices) / len(prices)
    if avg < MIN_ARGUS_USD:
        return None

    # Confidence scoring
    if len(prices) == 2:
        diff_pct = abs(prices[0] - prices[1]) / max(prices) * 100
        confidence = "HAUTE" if diff_pct <= 10 else "MOYENNE"
    else:
        confidence = "MOYENNE" if prices else "FAIBLE"

    # Cache it
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        db.execute(
            """INSERT OR REPLACE INTO argus_cache
               (card_key, psa_usd, fanatics_usd, avg_usd, confidence, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (card_key, psa, fanatics, round(avg, 2), confidence, now),
        )

    return {
        "psa_usd": psa,
        "fanatics_usd": fanatics,
        "avg_usd": round(avg, 2),
        "confidence": confidence,
    }
