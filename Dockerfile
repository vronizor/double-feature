# Node 24 LTS has a stable built-in `node:sqlite`, so there are no native
# modules to compile and the arm64 image builds on a Pi without a toolchain.
FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY seeds ./seeds

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 8080
CMD ["node", "server/index.js"]
