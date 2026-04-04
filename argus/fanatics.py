"""
Fanatics Collect price scraper.
Returns guide price + recent sales for a given card + grade.
Rate: sleep 2-3s between calls.
"""

import asyncio
import logging
import re
import statistics
from typing import Optional

from playwright.async_api import async_playwright

logger = logging.getLogger(__name__)

BASE_URL = "https://www.fanaticscollect.com"
MIN_SALES_HIGH = 5
MIN_SALES_MEDIUM = 3


async def get_fanatics_price(name: str, grade: str) -> dict:
    """
    Returns:
        {"price": float, "sales_count": int, "confidence": "high"|"medium"|"low"}
    """
    await asyncio.sleep(2.5)  # rate limiting

    try:
        result = await _fetch_price(name, grade)
    except Exception as exc:
        logger.warning("Fanatics fetch failed for '%s' grade %s: %s", name, grade, exc)
        return {"price": 0.0, "sales_count": 0, "confidence": "low"}

    return result


async def _fetch_price(name: str, grade: str) -> dict:
    query = name.replace(" ", "+")
    url = f"{BASE_URL}/search?q={query}&grade={grade}"

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(url, wait_until="networkidle", timeout=30_000)

        try:
            await page.wait_for_selector(".product-card, .search-result", timeout=10_000)
        except Exception:
            await browser.close()
            return {"price": 0.0, "sales_count": 0, "confidence": "low"}

        # Try guide price first
        guide_el = await page.query_selector(".guide-price, [data-guide-price]")
        guide_price: Optional[float] = None
        if guide_el:
            guide_price = _parse_usd((await guide_el.inner_text()).strip())

        # Collect recent sale prices
        sale_els = await page.query_selector_all(".recent-sale, .sale-price, .last-sold")
        sales: list[float] = []
        for el in sale_els[:10]:
            price = _parse_usd((await el.inner_text()).strip())
            if price:
                sales.append(price)

        await browser.close()

    if not sales and guide_price is None:
        return {"price": 0.0, "sales_count": 0, "confidence": "low"}

    if sales:
        price = statistics.median(sales)
        count = len(sales)
    else:
        price = guide_price
        count = 1

    confidence = (
        "high" if count >= MIN_SALES_HIGH
        else "medium" if count >= MIN_SALES_MEDIUM
        else "low"
    )
    return {"price": round(price, 2), "sales_count": count, "confidence": confidence}


def _parse_usd(text: str) -> Optional[float]:
    match = re.search(r"[\d,]+\.?\d*", text.replace(",", ""))
    if not match:
        return None
    try:
        return float(match.group())
    except ValueError:
        return None
