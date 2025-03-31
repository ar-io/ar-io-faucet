ARG NODE_VERSION_SHORT=22

FROM node:${NODE_VERSION_SHORT}-bookworm-slim AS builder

# Needed for some dev deps
RUN apt-get update && apt-get install -y git

# Build
WORKDIR /usr/src/app
COPY . .
RUN yarn install \
    && yarn build \
    && rm -rf node_modules \
    && yarn install --production

# Extract dist
FROM gcr.io/distroless/nodejs${NODE_VERSION_SHORT}-debian12
WORKDIR /usr/src/app

# Copy build files
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/package.json .

# Setup port
EXPOSE 3000

# Add labels
LABEL org.opencontainers.image.title="ar.io - Testnet Faucet Service"

CMD [ "node", "dist/app.js" ]
