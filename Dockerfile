ARG NODE_VERSION=22.13.10
ARG NODE_VERSION_SHORT=22

FROM node:${NODE_VERSION}-bookworm-slim AS builder

# Needed for some dev deps
RUN apt-get update && apt-get install -y git

# Build
WORKDIR /usr/src/app
COPY . .
RUN yarn && yarn build

# Extract dist
FROM gcr.io/distroless/nodejs${NODE_VERSION_SHORT}-debian12
WORKDIR /usr/src/app

# Add shell
COPY --from=busybox:1.35.0-uclibc /bin/sh /bin/sh
COPY --from=busybox:1.35.0-uclibc /bin/chown /bin/chown
COPY --from=busybox:1.35.0-uclibc /bin/chmod /bin/chmod
COPY --from=busybox:1.35.0-uclibc /bin/sleep /bin/sleep

# Copy build files
COPY --from=builder /usr/src/app .

# Setup port
EXPOSE 3000

# Add labels
LABEL org.opencontainers.image.title="ar.io - Testnet Faucet Service"

ENTRYPOINT [ "node", "src/app.js" ]
