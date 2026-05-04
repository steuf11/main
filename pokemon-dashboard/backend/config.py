import os
from dotenv import load_dotenv

load_dotenv()

SCAN_INTERVAL_HOURS = int(os.getenv("SCAN_INTERVAL_HOURS", "1"))
MIN_DISCOUNT_PCT = float(os.getenv("MIN_DISCOUNT_PCT", "20"))
MIN_ARGUS_USD = float(os.getenv("MIN_ARGUS_USD", "30"))
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "307358521")
COINGECKO_API_KEY = os.getenv("COINGECKO_API_KEY", "")
DATABASE_PATH = os.getenv("DATABASE_PATH", "pokemon.db")
