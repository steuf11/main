"""
Pokémon Arbitrage Scanner — main orchestrator.

Run once:   python main.py
Run on schedule: python main.py --loop
"""

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone

import httpx
import schedule
import time

import config
from argus import cache as argus_cache
from argus.engine import enrich_listing
from notifier import telegram, openclaw
from scrapers.collectorcrypt import scrape_collectorcrypt
from scrapers.phygitals import scrape_phygitals

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger("main")


# ---------------------------------------------------------------------------
# SOL price
# ---------------------------------------------------------------------------

async def get_sol_price() -> float:
    """
    Fetch current SOL/USD price from CoinGecko (1 call per run).
    Falls back to cached value (max 30 min) if the API is unreachable.
    Skips the run if no price is available.
    """
    try:
        params = {"ids": "solana", "vs_currencies": "usd"}
        headers = {}
        if config.COINGECKO_API_KEY:
            headers["x-cg-demo-api-key"] = config.COINGECKO_API_KEY

        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params=params,
                headers=headers,
                timeout=10,
            )
            r.raise_for_status()
            price: float = r.json()["solana"]["usd"]

        argus_cache.set_cached_sol_price(price)
        logger.info("SOL price: $%.2f", price)
        return price

    except Exception as exc:
        logger.warning("CoinGecko unreachable: %s — trying cache", exc)
        cached = argus_cache.get_cached_sol_price()
        if cached is not None:
            logger.info("Using cached SOL price: $%.2f", cached)
            return cached
        logger.error("No SOL price available — skipping run")
        raise RuntimeError("SOL price unavailable") from exc


# ---------------------------------------------------------------------------
# Filtering & scoring
# ---------------------------------------------------------------------------

def _score(opp: dict) -> float:
    score = opp.get("discount_pct", 0.0)

    seller = opp.get("seller", "")
    # seller_listing_count is populated in run() via seller frequency map
    if opp.get("seller_listing_count", 0) >= config.SELLER_MULTI_THRESHOLD:
        score += 10

    grade = str(opp.get("grade", ""))
    if grade in ("10",):
        score += 10

    name_lower = opp.get("name", "").lower()
    if any(card in name_lower for card in config.HIGH_DEMAND_CARDS):
        score += 10

    return score


def _should_alert(opp: dict) -> bool:
    discount_pct = opp.get("discount_pct", 0.0)
    argus_avg = opp.get("argus_avg_usd", 0.0)
    confidence = opp.get("argus_confidence", "low")

    if argus_avg < config.MIN_ARGUS_USD:
        return False

    if discount_pct < config.MIN_DISCOUNT_PCT:
        return False

    if confidence == "low" and discount_pct < 40:
        return False

    listing_key = f"{opp['platform']}:{opp.get('listing_id', opp.get('url', ''))}"
    if argus_cache.was_alerted(listing_key):
        return False

    return True


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------

def _deduplicate(listings: list[dict]) -> list[dict]:
    """
    When the same card appears on both platforms, keep the cheaper one.
    Deduplicate by card_key (name + grader + grade).
    """
    seen: dict[str, dict] = {}
    for listing in listings:
        key = listing.get("card_key", listing.get("name", ""))
        if key not in seen:
            seen[key] = listing
        else:
            existing_price = seen[key].get("listing_price_usd", float("inf"))
            if listing.get("listing_price_usd", float("inf")) < existing_price:
                seen[key] = listing
    return list(seen.values())


# ---------------------------------------------------------------------------
# Main run
# ---------------------------------------------------------------------------

async def run() -> None:
    logger.info("=== Scan started at %s ===", datetime.now(timezone.utc).isoformat())
    argus_cache.init_db()

    # 1. SOL price — one call per run
    try:
        sol_price = await get_sol_price()
    except RuntimeError:
        return

    # 2. Scrape both platforms in parallel
    cc_task = asyncio.create_task(scrape_collectorcrypt(sol_usd_price=sol_price))
    phy_task = asyncio.create_task(scrape_phygitals())
    cc_listings, phy_listings = await asyncio.gather(cc_task, phy_task)

    all_listings = cc_listings + phy_listings
    logger.info("Total listings fetched: %d", len(all_listings))

    # 3. Enrich with argus (cache first)
    enriched: list[dict] = []
    for listing in all_listings:
        try:
            enriched.append(await enrich_listing(listing))
        except Exception as exc:
            logger.warning("Argus enrichment failed for '%s': %s", listing.get("name"), exc)

    # 4. Annotate seller listing count (multi-listing bonus)
    seller_counts: dict[str, int] = {}
    for item in enriched:
        seller = item.get("seller", "")
        seller_counts[seller] = seller_counts.get(seller, 0) + 1
    for item in enriched:
        item["seller_listing_count"] = seller_counts.get(item.get("seller", ""), 0)

    # 5. Deduplicate cross-platform
    enriched = _deduplicate(enriched)

    # 6. Filter
    opportunities = [o for o in enriched if _should_alert(o)]

    # 7. Score + sort
    opportunities.sort(key=_score, reverse=True)
    opportunities = opportunities[: config.MAX_ALERTS_PER_RUN]

    logger.info("Opportunities after filtering: %d", len(opportunities))

    # 8. Telegram (grouped)
    alerts_sent = 0
    if opportunities:
        alerts_sent = await telegram.send_opportunities(
            opportunities,
            scan_platforms=["CollectorCrypt", "Phygitals"],
        )

    # 9. OpenClaw webhooks (one per opportunity)
    for opp in opportunities:
        await openclaw.send_opportunity(opp)

    # 10. Mark alerted + log run
    for opp in opportunities:
        listing_key = f"{opp['platform']}:{opp.get('listing_id', opp.get('url', ''))}"
        argus_cache.mark_alerted(listing_key)

    argus_cache.log_run(
        opportunities_found=len(opportunities),
        alerts_sent=alerts_sent,
    )

    logger.info("=== Scan complete — %d opportunities, %d alerts ===", len(opportunities), alerts_sent)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Pokémon Arbitrage Scanner")
    parser.add_argument("--loop", action="store_true", help="Run on schedule (SCAN_INTERVAL_HOURS)")
    args = parser.parse_args()

    if args.loop:
        logger.info("Scheduling scan every %d hour(s)", config.SCAN_INTERVAL_HOURS)
        asyncio.run(run())  # run immediately on start
        schedule.every(config.SCAN_INTERVAL_HOURS).hours.do(lambda: asyncio.run(run()))
        while True:
            schedule.run_pending()
            time.sleep(30)
    else:
        asyncio.run(run())


if __name__ == "__main__":
    main()
