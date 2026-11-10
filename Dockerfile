# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS verification
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY public ./public
COPY tests ./tests
COPY tsconfig.json .prettierrc.json .prettierignore ./
RUN npm run check

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runtime
ENV NODE_ENV=production CHANGELAB_HOST=0.0.0.0 PORT=4317 CHANGELAB_DB=/app/data/changelab.sqlite
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 4317
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server.ts"]
