FROM node:20-alpine AS base

WORKDIR /app

# Install only production dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY server.js ./
COPY public ./public

# State directory for synced alert acks. Mount a volume here to persist.
RUN mkdir -p /app/.state && chown -R node:node /app

USER node
EXPOSE 3000
VOLUME ["/app/.state"]

ENV NODE_ENV=production
CMD ["node", "server.js"]
