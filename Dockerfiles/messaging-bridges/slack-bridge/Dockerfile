# Slack Bridge Docker Image
# Bolt.js Slack client + Express HTTP API + SQLite archiver
#
# Build: docker build -t slack-bridge .
# Run:   docker-compose up slack-bridge

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
RUN git clone https://github.com/orbruno/slack-bridge.git .

# Install dependencies
RUN npm ci

# Build TypeScript
RUN npm run build

# Create data directories
RUN mkdir -p /app/data/db /app/data/media

# Copy entrypoint
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3102

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "run", "start"]
