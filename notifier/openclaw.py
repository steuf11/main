"""
OpenClaw webhook integration.
Sends one POST per opportunity with structured JSON payload.
"""

import logging
from datetime import datetime, timezone

import httpx

import config

logger = logging.getLogger(__name__)


async def send_opportunity(opp: dict) -> bool:
    """POST a single opportunity to OpenClaw. Returns True on success."""
    payload = {
        "event": "arbitrage_opportunity",
        "card_name": opp.get("name", ""),
        "platform": opp.get("platform", ""),
        "listing_price_usd": opp.get("listing_price_usd", 0.0),
        "argus_usd": opp.get("argus_avg_usd", 0.0),
        "discount_pct": opp.get("discount_pct", 0.0),
        "listing_url": opp.get("url", ""),
        "seller": opp.get("seller", ""),
        "grade": opp.get("grade", ""),
        "grader": opp.get("grader", ""),
        "confidence": opp.get("argus_confidence", ""),
        "scanned_at": datetime.now(timezone.utc).isoformat(),
    }

    headers = {
        "Authorization": f"Bearer {config.OPENCLAW_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                config.OPENCLAW_WEBHOOK_URL,
                json=payload,
                headers=headers,
                timeout=10,
            )
            resp.raise_for_status()
            logger.debug("OpenClaw webhook sent for '%s'", payload["card_name"])
            return True
        except Exception as exc:
            logger.error("OpenClaw webhook failed for '%s': %s", payload["card_name"], exc)
            return False
