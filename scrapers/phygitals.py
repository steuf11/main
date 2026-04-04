"""
Phygitals marketplace scraper.

Prices are displayed in $USD directly.
fmv_alt is extracted but NOT used as argus — only PSA + Fanatics are trusted.
"""

import logging
import re
from typing import Optional

from playwright.async_api import async_playwright, ElementHandle

import config

logger = logging.getLogger(__name__)

MARKETPLACE_URL = "https://phygitals.com/marketplace?category=Pokemon"


async def scrape_phygitals() -> list[dict]:
    """Return normalized listings from Phygitals."""
    listings: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()

        for page_num in range(1, config.MAX_PAGES + 1):
            url = f"{MARKETPLACE_URL}&page={page_num}"
            logger.info("Phygitals — fetching page %d", page_num)

            await page.goto(url, wait_until="networkidle", timeout=30_000)

            try:
                await page.wait_for_selector(
                    "[data-testid='listing'], .listing-card, .card-item",
                    timeout=10_000,
                )
            except Exception:
                logger.warning("Phygitals — no cards found on page %d, stopping", page_num)
                break

            cards = await page.query_selector_all(
                "[data-testid='listing'], .listing-card, .card-item"
            )
            if not cards:
                break

            for card in cards:
                try:
                    listing = await _extract_one_card(card)
                    if listing:
                        listings.append(listing)
                except Exception as exc:
                    logger.warning("Phygitals — card extraction failed: %s", exc)

            if len(cards) < 20:
                break

        await browser.close()

    logger.info("Phygitals — %d listings scraped", len(listings))
    return listings


async def _extract_one_card(card: ElementHandle) -> Optional[dict]:
    # --- Name ---
    name_el = await card.query_selector(".card-name, .title, h3, h2")
    name = (await name_el.inner_text()).strip() if name_el else "Unknown"

    # --- Grader + grade ---
    grade_el = await card.query_selector(".grade, [data-grade]")
    grade_text = (await grade_el.inner_text()).strip() if grade_el else ""
    grader, grade = _parse_grade(grade_text)

    # --- Price (USD direct) ---
    price_el = await card.query_selector(".price, [data-price], .listing-price")
    if not price_el:
        return None
    raw_price_text = (await price_el.inner_text()).strip()
    price = _parse_price(raw_price_text)
    if price is None:
        return None

    # --- FMV ALT (informational only — do not use as argus) ---
    fmv_el = await card.query_selector(".fmv, [data-fmv], .alt-fmv")
    fmv_alt: Optional[float] = None
    if fmv_el:
        fmv_alt = _parse_price((await fmv_el.inner_text()).strip())

    # --- Cert ID ---
    cert_el = await card.query_selector(".cert-id, [data-cert]")
    cert_id = (await cert_el.inner_text()).strip() if cert_el else ""

    # --- Seller ---
    seller_el = await card.query_selector(".seller, .username")
    seller = (await seller_el.inner_text()).strip() if seller_el else ""

    # --- URL ---
    link_el = await card.query_selector("a[href]")
    url = await link_el.get_attribute("href") if link_el else ""
    if url and not url.startswith("http"):
        url = "https://phygitals.com" + url
    listing_id = url.rstrip("/").split("/")[-1] if url else ""

    return {
        "platform": "phygitals",
        "listing_id": listing_id,
        "name": name,
        "grader": grader,
        "grade": grade,
        "seller": seller,
        "url": url,
        "listing_price_usd": price,
        "listing_price_display": f"${price:.2f}",
        "currency": "USD",
        "fmv_alt": fmv_alt,
        "cert_id": cert_id,
    }


def _parse_price(text: str) -> Optional[float]:
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
