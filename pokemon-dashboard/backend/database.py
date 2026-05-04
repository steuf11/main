import sqlite3
import os
from contextlib import contextmanager
from config import DATABASE_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_name TEXT NOT NULL,
    grader TEXT,
    grade TEXT,
    price_usd REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    seller TEXT,
    url TEXT UNIQUE NOT NULL,
    platform TEXT DEFAULT 'phygitals',
    scraped_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS argus_cache (
    card_key TEXT PRIMARY KEY,
    psa_usd REAL,
    fanatics_usd REAL,
    avg_usd REAL,
    confidence TEXT DEFAULT 'FAIBLE',
    fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER REFERENCES listings(id),
    card_name TEXT NOT NULL,
    listing_usd REAL NOT NULL,
    argus_usd REAL NOT NULL,
    discount_pct REAL NOT NULL,
    confidence TEXT NOT NULL,
    seller TEXT,
    url TEXT,
    platform TEXT DEFAULT 'phygitals',
    alerted_telegram INTEGER DEFAULT 0,
    seen INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    listings_scraped INTEGER DEFAULT 0,
    opportunities_found INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',
    error_msg TEXT
);

CREATE INDEX IF NOT EXISTS idx_opp_discount ON opportunities(discount_pct);
CREATE INDEX IF NOT EXISTS idx_opp_seen ON opportunities(seen);
CREATE INDEX IF NOT EXISTS idx_opp_created ON opportunities(created_at);
CREATE INDEX IF NOT EXISTS idx_listings_url ON listings(url);
"""


def init_db():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.executescript(SCHEMA)
    conn.close()


@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# Initialize on import
init_db()
