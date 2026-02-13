#!/bin/bash
# Slack Bridge Entrypoint
# Handles optional auto-update and token validation

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

AUTO_UPDATE=${BRIDGE_AUTO_UPDATE:-false}

# Optional: pull latest code on restart
if [ "$AUTO_UPDATE" = "true" ]; then
    echo -e "${YELLOW}[UPDATE]${NC} Checking for updates..."
    cd /app && git pull origin main --quiet
    npm ci --silent
    npm run build
    echo -e "${GREEN}[UPDATE]${NC} Updated successfully"
fi

# Token validation (Slack uses API tokens, no session files)
if [ -n "$SLACK_BOT_TOKEN" ] && [ -n "$SLACK_APP_TOKEN" ]; then
    echo -e "${GREEN}[AUTH]${NC} Slack tokens configured"
else
    echo -e "${RED}[AUTH]${NC} Missing required Slack tokens:"
    [ -z "$SLACK_BOT_TOKEN" ] && echo -e "  ${RED}-${NC} SLACK_BOT_TOKEN not set"
    [ -z "$SLACK_APP_TOKEN" ] && echo -e "  ${RED}-${NC} SLACK_APP_TOKEN not set"
    echo -e "${YELLOW}[AUTH]${NC} Bridge may fail to connect without valid tokens"
fi

exec "$@"
