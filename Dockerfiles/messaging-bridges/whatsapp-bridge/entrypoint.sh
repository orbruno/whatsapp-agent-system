#!/bin/bash
# WhatsApp Bridge Entrypoint
# Handles optional auto-update and auth detection

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

AUTO_UPDATE=${BRIDGE_AUTO_UPDATE:-false}

# Optional: pull latest code on restart
if [ "$AUTO_UPDATE" = "true" ]; then
    echo -e "${YELLOW}[UPDATE]${NC} Checking for updates..."
    cd /app && git pull origin main --quiet
    npm ci --silent
    echo -e "${GREEN}[UPDATE]${NC} Updated successfully"
fi

# Auth session detection
if [ -d "/app/data/auth_info_baileys" ] && [ "$(ls -A /app/data/auth_info_baileys 2>/dev/null)" ]; then
    echo -e "${GREEN}[AUTH]${NC} WhatsApp session found - will reconnect"
else
    echo -e "${YELLOW}[AUTH]${NC} No WhatsApp session - QR code pairing required on first run"
    echo -e "${YELLOW}[AUTH]${NC} Watch logs: docker logs -f whatsapp-bridge"
fi

exec "$@"
