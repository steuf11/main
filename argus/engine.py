"""
Argus engine — enriches listings with market price data.

For each listing:
  1. Build card_key
  2. Check SQLite cache (TTL 6h)
  3. On cache miss: call PSA + Fanatics scrapers
  4. Compute avg_usd and discount_pct
  5. Return enriched listing
"""

import logging
from typing import Optional

import config
from argus import cache as argus_cache
from argus.psa import get_psa_price
from argus.fanatics import get_fanatics_price

logger = logging.getLogger(__name__)


async def enrich_listing(listing: dict) -> dict:
    """Add argus data and discount_pct to a listing dict. Returns enriched copy."""
    name = listing.get("name", "")
    grader = listing.get("grader", "PSA")
    grade = listing.get("grade", "")
    listing_price_usd: float = listing.get("listing_price_usd", 0.0)

    card_key = argus_cache.make_card_key(name, grader, grade)

    # Cache lookup
    cached = argus_cache.get_argus(card_key)
    if cached:
        logger.debug("Cache hit for %s", card_key)
        argus_data = cached
    else:
        argus_data = await _fetch_argus(name, grade, card_key)

    avg_usd: float = argus_data.get("avg_usd") or 0.0
    if avg_usd > 0 and listing_price_usd > 0:
        discount_pct = (avg_usd - listing_price_usd) / avg_usd * 100
    else:
        discount_pct = 0.0

    return {
        **listing,
        "card_key": card_key,
        "argus_avg_usd": avg_usd,
        "argus_psa_usd": argus_data.get("psa_usd"),
        "argus_fanatics_usd": argus_data.get("fanatics_usd"),
        "argus_confidence": argus_data.get("confidence", "low"),
        "discount_pct": round(discount_pct, 1),
    }


async def _fetch_argus(name: str, grade: str, card_key: str) -> dict:
    logger.info("Fetching argus for %s (grade %s)", name, grade)

    psa_result, fanatics_result = await _fetch_both(name, grade)

    psa_usd: Optional[float] = psa_result["price"] if psa_result["price"] > 0 else None
    fanatics_usd: Optional[float] = (
        fanatics_result["price"] if fanatics_result["price"] > 0 else None
    )

    # Compute average and confidence
    available = [p for p in (psa_usd, fanatics_usd) if p is not None]
    if not available:
        avg_usd = 0.0
        confidence = "low"
    elif len(available) == 2:
        avg_usd = sum(available) / 2

        # Check uncertainty: if spread > MAX_ARGUS_UNCERTAINTY%, mark as low confidence
        spread_pct = abs(psa_usd - fanatics_usd) / avg_usd * 100
        if spread_pct > config.MAX_ARGUS_UNCERTAINTY:
            confidence = "low"
        else:
            confidences = [psa_result["confidence"], fanatics_result["confidence"]]
            confidence = _merge_confidence(confidences)
    else:
        avg_usd = available[0]
        confidence = "medium"  # Only one source

    argus_cache.set_argus(card_key, psa_usd, fanatics_usd, round(avg_usd, 2), confidence)
    return {
        "psa_usd": psa_usd,
        "fanatics_usd": fanatics_usd,
        "avg_usd": round(avg_usd, 2),
        "confidence": confidence,
    }


async def _fetch_both(name: str, grade: str) -> tuple[dict, dict]:
    import asyncio
    psa_task = asyncio.create_task(get_psa_price(name, grade))
    fanatics_task = asyncio.create_task(get_fanatics_price(name, grade))
    return await asyncio.gather(psa_task, fanatics_task)


def _merge_confidence(confidences: list[str]) -> str:
    ranks = {"high": 2, "medium": 1, "low": 0}
    scores = [ranks.get(c, 0) for c in confidences]
    avg = sum(scores) / len(scores)
    if avg >= 1.5:
        return "high"
    if avg >= 0.75:
        return "medium"
    return "low"
