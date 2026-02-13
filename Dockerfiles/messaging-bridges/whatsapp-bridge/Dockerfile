# WhatsApp Bridge Docker Image
# Baileys WhatsApp Web client + Express HTTP API + SQLite archiver
#
# Build: docker build -t whatsapp-bridge .
# Run:   docker-compose up whatsapp-bridge

FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Clone repository
RUN git clone https://github.com/orbruno/whatsapp-agent-system.git .

# Install dependencies (clean install for reproducibility)
RUN npm ci

# Create data directories
RUN mkdir -p /app/data/auth_info_baileys /app/data/db /app/data/media

# Copy entrypoint
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3100

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "run", "start"]
