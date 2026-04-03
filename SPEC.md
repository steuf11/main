# SPEC — Pokémon Arbitrage Scanner

## Vue d'ensemble

Script Python autonome qui tourne en cron, scrape CollectorCrypt et Phygitals, compare chaque listing à l'argus réel (PSA Auction Prices + Fanatics Collect), filtre les opportunités et envoie une notification Telegram formatée. Résultats envoyés aussi à OpenClaw via webhook.

---

## Stack technique

```
Python 3.11+
playwright          # scraping JS dynamique (SPA)
httpx               # appels API argus
sqlite3             # cache argus local
python-telegram-bot # notifications
schedule ou cron    # orchestration
python-dotenv       # secrets
```

---

## Structure du projet

```
pokemon-scanner/
├── main.py
├── scrapers/
│   ├── collectorcrypt.py
│   └── phygitals.py
├── argus/
│   ├── engine.py        # orchestrateur argus
│   ├── psa.py           # PSA Auction Prices
│   ├── fanatics.py      # Fanatics Collect
│   └── cache.py         # SQLite TTL 6h
├── notifier/
│   ├── telegram.py
│   └── openclaw.py
├── config.py
├── .env
└── requirements.txt
```

---

## Module 1 — Scrapers

### CollectorCrypt — Détection devise par card

**Chaque card individuellement** peut être en USDC ou SOL — pas toute la page.
La devise doit être détectée **au niveau de chaque card element** dans le DOM.

- Icône **bleue** = USDC (prix nominal, ex: 750)
- Icône **noire/blanche** = SOL (prix en SOL, ex: 3 SOL ≈ $390)
- Les deux peuvent coexister sur la même page chez le même vendeur

Stratégie de détection (ordre de priorité) :

```python
# Méthode 1 — attribut data- sur l'icône (préféré)
currency_icon = card.query_selector('[data-currency]')
currency = currency_icon.get_attribute('data-currency')  # "USDC" | "SOL"

# Méthode 2 — classe CSS de l'icône (fallback)
icon = card.query_selector('.currency-icon')
classes = icon.get_attribute('class')
if 'usdc' in classes.lower():    currency = "USDC"
elif 'sol' in classes.lower():   currency = "SOL"

# Méthode 3 — couleur via computed style (dernier recours)
color = icon.evaluate("el => getComputedStyle(el).color")
# bleu = USDC, blanc/gris = SOL
```

### `scrapers/collectorcrypt.py`

```
URL : https://collectorcrypt.com/marketplace/cards
Filtre : category=Pokemon, sort=Recently Listed
Pagination : toutes les pages jusqu'à max_pages (config)

Pour chaque card element extraire :
  - name       : texte du titre
  - grade      : valeur numérique (PSA/CGC/BGS + note)
  - grader     : "PSA" | "CGC" | "BGS"
  - price      : float
  - currency   : "USDC" | "SOL"  (détecter via couleur icône ou attribut data-)
  - seller     : username
  - listing_id : identifiant unique
  - url        : lien direct vers la fiche

Conversion : si currency == "SOL", convertir en USD via sol_usd_price passé en param
Retourner : List[dict]
```

### `scrapers/phygitals.py`

```
URL : https://phygitals.com/marketplace (filtre Pokemon)
Même structure que CollectorCrypt
Champs supplémentaires :
  - fmv_alt    : float (FMV affiché par ALT — NE PAS faire confiance seul)
  - cert_id    : numéro de certification CGC/PSA

Prix affiché en $USD direct — pas de conversion nécessaire.
Note : le FMV ALT est souvent faux — toujours croiser avec argus engine
```

---

## Module 2 — Argus Engine

### `argus/cache.py`

```
SQLite table : argus_cache
colonnes : card_key TEXT PK, psa_usd REAL, fanatics_usd REAL,
            avg_usd REAL, confidence TEXT, fetched_at TIMESTAMP
TTL : 6 heures (ne pas refetch si entrée < 6h)
card_key : slugify(name + grader + grade)
```

### `argus/psa.py`

```
Scraper https://www.psacard.com/auctionprices/
Recherche par nom de carte + set
Extraire les 5 dernières ventes pour le grade exact
Calculer : median des ventes récentes (< 90 jours)
Retourner : {"price": float, "sales_count": int, "confidence": "high"|"medium"|"low"}
```

### `argus/fanatics.py`

```
Scraper https://www.fanaticscollect.com
Recherche par nom + grade
Extraire : guide price + dernières ventes
Retourner même format que psa.py
```

### `argus/engine.py`

```
Pour chaque listing :
  1. Construire card_key
  2. Vérifier cache SQLite
  3. Si cache miss ou expiré : appeler psa.py + fanatics.py
  4. avg_usd = moyenne(psa_usd, fanatics_usd) si les deux dispo, sinon celui dispo
  5. Stocker en cache
  6. Calculer discount_pct = (avg_usd - listing_usd) / avg_usd * 100
  7. Retourner listing enrichi avec discount_pct et argus data
```

---

## Module 3 — Filtrage & Scoring

### `config.py`

```python
MIN_DISCOUNT_PCT = 20      # % minimum sous l'argus pour alerter
MIN_ARGUS_USD = 30         # ignorer les cartes < $30 argus (trop de bruit)
MAX_ARGUS_UNCERTAINTY = 50 # ignorer si écart PSA/Fanatics > 50%
SELLER_MULTI_THRESHOLD = 3 # vendeur avec X+ listings = priorité négociation
SCAN_INTERVAL_HOURS = 1
MAX_ALERTS_PER_RUN = 10
```

### Logique de filtre

```
Opportunités retenues si :
  - discount_pct >= MIN_DISCOUNT_PCT
  - avg_argus_usd >= MIN_ARGUS_USD
  - confidence != "low" (sauf si discount_pct >= 40, alerter avec warning)
  - listing pas déjà alerté dans les dernières 24h (table seen_listings SQLite)

Bonus score (+10 points) si :
  - même seller a >= SELLER_MULTI_THRESHOLD listings (levier négociation)
  - grade PSA 10 ou CGC Pristine 10 (premium liquidité)
  - carte = Charizard | Pikachu | Mewtwo | Rayquaza (demande élevée)
```

---

## Module 4 — Telegram Notifier

### Format message

```
🔥 OPPORTUNITÉ DÉTECTÉE

Carte : Charizard Holo PSA 9 Power Keepers
Plateforme : CollectorCrypt
Prix listing : 750 USDC ($750.00)
              ou
Prix listing : 3 SOL (≈$390.00 @ $130.00/SOL)
Argus moyen : $480 (PSA: $505 | Fanatics: $455)
Écart : -91% 🟢
Confiance : haute (12 ventes PSA récentes)
Vendeur : 3pQbTq...UtMz (8 listings actifs ⚠️ offre groupée possible)

👉 Voir le listing

────────────────
Scan : CollectorCrypt + Phygitals | 14:32 UTC
```

Grouper toutes les opportunités d'un même scan en UN SEUL message.
Si > 5 opportunités : envoyer top 5 par discount_pct DESC + message séparé "Et X autres..."

---

## Module 5 — OpenClaw Integration

### Payload webhook

```json
{
  "event": "arbitrage_opportunity",
  "card_name": "str",
  "platform": "collectorcrypt | phygitals",
  "listing_price_usd": 0.0,
  "argus_usd": 0.0,
  "discount_pct": 0.0,
  "listing_url": "str",
  "seller": "str",
  "grade": "str",
  "grader": "str",
  "confidence": "str",
  "scanned_at": "ISO8601"
}
```

Auth : `Authorization: Bearer OPENCLAW_API_KEY`

---

## `main.py` — Orchestrateur

```
Séquence complète :
1. Fetch prix SOL via CoinGecko (1 seul appel par run)
2. Lancer scrapers CollectorCrypt + Phygitals en parallèle (asyncio)
3. Normaliser tous les listings (convert SOL→USD)
4. Enrichir avec argus engine (cache first)
5. Filtrer selon config
6. Trier par discount_pct DESC
7. Envoyer Telegram (groupé)
8. Envoyer webhooks OpenClaw (1 par opportunité)
9. Logger résultats dans run_log SQLite
10. Dormir jusqu'au prochain cycle
```

---

## Normalisation des prix SOL/USDC

```python
def normalize_price(raw_price: float, currency: str, sol_usd_price: float) -> dict:
    if currency == "USDC":
        return {
            "listing_price_usd": raw_price,
            "listing_price_display": f"${raw_price:.2f} USDC",
            "currency": "USDC"
        }
    elif currency == "SOL":
        usd_value = raw_price * sol_usd_price
        return {
            "listing_price_usd": usd_value,
            "listing_price_display": f"{raw_price} SOL (≈${usd_value:.2f})",
            "currency": "SOL",
            "sol_amount": raw_price,
            "sol_price_used": sol_usd_price
        }
    else:
        raise ValueError(f"Devise inconnue : {currency}")
```

---

## Cas edge

| Cas | Comportement |
|-----|-------------|
| API CoinGecko inaccessible | Utiliser dernier prix SOL en cache (max 30 min), sinon skip run |
| Prix SOL fractionnaire (ex: 0.48 SOL) | Gérer les float avec 4 décimales |
| Card sans devise détectée | Logger warning + skip (ne pas supposer une devise) |
| Même carte en SOL sur CC et USDC sur Phygitals | Normaliser les deux en USD avant déduplication |
| Confidence "low" | Mentionner dans Telegram, alerter seulement si discount >= 40% |

---

## `.env`

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=307358521
OPENCLAW_WEBHOOK_URL=https://...
OPENCLAW_API_KEY=...
COINGECKO_API_KEY=...
SCAN_INTERVAL_HOURS=1
MIN_DISCOUNT_PCT=20
```

---

## Points d'attention

1. **CollectorCrypt et Phygitals sont des SPA React** — utiliser `playwright` avec `wait_for_selector` sur les cards, pas `requests`
2. **SOL→USD** : appeler CoinGecko une seule fois par run, pas en cache (prix volatile)
3. **Rate limiting argus** : espacer les calls PSA/Fanatics de 2-3s, sinon ban IP
4. **FMV ALT Phygitals** : ne pas utiliser comme argus — uniquement PSA + Fanatics
5. **Déduplication** : même carte peut apparaître sur les deux plateformes — dédupliquer par `card_key`
6. **Devise par card** sur CollectorCrypt : détecter individuellement sur chaque card element
