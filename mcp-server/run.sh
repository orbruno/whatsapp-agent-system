#!/bin/bash
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
uv run --directory "$BASE_DIR/mcp-server" python "$BASE_DIR/mcp-server/main.py"
