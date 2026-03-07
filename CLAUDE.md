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

**Framework**: NestJS with global prefix `/api`, global `ValidationPipe` (whitelist + transform), CORS for `ADMIN_URL`.

**Modules** (all in `src/`):
- `prisma/` — Global PrismaService, injected everywhere
- `auth/` — JWT strategy (15m access tokens), login/register endpoints
- `users/` — CRUD with role-based access
- `subscription-plans/` — Plan definitions (price in KES, duration, max members)
- `subscriptions/` — Member subscriptions with duo support (2 members share 1 subscription via `SubscriptionMember` join table)
- `payments/` — Paystack integration with webhook verification
- `attendance/` — QR-based check-in, idempotent per member per day (`@@unique([memberId, checkInDate])`)
- `qr/` — GymQrCode generation and validation
- `trainers/` — Profiles, schedules, member assignments
- `legal/` — Documents with digital signature capture
- `salary/` — Staff payroll, SUPER_ADMIN only

**Auth pattern**: `JwtAuthGuard` + `RolesGuard` applied per-controller. Use `@Roles('ADMIN', 'SUPER_ADMIN')` decorator to restrict. Use `@CurrentUser()` param decorator to get the authenticated user.

**Roles hierarchy**: `SUPER_ADMIN > ADMIN > TRAINER > MEMBER`. The guards check exact role match (not hierarchical).

**Database**: Schema in `prisma/schema.prisma`. All IDs are UUIDs. Currency defaults to KES. Timestamps use `@default(now())` / `@updatedAt`.

**Module pattern**: Each module follows controller → service → Prisma. Services inject `PrismaService` directly. No repository layer.

## API Documentation

Swagger UI at `/api/docs`. Uses `@nestjs/swagger` CLI plugin (configured in `nest-cli.json`) for automatic DTO introspection. Controllers use `@ApiTags`, `@ApiBearerAuth`, and `@ApiResponse` decorators for grouping, auth, and error docs.

## Error Tracking

Sentry via `@sentry/nestjs`. `src/instrument.ts` must be imported first in `main.ts`. `SentryModule.forRoot()` in `app.module.ts`. `SentryGlobalFilter` catches all unhandled exceptions. `SentryUserInterceptor` tags errors with JWT user context (id, email, role). No-op when `SENTRY_DSN` is unset.

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Falls back to `'dev-secret'` if unset
- `PAYSTACK_SECRET_KEY` — For payment verification
- `ADMIN_URL` — CORS origin (defaults to `http://localhost:3001`)
- `PORT` — Server port (defaults to 3000)
- `SENTRY_DSN` — Sentry project DSN (optional in dev, required in prod)
- `SENTRY_ENVIRONMENT` — Defaults to `development`

## Testing

Unit tests live alongside source files as `*.spec.ts`. Tests mock `PrismaService` using Jest. 8 spec files, ~39 tests total.
