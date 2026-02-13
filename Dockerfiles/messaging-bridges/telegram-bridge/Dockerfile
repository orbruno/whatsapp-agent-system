# Telegram Bridge Docker Image
# Telethon client + FastAPI HTTP bridge
#
# Build: docker build -t telegram-bridge .
# Run:   docker-compose up telegram-bridge

FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install UV package manager
RUN pip install --no-cache-dir uv

# Create app directory
WORKDIR /app

# Clone repository
RUN git clone https://github.com/orbruno/telegram-mcp.git .

# Install dependencies with UV
RUN uv sync

# Create data directories
RUN mkdir -p /app/data/session /app/data/db /app/data/media

# Copy entrypoint
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8081

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["uv", "run", "python", "telegram-bridge/main.py"]
