import os
from dotenv import load_dotenv

load_dotenv()

# Telegram
TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TELEGRAM_CHAT_ID = int(os.environ["TELEGRAM_CHAT_ID"])

# OpenClaw
OPENCLAW_WEBHOOK_URL = os.environ["OPENCLAW_WEBHOOK_URL"]
OPENCLAW_API_KEY = os.environ["OPENCLAW_API_KEY"]

# CoinGecko (optional — free tier works without key)
COINGECKO_API_KEY = os.getenv("COINGECKO_API_KEY", "")

# Scan settings
SCAN_INTERVAL_HOURS = int(os.getenv("SCAN_INTERVAL_HOURS", "1"))
MAX_PAGES = int(os.getenv("MAX_PAGES", "10"))

# Filter thresholds
MIN_DISCOUNT_PCT = float(os.getenv("MIN_DISCOUNT_PCT", "20"))
MIN_ARGUS_USD = float(os.getenv("MIN_ARGUS_USD", "30"))
MAX_ARGUS_UNCERTAINTY = float(os.getenv("MAX_ARGUS_UNCERTAINTY", "50"))
SELLER_MULTI_THRESHOLD = int(os.getenv("SELLER_MULTI_THRESHOLD", "3"))
MAX_ALERTS_PER_RUN = int(os.getenv("MAX_ALERTS_PER_RUN", "10"))

# Argus cache TTL
ARGUS_CACHE_TTL_HOURS = 6

# SOL price cache (fallback if CoinGecko unreachable)
SOL_PRICE_CACHE_MAX_AGE_MINUTES = 30

# High-demand cards (bonus score)
HIGH_DEMAND_CARDS = {"charizard", "pikachu", "mewtwo", "rayquaza"}
