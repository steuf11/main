"""
Scoring engine — compares listing prices against argus reference to find arbitrage.
"""

from datetime import datetime, timezone
from database import get_db
from argus import get_argus_price
from config import MIN_DISCOUNT_PCT


def score_listings() -> list[dict]:
    """
    Score all un-scored listings against argus prices.
    Returns list of new opportunities found.
    """
    opportunities = []

    with get_db() as db:
        # Get listings not yet scored (no matching opportunity)
        rows = db.execute("""
            SELECT l.* FROM listings l
            LEFT JOIN opportunities o ON o.listing_id = l.id
            WHERE o.id IS NULL
            ORDER BY l.scraped_at DESC
            LIMIT 200
        """).fetchall()

    for row in rows:
        card_name = row["card_name"]
        grader = row["grader"] or ""
        grade = row["grade"] or ""
        listing_usd = row["price_usd"]

        if listing_usd <= 0:
            continue

        argus = get_argus_price(card_name, grader, grade)
        if not argus or not argus["avg_usd"] or argus["avg_usd"] <= 0:
            continue

        discount_pct = (argus["avg_usd"] - listing_usd) / argus["avg_usd"] * 100

        if discount_pct < MIN_DISCOUNT_PCT:
            continue

        opp = {
            "listing_id": row["id"],
            "card_name": card_name,
            "listing_usd": listing_usd,
            "argus_usd": argus["avg_usd"],
            "discount_pct": round(discount_pct, 1),
            "confidence": argus["confidence"],
            "seller": row["seller"],
            "url": row["url"],
            "platform": row["platform"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        # Insert into DB
        with get_db() as db:
            db.execute(
                """INSERT INTO opportunities
                   (listing_id, card_name, listing_usd, argus_usd, discount_pct,
                    confidence, seller, url, platform, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (opp["listing_id"], opp["card_name"], opp["listing_usd"],
                 opp["argus_usd"], opp["discount_pct"], opp["confidence"],
                 opp["seller"], opp["url"], opp["platform"], opp["created_at"]),
            )

        opportunities.append(opp)

    return opportunities
