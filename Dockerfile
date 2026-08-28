# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=22.21.1
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="NestJS/Prisma"

# NestJS/Prisma app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"

# Install pnpm
ARG PNPM_VERSION=10.17.1
RUN npm install -g pnpm@$PNPM_VERSION


# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp openssl pkg-config python-is-python3

# Install node modules and generate Prisma's runtime during dependency setup.
COPY package.json pnpm-lock.yaml prisma.config.ts ./
COPY prisma ./prisma
COPY scripts/generate-prisma-client.mjs ./scripts/generate-prisma-client.mjs
RUN pnpm install --frozen-lockfile --prod=false

# Fail the image build if the generated client cannot be loaded.
RUN node -e "require('@prisma/client')"

# Copy application code
COPY . .

# Build application
RUN pnpm run build


# Final stage for app image
FROM base

# Install packages needed for deployment
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y openssl && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Copy built application
COPY --from=build /app /app

# Run as a non-root user in the final image.
RUN groupadd --system appgroup && \
    useradd --system --gid appgroup --home /app appuser && \
    chown -R appuser:appgroup /app

# Start the server by default, this can be overwritten at runtime
EXPOSE 8080
USER appuser
CMD [ "pnpm", "run", "start:prod" ]
