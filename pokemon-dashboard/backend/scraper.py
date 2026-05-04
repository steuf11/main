"""
Phygitals Marketplace Scraper — extracts Pokemon card listings.
Uses Playwright for dynamic page rendering.
"""

import re
import asyncio
import requests
from datetime import datetime, timezone
from playwright.async_api import async_playwright
from database import get_db

PHYGITALS_URL = "https://phygitals.com/marketplace"
SOL_PRICE_CACHE = {"price": 0.0, "fetched_at": 0.0}


def get_sol_usd_price() -> float:
    """Fetch current SOL/USD price via CoinGecko (cached 5 min)."""
    import time
    now = time.time()
    if now - SOL_PRICE_CACHE["fetched_at"] < 300 and SOL_PRICE_CACHE["price"] > 0:
        return SOL_PRICE_CACHE["price"]
    try:
        r = requests.get(
            "https://api.coingecko.com/api/v3/simple/price",
            params={"ids": "solana", "vs_currencies": "usd"},
            timeout=10,
        )
        price = r.json()["solana"]["usd"]
        SOL_PRICE_CACHE["price"] = price
        SOL_PRICE_CACHE["fetched_at"] = now
        return price
    except Exception as e:
        print(f"[Scraper] CoinGecko fetch failed: {e}")
        return SOL_PRICE_CACHE["price"] or 100.0  # fallback


def parse_price_usd(price_text: str, currency: str) -> float:
    """Convert raw price text to USD float."""
    cleaned = re.sub(r"[^\d.]", "", price_text.strip())
    if not cleaned:
        return 0.0
    value = float(cleaned)
    if currency.upper() == "SOL":
        return value * get_sol_usd_price()
    return value


async def scrape_phygitals(max_pages: int = 10) -> list[dict]:
    """Scrape Pokemon card listings from Phygitals marketplace."""
    listings = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()

        for page_num in range(1, max_pages + 1):
            url = f"{PHYGITALS_URL}?page={page_num}&category=pokemon"
            print(f"[Scraper] Fetching page {page_num}: {url}")

            try:
                await page.goto(url, wait_until="networkidle", timeout=30000)
                await page.wait_for_timeout(2000)
            except Exception as e:
                print(f"[Scraper] Page {page_num} load failed: {e}")
                break

            # Extract card elements — adjust selectors based on actual DOM
            cards = await page.query_selector_all("[data-testid='listing-card'], .listing-card, .card-item")

            if not cards:
                print(f"[Scraper] No cards found on page {page_num}, stopping.")
                break

            for card in cards:
                try:
                    name_el = await card.query_selector(".card-name, h3, [data-testid='card-name']")
                    price_el = await card.query_selector(".price, [data-testid='price']")
                    link_el = await card.query_selector("a[href]")
                    seller_el = await card.query_selector(".seller, [data-testid='seller']")

                    card_name = (await name_el.inner_text()).strip() if name_el else ""
                    price_raw = (await price_el.inner_text()).strip() if price_el else "0"
                    href = await link_el.get_attribute("href") if link_el else ""
                    seller = (await seller_el.inner_text()).strip() if seller_el else ""

                    if not card_name:
                        continue

                    # Detect currency from price text
                    currency = "SOL" if "SOL" in price_raw.upper() else "USD"
                    price_usd = parse_price_usd(price_raw, currency)

                    # Extract grader + grade from name (e.g., "Charizard PSA 10")
                    grader, grade = "", ""
                    grade_match = re.search(r"(PSA|BGS|CGC)\s*(\d+\.?\d*)", card_name, re.IGNORECASE)
                    if grade_match:
                        grader = grade_match.group(1).upper()
                        grade = grade_match.group(2)

                    full_url = href if href.startswith("http") else f"https://phygitals.com{href}"

                    listings.append({
                        "card_name": card_name,
                        "grader": grader,
                        "grade": grade,
                        "price_usd": round(price_usd, 2),
                        "currency": currency,
                        "seller": seller,
                        "url": full_url,
                        "platform": "phygitals",
                        "scraped_at": datetime.now(timezone.utc).isoformat(),
                    })
                except Exception as e:
                    print(f"[Scraper] Error parsing card: {e}")
                    continue

        await browser.close()

    print(f"[Scraper] Total listings extracted: {len(listings)}")
    return listings


def save_listings(listings: list[dict]) -> int:
    """Insert listings into DB, deduplicating by URL. Returns count inserted."""
    inserted = 0
    with get_db() as db:
        for l in listings:
            try:
                db.execute(
                    """INSERT OR IGNORE INTO listings
                       (card_name, grader, grade, price_usd, currency, seller, url, platform, scraped_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (l["card_name"], l["grader"], l["grade"], l["price_usd"],
                     l["currency"], l["seller"], l["url"], l["platform"], l["scraped_at"]),
                )
                if db.total_changes:
                    inserted += 1
            except Exception as e:
                print(f"[Scraper] Insert error: {e}")
    return inserted
