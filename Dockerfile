# ====================================================================
# STAGE 1: Dependency Resolution & Build Context
# ====================================================================
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Copy package manifests first to maximize Docker layer caching
COPY package*.json ./

# Install ALL dependencies (including devDependencies needed for type-checking/transpiling)
RUN npm ci

# Copy the rest of your application source code from the root directory
COPY . .

# Prune devDependencies to leave only essential production modules on disk
RUN npm prune --production


# ====================================================================
# STAGE 2: Minimalist Production Runtime
# ====================================================================
FROM node:22-alpine AS runner

WORKDIR /usr/src/app

# Set production optimization flags
ENV NODE_ENV=production
ENV PORT=8080

# Copy only the lean production node_modules from the builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy the minimum runtime source files from the root context
COPY --from=builder /usr/src/app/package.json ./package.json
COPY --from=builder /usr/src/app/*.ts ./
COPY --from=builder /usr/src/app/tsconfig.json ./tsconfig.json

# Expose the network port your WebSocket server binds to
EXPOSE 8080

# Boot the application using the ultra-fast tsx engine
CMD ["npx", "tsx", "server.ts"]