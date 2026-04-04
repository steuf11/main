"""
SQLite cache for argus data — TTL 6 hours.
card_key: slugified "name-grader-grade"
"""

import re
import sqlite3
import logging
from datetime import datetime, timedelta
from typing import Optional

import config

logger = logging.getLogger(__name__)

DB_PATH = "argus_cache.db"

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS argus_cache (
    card_key    TEXT PRIMARY KEY,
    psa_usd     REAL,
    fanatics_usd REAL,
    avg_usd     REAL,
    confidence  TEXT,
    fetched_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seen_listings (
    listing_key TEXT PRIMARY KEY,
    alerted_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at      TEXT NOT NULL,
    opportunities_found INTEGER,
    alerts_sent INTEGER
);

CREATE TABLE IF NOT EXISTS sol_price_cache (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    price_usd   REAL NOT NULL,
    fetched_at  TEXT NOT NULL
);
"""


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _conn() as conn:
        conn.executescript(_CREATE_TABLE)


def make_card_key(name: str, grader: str, grade: str) -> str:
    slug = f"{name}-{grader}-{grade}".lower()
    return re.sub(r"[^a-z0-9]+", "-", slug).strip("-")


def get_argus(card_key: str) -> Optional[dict]:
    """Return cached argus data if not expired."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM argus_cache WHERE card_key = ?", (card_key,)
        ).fetchone()
    if not row:
        return None
    age = datetime.utcnow() - datetime.fromisoformat(row["fetched_at"])
    if age > timedelta(hours=config.ARGUS_CACHE_TTL_HOURS):
        return None
    return dict(row)


def set_argus(card_key: str, psa_usd: Optional[float], fanatics_usd: Optional[float],
              avg_usd: float, confidence: str) -> None:
    with _conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO argus_cache
               (card_key, psa_usd, fanatics_usd, avg_usd, confidence, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (card_key, psa_usd, fanatics_usd, avg_usd, confidence,
             datetime.utcnow().isoformat()),
        )


def was_alerted(listing_key: str, within_hours: int = 24) -> bool:
    with _conn() as conn:
        row = conn.execute(
            "SELECT alerted_at FROM seen_listings WHERE listing_key = ?",
            (listing_key,),
        ).fetchone()
    if not row:
        return False
    age = datetime.utcnow() - datetime.fromisoformat(row["alerted_at"])
    return age < timedelta(hours=within_hours)


def mark_alerted(listing_key: str) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO seen_listings (listing_key, alerted_at) VALUES (?, ?)",
            (listing_key, datetime.utcnow().isoformat()),
        )


def log_run(opportunities_found: int, alerts_sent: int) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO run_log (run_at, opportunities_found, alerts_sent) VALUES (?, ?, ?)",
            (datetime.utcnow().isoformat(), opportunities_found, alerts_sent),
        )


def get_cached_sol_price() -> Optional[float]:
    """Return cached SOL price if within SOL_PRICE_CACHE_MAX_AGE_MINUTES."""
    with _conn() as conn:
        row = conn.execute("SELECT * FROM sol_price_cache WHERE id = 1").fetchone()
    if not row:
        return None
    age = datetime.utcnow() - datetime.fromisoformat(row["fetched_at"])
    if age > timedelta(minutes=config.SOL_PRICE_CACHE_MAX_AGE_MINUTES):
        return None
    return row["price_usd"]


def set_cached_sol_price(price_usd: float) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO sol_price_cache (id, price_usd, fetched_at) VALUES (1, ?, ?)",
            (price_usd, datetime.utcnow().isoformat()),
        )
