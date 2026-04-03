"""
Telegram notifier — formats and sends opportunity alerts.

Groups all opportunities from a single scan into one message.
If > 5 opportunities: sends top 5 + a follow-up summary.
"""

import logging
from datetime import datetime, timezone

import httpx

import config

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"


async def send_opportunities(opportunities: list[dict], scan_platforms: list[str]) -> int:
    """
    Send grouped Telegram alert for a batch of opportunities.
    Returns count of messages sent.
    """
    if not opportunities:
        return 0

    top = opportunities[:5]
    rest = opportunities[5:]
    scan_time = datetime.now(timezone.utc).strftime("%H:%M UTC")
    platforms_str = " + ".join(scan_platforms)

    message = _build_message(top, platforms_str, scan_time)
    await _send(message)

    if rest:
        summary = (
            f"... et <b>{len(rest)} autre(s) opportunité(s)</b> détectée(s) ce scan."
        )
        await _send(summary)
        return 2

    return 1


def _build_message(opportunities: list[dict], platforms: str, scan_time: str) -> str:
    parts = ["🔥 <b>OPPORTUNITÉ(S) DÉTECTÉE(S)</b>\n"]

    for opp in opportunities:
        parts.append(_format_opportunity(opp))
        parts.append("────────────────")

    parts.append(f"Scan : {platforms} | {scan_time}")
    return "\n".join(parts)


def _format_opportunity(opp: dict) -> str:
    name = opp.get("name", "?")
    platform = opp.get("platform", "?").title()
    price_display = opp.get("listing_price_display", "?")
    argus_avg = opp.get("argus_avg_usd", 0.0)
    argus_psa = opp.get("argus_psa_usd")
    argus_fanatics = opp.get("argus_fanatics_usd")
    discount_pct = opp.get("discount_pct", 0.0)
    confidence = opp.get("argus_confidence", "?")
    seller = opp.get("seller", "?")
    url = opp.get("url", "")

    # Build argus line
    argus_parts = []
    if argus_psa:
        argus_parts.append(f"PSA: ${argus_psa:.0f}")
    if argus_fanatics:
        argus_parts.append(f"Fanatics: ${argus_fanatics:.0f}")
    argus_detail = f" ({' | '.join(argus_parts)})" if argus_parts else ""

    # Discount direction
    if discount_pct >= 0:
        discount_str = f"-{discount_pct:.0f}% 🟢"
    else:
        discount_str = f"+{abs(discount_pct):.0f}% AU-DESSUS argus ❌"

    # Confidence warning
    conf_warning = " ⚠️ peu de données" if confidence == "low" else ""

    lines = [
        f"\n<b>Carte :</b> {name}",
        f"<b>Plateforme :</b> {platform}",
        f"<b>Prix listing :</b> {price_display}",
        f"<b>Argus moyen :</b> ${argus_avg:.0f}{argus_detail}",
        f"<b>Écart :</b> {discount_str}",
        f"<b>Confiance :</b> {confidence}{conf_warning}",
        f"<b>Vendeur :</b> {seller}",
    ]

    if url:
        lines.append(f'\n👉 <a href="{url}">Voir le listing</a>')

    return "\n".join(lines)


async def _send(text: str) -> None:
    url = TELEGRAM_API.format(token=config.TELEGRAM_BOT_TOKEN)
    payload = {
        "chat_id": config.TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(url, json=payload, timeout=10)
            resp.raise_for_status()
        except Exception as exc:
            logger.error("Telegram send failed: %s", exc)
