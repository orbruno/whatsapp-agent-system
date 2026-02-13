#!/bin/bash
# Telegram Bridge Entrypoint
# Handles optional auto-update and session detection

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
    uv sync --quiet
    echo -e "${GREEN}[UPDATE]${NC} Updated successfully"
fi

# Session detection
if [ -f "/app/data/session/telegram.session" ]; then
    echo -e "${GREEN}[AUTH]${NC} Telegram session found - will reconnect"
else
    echo -e "${YELLOW}[AUTH]${NC} No Telegram session - first run authentication required"
    echo -e "${YELLOW}[AUTH]${NC} Ensure TELEGRAM_API_ID, TELEGRAM_API_HASH, and TELEGRAM_PHONE are set"
fi

exec "$@"
