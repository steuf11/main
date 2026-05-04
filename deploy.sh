#!/bin/bash
set -e

echo "========================================="
echo "   STEUF MASTER — Full Deploy Script"
echo "   (Mode VPS Contabo — sans Nginx)"
echo "========================================="

# ─── 1. Steuf Intel Dashboard (port 3000) ─────────────────────────────────
echo ""
echo "[1/2] Deploying Steuf Intel Dashboard..."
cd steuf-dashboard
bash install.sh
cd ..

# ─── 2. Pokemon Arbitrage Dashboard (port 8001 + 3001) ────────────────────
echo ""
echo "[2/2] Deploying Pokemon Arbitrage Dashboard..."
cd pokemon-dashboard
bash install.sh
cd ..

echo ""
echo "========================================="
echo "   DEPLOY COMPLETE"
echo "========================================="
echo ""
echo "   http://VPS_IP:3000   → Crypto Intel Dashboard"
echo "   http://VPS_IP:3001   → Pokemon Arbitrage Dashboard"
echo ""
echo "   PM2 status: pm2 list"
echo "   PM2 logs:   pm2 logs"
echo "========================================="
echo ""
echo "NOTE: Les ports 80/443 sont utilisés par OpenClaw (Docker)."
echo "      Accède aux dashboards via les ports directs ci-dessus."
echo ""
