#!/bin/bash
set -e

echo "========================================="
echo "   STEUF MASTER — Full Deploy Script"
echo "========================================="

# ─── 1. Steuf Intel Dashboard (port 3000) ─────────────────────────────────
echo ""
echo "[1/3] Deploying Steuf Intel Dashboard..."
cd steuf-dashboard
bash install.sh
cd ..

# ─── 2. Pokemon Arbitrage Dashboard (port 8000 + 3001) ────────────────────
echo ""
echo "[2/3] Deploying Pokemon Arbitrage Dashboard..."
cd pokemon-dashboard
bash install.sh
cd ..

# ─── 3. Master Dashboard + Nginx ──────────────────────────────────────────
echo ""
echo "[3/3] Setting up Nginx reverse proxy..."

# Copy landing page
sudo mkdir -p /var/www/steuf-master
sudo cp steuf-master/index.html /var/www/steuf-master/

# Copy nginx config
sudo cp nginx/steuf.conf /etc/nginx/sites-available/steuf
sudo ln -sf /etc/nginx/sites-available/steuf /etc/nginx/sites-enabled/steuf

# Remove default if it conflicts
sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Test and reload
sudo nginx -t
sudo systemctl reload nginx

echo ""
echo "========================================="
echo "   DEPLOY COMPLETE"
echo "========================================="
echo ""
echo "   http://VPS_IP/          → Landing page"
echo "   http://VPS_IP/crypto/   → Crypto Intel"
echo "   http://VPS_IP/pokemon/  → Pokemon Arbitrage"
echo ""
echo "   PM2 status: pm2 list"
echo "========================================="
