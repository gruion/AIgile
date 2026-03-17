FROM node:20-alpine

WORKDIR /app

# Install API dependencies
COPY api/package*.json ./api/
RUN cd api && npm ci --omit=dev

# Copy API source and ai-lib
COPY api/ ./api/
COPY ai-lib/ ./ai-lib/

WORKDIR /app/api

EXPOSE 3001
CMD ["node", "server.js"]
