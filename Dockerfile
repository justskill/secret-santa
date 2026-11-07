# Everything runs in this one container: web app, Santa agent, scheduler, and SQLite database.

FROM node:22-bookworm-slim AS build
# The SQLite driver compiles from source. These tools stay in this stage, out of the final image.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
# Photos can be several megabytes. The server's default limit is 512 KB.
ENV BODY_SIZE_LIMIT=8M
# Read the real visitor address from the reverse proxy, for login throttling.
ENV ADDRESS_HEADER=X-Forwarded-For
ENV XFF_DEPTH=1
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build/index.js"]
