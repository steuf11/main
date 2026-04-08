"""
Telegram notification service for Pokemon arbitrage opportunities.
"""

import requests
from config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
from database import get_db

TELEGRAM_BASE = "https://api.telegram.org"


def send_telegram(text: str) -> bool:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[Notifier] Telegram not configured, skipping.")
        return False
    try:
        r = requests.post(
            f"{TELEGRAM_BASE}/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
        return r.status_code == 200
    except Exception as e:
        print(f"[Notifier] Telegram error: {e}")
        return False


def alert_opportunity(opp: dict) -> bool:
    """Format and send a Telegram alert for a new opportunity."""
    text = (
        f"🃏 <b>ARBITRAGE DÉTECTÉ</b>\n\n"
        f"Carte: <b>{opp['card_name']}</b>\n"
        f"Prix listing: <b>${opp['listing_usd']:.2f}</b>\n"
        f"Argus moyen: <b>${opp['argus_usd']:.2f}</b>\n"
        f"Discount: <b>{opp['discount_pct']:.1f}%</b>\n"
        f"Confiance: {opp['confidence']}\n"
        f"Lien: {opp.get('url', 'N/A')}"
    )
    success = send_telegram(text)

    if success:
        # Mark as alerted in DB
        with get_db() as db:
            db.execute(
                "UPDATE opportunities SET alerted_telegram = 1 WHERE listing_id = ?",
                (opp["listing_id"],),
            )

    return success


def alert_scan_summary(listings_count: int, opps_count: int) -> bool:
    if opps_count == 0:
        return True  # Don't spam on no-result scans
    text = (
        f"📊 <b>Scan terminé</b>\n"
        f"Listings scannés: {listings_count}\n"
        f"Opportunités trouvées: {opps_count}"
    )
    return send_telegram(text)
