# --- Build stage ---
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (includes devDeps for build)
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Generate Prisma client
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# Build application
COPY . .
RUN yarn build

# --- Production stage ---
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

# Copy Prisma schema, config, and generate client for production
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# Copy built application (includes compiled prisma.config.js)
COPY --from=builder /app/dist ./dist

# Copy email templates (Handlebars)
COPY src/email/templates ./dist/src/email/templates

EXPOSE 3000

# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
