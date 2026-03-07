# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NestJS 11 API for a gym management platform targeting the Kenyan market. Uses Prisma 6 ORM with PostgreSQL, JWT auth (Passport), and Paystack for payments (KES/M-Pesa).

## Commands

```bash
yarn start:dev          # Dev server with watch (port 3000)
yarn test               # Run all unit tests (Jest)
yarn test -- --testPathPattern=auth  # Run tests for a specific module
yarn lint               # ESLint with auto-fix
yarn build              # Production build to dist/

# Database
npx prisma migrate dev  # Create/apply migrations
npx prisma generate     # Regenerate Prisma client after schema changes
npx prisma db seed      # Seed dev data (all users use password: password123)
```

## Architecture

**Framework**: NestJS with global prefix `/api`, URI versioning (default `v1` — endpoints are `/api/v1/...`), global `ValidationPipe` (whitelist + transform), CORS for `ADMIN_URL`. Webhooks are version-neutral (`/api/payments/webhook`).

**Modules** (all in `src/`):
- `prisma/` — Global PrismaService, injected everywhere
- `auth/` — JWT strategy (15m access tokens), login/register/forgot-password/reset-password/change-password endpoints
- `users/` — CRUD with role-based access
- `subscription-plans/` — Plan definitions (price in KES, duration, max members)
- `subscriptions/` — Member subscriptions with duo support (2 members share 1 subscription via `SubscriptionMember` join table)
- `payments/` — Paystack integration with webhook verification
- `attendance/` — QR-based check-in, idempotent per member per day (`@@unique([memberId, checkInDate])`)
- `qr/` — GymQrCode generation and validation
- `trainers/` — Profiles, schedules, member assignments
- `legal/` — Documents with digital signature capture
- `salary/` — Staff payroll, SUPER_ADMIN only
- `email/` — Global EmailService using Mailgun + Handlebars templates (partials: header, footer, button). Logs emails when Mailgun is not configured.
- `billing/` — Daily cron job for recurring subscription billing. Auto-charges card users via Paystack authorization codes, sends email reminders to M-Pesa users. Expires overdue subscriptions.
- `common/config/` — Typed config factories (app, auth, mail, payment, sentry)
- `common/loaders/` — `ConfigLoaderModule` that loads all configs globally

**Auth pattern**: `JwtAuthGuard` + `RolesGuard` applied per-controller. Use `@Roles('ADMIN', 'SUPER_ADMIN')` decorator to restrict. Use `@CurrentUser()` param decorator to get the authenticated user. Public endpoints (login, register, forgot-password, reset-password) are protected with `BasicAuthGuard` (HTTP Basic Auth via `passport-http`) — credentials from `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD` env vars. Webhooks are excluded from Basic Auth. Password reset uses `PasswordResetToken` table with 1-hour expiry. Logout invalidates JWT via `InvalidatedToken` table (JTI-based blocklist checked in `JwtStrategy.validate`).

**Roles hierarchy**: `SUPER_ADMIN > ADMIN > TRAINER > MEMBER`. The guards check exact role match (not hierarchical).

**Database**: Schema in `prisma/schema.prisma`. All IDs are UUIDs. Currency defaults to KES. Timestamps use `@default(now())` / `@updatedAt`.

**Module pattern**: Each module follows controller → service → Prisma. Services inject `PrismaService` directly. No repository layer.

**Recurring Billing**: Self-managed billing cycle via daily cron (`@nestjs/schedule`). Card users are auto-charged via Paystack saved authorization codes. M-Pesa users receive email reminders and pay manually. `Payment` table tracks every charge attempt. See `docs/plans/2026-03-07-recurring-billing-design.md`.

**Configuration**: Uses `@nestjs/config` with typed config factories in `src/common/config/` (`registerAs()` pattern). `ConfigLoaderModule` in `src/common/loaders/config.loader.module.ts` loads all configs globally with caching. Services inject `ConfigService` and read typed configs via `configService.get<AppConfig>(getAppConfigName())`. Never use `process.env` directly in services — add a config file instead.

## API Documentation

Swagger UI at `/api/docs`. Uses `@nestjs/swagger` CLI plugin (configured in `nest-cli.json`) for automatic DTO introspection. Controllers use `@ApiTags`, `@ApiBearerAuth`, and `@ApiResponse` decorators for grouping, auth, and error docs.

## Error Tracking

Sentry via `@sentry/nestjs`. `src/instrument.ts` must be imported first in `main.ts`. `SentryModule.forRoot()` in `app.module.ts`. `SentryGlobalFilter` catches all unhandled exceptions. `SentryUserInterceptor` tags errors with JWT user context (id, email, role). No-op when `SENTRY_DSN` is unset.

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Falls back to `'dev-secret'` if unset
- `JWT_REFRESH_SECRET` — Separate secret for refresh tokens (falls back to `'dev-refresh-secret'`)
- `PAYSTACK_SECRET_KEY` — **Required** — app throws at startup if missing
- `ENCRYPTION_KEY` — 32-byte hex key for encrypting Paystack auth codes at rest (optional, no encryption when unset)
- `ADMIN_URL` — CORS origin (defaults to `http://localhost:3001`)
- `PORT` — Server port (defaults to 3000)
- `SENTRY_DSN` — Sentry project DSN (optional in dev, required in prod)
- `SENTRY_ENVIRONMENT` — Defaults to `development`
- `BASIC_AUTH_USER` — Username for Basic Auth on public endpoints (login/register)
- `BASIC_AUTH_PASSWORD` — Password for Basic Auth on public endpoints
- `MAILGUN_API_KEY` — Mailgun API key (emails logged to console when unset)
- `MAILGUN_DOMAIN` — Mailgun sending domain
- `MAIL_FROM` — Sender address (defaults to `noreply@{MAILGUN_DOMAIN}`)

## Security

- **Rate limiting**: Global `@nestjs/throttler` (30 req/min), tighter on auth endpoints (login 10/min, register 5/min, forgot-password 3/min)
- **Security headers**: `helmet` middleware (HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
- **Webhook verification**: HMAC SHA-512 against raw request body (`rawBody: true` in NestFactory). Idempotency via `@unique` on `Payment.paystackReference`.
- **IDOR protection**: Payment initialization validates subscription ownership (`primaryMemberId === userId`)
- **Data exposure prevention**: `paystackAuthorizationCode` stripped from subscription responses, `safeUserSelect` used in trainer queries (no password hash leaks)
- **Role escalation prevention**: `role` field removed from `UpdateUserDto` — role changes require direct DB access
- **JWT**: Algorithm pinned to `HS256`, 15m access tokens, separate refresh secret (`JWT_REFRESH_SECRET`), JTI-based blocklist on logout
- **Input bounds**: All string DTO fields have `@MaxLength` constraints
- **Body size limits**: 1mb limit on JSON and URL-encoded request bodies
- **Password reset tokens**: SHA-256 hashed before storing in DB (raw token sent via email)
- **Encryption at rest**: `paystackAuthorizationCode` encrypted with AES-256-GCM when `ENCRYPTION_KEY` is set
- **Pagination**: All `findAll` endpoints paginated via `PaginationQueryDto` (default 20, max 100 per page)

## Testing

Unit tests live alongside source files as `*.spec.ts`. Tests mock `PrismaService` using Jest. 12 spec files, 64 tests total.
