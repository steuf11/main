#!/bin/bash
set -e

echo "=== Installing Steuf Intel Dashboard ==="

cd "$(dirname "$0")"

npm install

mkdir -p data
[ ! -f data/signals.json ] && echo "[]" > data/signals.json
[ ! -f data/intel.json ] && echo "[]" > data/intel.json

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — edit DASHBOARD_SECRET before starting!"
fi

if command -v pm2 &>/dev/null; then
  pm2 start server.js --name steuf-dashboard
  pm2 save
  echo "=== Dashboard started via PM2 ==="
else
  echo "PM2 not installed. Install with: npm install -g pm2"
  echo "Then run: pm2 start server.js --name steuf-dashboard && pm2 save"
fi

echo "=== Done. Dashboard at http://localhost:${PORT:-3000} ==="
