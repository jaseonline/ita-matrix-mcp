# Coolify builds this directly from the repo (Nixpacks will also work, but a
# pinned Dockerfile keeps the runtime predictable).
FROM node:24-alpine

WORKDIR /app

# Install deps first so the layer caches across code-only changes.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    # Key cache lives on a writable path inside the container.
    ITA_MATRIX_CACHE_DIR=/tmp/ita-matrix-cache

EXPOSE 3000

# node:alpine ships an unprivileged `node` user; drop root.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/http-server.js"]
