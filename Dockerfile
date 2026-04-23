# --- Build stage ---
FROM node:22.22.2-alpine AS builder

WORKDIR /app

# Install dependencies (includes devDeps for build)
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Generate Prisma client (dummy URL — generate never connects to DB)
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

# Build application
COPY . .
RUN yarn build

# --- Production stage ---
FROM node:22.22.2-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

# Copy Prisma schema and config for runtime migrations
COPY prisma ./prisma
COPY prisma.config.ts ./
# Generate Prisma client (dummy URL — generate never connects to DB)
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

# Copy built application (includes compiled prisma.config.js)
COPY --from=builder /app/dist ./dist

# Copy email templates (Handlebars)
COPY src/email/templates ./dist/src/email/templates

EXPOSE 3000

# Run migrations then start.
# If DATABASE_CA_CERT is set (base64-encoded PEM), decode it so Prisma's Rust
# engine can verify the managed-database TLS certificate chain.
CMD ["sh", "-c", "if [ -n \"$DATABASE_CA_CERT\" ]; then echo \"$DATABASE_CA_CERT\" | base64 -d > /tmp/db-ca.pem; fi && npx prisma migrate deploy && node dist/src/main"]
