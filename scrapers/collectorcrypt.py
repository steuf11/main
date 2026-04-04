"""
CollectorCrypt marketplace scraper.

Currency detection is per-card: each listing can be USDC or SOL independently.
Detection priority:
  1. data-currency attribute on the currency icon element
  2. CSS class name containing 'usdc' or 'sol'
  3. Computed color (blue = USDC, white/grey = SOL) — last resort
"""

import logging
import re
from typing import Optional

from playwright.async_api import async_playwright, Page, ElementHandle

import config
from scrapers.currency import normalize_price

logger = logging.getLogger(__name__)

MARKETPLACE_URL = (
    "https://collectorcrypt.com/marketplace/cards"
    "?category=Pokemon&sort=Recently+Listed"
)


async def scrape_collectorcrypt(sol_usd_price: float) -> list[dict]:
    """Return normalized listings from CollectorCrypt."""
    listings: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()

        for page_num in range(1, config.MAX_PAGES + 1):
            url = f"{MARKETPLACE_URL}&page={page_num}"
            logger.info("CollectorCrypt — fetching page %d", page_num)

            await page.goto(url, wait_until="networkidle", timeout=30_000)

            # Wait for card grid to render
            try:
                await page.wait_for_selector("[data-testid='card'], .card-item, .listing-card", timeout=10_000)
            except Exception:
                logger.warning("CollectorCrypt — no cards found on page %d, stopping", page_num)
                break

            cards = await page.query_selector_all(
                "[data-testid='card'], .card-item, .listing-card"
            )
            if not cards:
                break

            page_listings = await _extract_cards(cards, sol_usd_price)
            listings.extend(page_listings)

            # Stop if last page returned fewer cards than expected
            if len(cards) < 20:
                break

        await browser.close()

    logger.info("CollectorCrypt — %d listings scraped", len(listings))
    return listings


async def _extract_cards(cards: list[ElementHandle], sol_usd_price: float) -> list[dict]:
    results = []
    for card in cards:
        try:
            listing = await _extract_one_card(card, sol_usd_price)
            if listing:
                results.append(listing)
        except Exception as exc:
            logger.warning("CollectorCrypt — card extraction failed: %s", exc)
    return results


async def _extract_one_card(card: ElementHandle, sol_usd_price: float) -> Optional[dict]:
    # --- Currency detection (per-card) ---
    currency = await _detect_currency(card)
    if currency is None:
        logger.warning("CollectorCrypt — could not detect currency, skipping card")
        return None

    # --- Price ---
    price_el = await card.query_selector(".price, [data-price], .listing-price")
    if not price_el:
        return None
    raw_price_text = (await price_el.inner_text()).strip()
    raw_price = _parse_price(raw_price_text)
    if raw_price is None:
        return None

    # --- Card name ---
    name_el = await card.query_selector(".card-name, .title, h3, h2")
    name = (await name_el.inner_text()).strip() if name_el else "Unknown"

    # --- Grader + grade ---
    grade_el = await card.query_selector(".grade, [data-grade]")
    grade_text = (await grade_el.inner_text()).strip() if grade_el else ""
    grader, grade = _parse_grade(grade_text)

    # --- Seller ---
    seller_el = await card.query_selector(".seller, .username, [data-seller]")
    seller = (await seller_el.inner_text()).strip() if seller_el else ""

    # --- Listing ID + URL ---
    link_el = await card.query_selector("a[href]")
    url = await link_el.get_attribute("href") if link_el else ""
    if url and not url.startswith("http"):
        url = "https://collectorcrypt.com" + url
    listing_id = _extract_listing_id(url)

    price_info = normalize_price(raw_price, currency, sol_usd_price)

    return {
        "platform": "collectorcrypt",
        "listing_id": listing_id,
        "name": name,
        "grader": grader,
        "grade": grade,
        "seller": seller,
        "url": url,
        **price_info,
    }


async def _detect_currency(card: ElementHandle) -> Optional[str]:
    # Method 1 — data-currency attribute
    icon = await card.query_selector("[data-currency]")
    if icon:
        val = await icon.get_attribute("data-currency")
        if val:
            return val.upper()  # "USDC" or "SOL"

    # Method 2 — CSS class name
    icon = await card.query_selector(".currency-icon, .token-icon, [class*='currency']")
    if icon:
        classes = (await icon.get_attribute("class") or "").lower()
        if "usdc" in classes:
            return "USDC"
        if "sol" in classes:
            return "SOL"

    # Method 3 — computed color (blue ≈ USDC, white/grey ≈ SOL)
    icon = await card.query_selector(".currency-icon, img[alt]")
    if icon:
        alt = (await icon.get_attribute("alt") or "").upper()
        if "USDC" in alt:
            return "USDC"
        if "SOL" in alt:
            return "SOL"
        try:
            color: str = await icon.evaluate(
                "el => getComputedStyle(el).color"
            )
            # rgb(59, 130, 246) is Tailwind blue-500 — USDC
            if "59" in color and "130" in color:
                return "USDC"
            return "SOL"
        except Exception:
            pass

    return None


def _parse_price(text: str) -> Optional[float]:
    # Strip currency symbols and commas, extract number
    match = re.search(r"[\d,]+\.?\d*", text.replace(",", ""))
    if not match:
        return None
    try:
        return float(match.group())
    except ValueError:
        return None


def _parse_grade(text: str) -> tuple[str, str]:
    text = text.upper()
    grader = "PSA"
    for g in ("CGC", "BGS", "PSA"):
        if g in text:
            grader = g
            break
    match = re.search(r"(\d+(?:\.\d+)?)", text)
    grade = match.group(1) if match else ""
    return grader, grade


def _extract_listing_id(url: str) -> str:
    if not url:
        return ""
    parts = url.rstrip("/").split("/")
    return parts[-1] if parts else ""
