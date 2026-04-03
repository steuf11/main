"""
PSA Auction Prices scraper.
Fetches recent auction sales for a given card + grade.
Rate: sleep 2-3s between calls to avoid IP ban.
"""

import asyncio
import logging
import re
import statistics
from datetime import datetime, timedelta
from typing import Optional

import httpx
from playwright.async_api import async_playwright

logger = logging.getLogger(__name__)

BASE_URL = "https://www.psacard.com/auctionprices/"
RECENT_DAYS = 90
MIN_SALES_HIGH = 5
MIN_SALES_MEDIUM = 3


async def get_psa_price(name: str, grade: str) -> dict:
    """
    Returns:
        {"price": float, "sales_count": int, "confidence": "high"|"medium"|"low"}
    """
    await asyncio.sleep(2.5)  # rate limiting

    try:
        sales = await _fetch_sales(name, grade)
    except Exception as exc:
        logger.warning("PSA fetch failed for '%s' grade %s: %s", name, grade, exc)
        return {"price": 0.0, "sales_count": 0, "confidence": "low"}

    if not sales:
        return {"price": 0.0, "sales_count": 0, "confidence": "low"}

    price = statistics.median(sales)
    count = len(sales)
    confidence = (
        "high" if count >= MIN_SALES_HIGH
        else "medium" if count >= MIN_SALES_MEDIUM
        else "low"
    )
    return {"price": round(price, 2), "sales_count": count, "confidence": confidence}


async def _fetch_sales(name: str, grade: str) -> list[float]:
    """Scrape PSA auction prices page and return list of recent sale prices."""
    query = name.replace(" ", "+")
    url = f"{BASE_URL}?q={query}&grade={grade}"

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(url, wait_until="networkidle", timeout=30_000)

        try:
            await page.wait_for_selector("table.auction-prices-table, .result-row", timeout=10_000)
        except Exception:
            await browser.close()
            return []

        rows = await page.query_selector_all("table tbody tr, .result-row")
        sales: list[float] = []
        cutoff = datetime.utcnow() - timedelta(days=RECENT_DAYS)

        for row in rows[:20]:
            try:
                # Date column
                date_el = await row.query_selector("td:nth-child(1), .sale-date")
                date_text = (await date_el.inner_text()).strip() if date_el else ""
                sale_date = _parse_date(date_text)
                if sale_date and sale_date < cutoff:
                    continue

                # Price column
                price_el = await row.query_selector("td:nth-child(4), .sale-price")
                price_text = (await price_el.inner_text()).strip() if price_el else ""
                price = _parse_usd(price_text)
                if price:
                    sales.append(price)
            except Exception:
                continue

        await browser.close()

    return sales[:5]  # cap at 5 most recent


def _parse_date(text: str) -> Optional[datetime]:
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%b %d, %Y"):
        try:
            return datetime.strptime(text.strip(), fmt)
        except ValueError:
            continue
    return None


def _parse_usd(text: str) -> Optional[float]:
    match = re.search(r"[\d,]+\.?\d*", text.replace(",", ""))
    if not match:
        return None
    try:
        return float(match.group())
    except ValueError:
        return None
