ARG NODE_VERSION_SHORT=22

FROM node:${NODE_VERSION_SHORT}-bookworm-slim AS builder

# Needed for some dev deps
RUN apt-get update && apt-get install -y git

# Build
WORKDIR /usr/src/app
COPY . .
RUN yarn && yarn build

# Extract dist
FROM gcr.io/distroless/nodejs${NODE_VERSION_SHORT}-debian12
WORKDIR /usr/src/app

# Copy build files
COPY --from=builder /usr/src/app .

# Setup port
EXPOSE 3000

# Add labels
LABEL org.opencontainers.image.title="ar.io - Testnet Faucet Service"

ENTRYPOINT [ "node", "src/app.js" ]
