#!/bin/bash
set -e

echo "=== Installing Pokemon Arbitrage Dashboard ==="

cd "$(dirname "$0")"

# Backend
echo "[1/4] Installing Python dependencies..."
cd backend
pip install -r requirements.txt
playwright install chromium
cd ..

# Frontend
echo "[2/4] Installing frontend dependencies..."
cd frontend
npm install
npm run build
cd ..

# Env
echo "[3/4] Setting up configuration..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env — edit TELEGRAM_BOT_TOKEN before starting!"
fi
cp .env backend/.env 2>/dev/null || true

# Start services
echo "[4/4] Starting services..."
if command -v pm2 &>/dev/null; then
  cd backend
  pm2 start "uvicorn main:app --host 0.0.0.0 --port 8000" --name pokemon-backend
  cd ../frontend
  pm2 start "npm start" --name pokemon-frontend
  pm2 save
  echo "=== Started via PM2: pokemon-backend (8000) + pokemon-frontend (3001) ==="
else
  echo "PM2 not installed. Manual start:"
  echo "  Backend: cd backend && uvicorn main:app --host 0.0.0.0 --port 8000"
  echo "  Frontend: cd frontend && npm start"
fi

echo "=== Done ==="
