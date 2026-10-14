FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production \
    CERT_DIR=/certs

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# The volume inherits this ownership, so the unprivileged node user (UID 1000) can write to it
RUN mkdir -p /certs && chown node:node /certs
USER node
VOLUME /certs

ENTRYPOINT ["node", "src/cli.js"]
CMD ["run"]
