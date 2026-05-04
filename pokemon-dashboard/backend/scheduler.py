"""
Scan scheduler — runs the scraper + scorer on a configurable interval.
"""

import asyncio
from datetime import datetime, timezone
from database import get_db
from scraper import scrape_phygitals, save_listings
from scorer import score_listings
from notifier import alert_opportunity, alert_scan_summary
from config import SCAN_INTERVAL_HOURS

# Shared state for the API to read
current_scan = {"running": False, "last_run": None, "next_run": None}


async def run_scan() -> dict:
    """Execute a full scan cycle: scrape → score → notify."""
    if current_scan["running"]:
        return {"status": "already_running"}

    current_scan["running"] = True
    started_at = datetime.now(timezone.utc).isoformat()

    # Create scan run record
    with get_db() as db:
        cursor = db.execute(
            "INSERT INTO scan_runs (started_at, status) VALUES (?, 'running')",
            (started_at,),
        )
        run_id = cursor.lastrowid

    try:
        # Step 1: Scrape
        listings = await scrape_phygitals(max_pages=10)
        saved = save_listings(listings)
        print(f"[Scheduler] Scraped {len(listings)} listings, saved {saved} new.")

        # Step 2: Score
        opps = score_listings()
        print(f"[Scheduler] Found {len(opps)} opportunities.")

        # Step 3: Notify
        for opp in opps:
            alert_opportunity(opp)

        alert_scan_summary(len(listings), len(opps))

        # Update scan record
        finished_at = datetime.now(timezone.utc).isoformat()
        with get_db() as db:
            db.execute(
                """UPDATE scan_runs SET finished_at = ?, listings_scraped = ?,
                   opportunities_found = ?, status = 'completed'
                   WHERE id = ?""",
                (finished_at, len(listings), len(opps), run_id),
            )

        current_scan["last_run"] = finished_at
        return {
            "status": "completed",
            "listings": len(listings),
            "opportunities": len(opps),
        }

    except Exception as e:
        error_msg = str(e)
        print(f"[Scheduler] Scan failed: {error_msg}")
        with get_db() as db:
            db.execute(
                "UPDATE scan_runs SET status = 'failed', error_msg = ? WHERE id = ?",
                (error_msg, run_id),
            )
        return {"status": "failed", "error": error_msg}

    finally:
        current_scan["running"] = False


async def scheduler_loop():
    """Run scans on a fixed interval forever."""
    interval_seconds = SCAN_INTERVAL_HOURS * 3600
    while True:
        current_scan["next_run"] = datetime.now(timezone.utc).isoformat()
        await run_scan()
        await asyncio.sleep(interval_seconds)
