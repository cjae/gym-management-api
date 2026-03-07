# Swagger Docs + Sentry Integration Design

**Date:** 2026-03-07

## Swagger Docs

### Approach
Use `@nestjs/swagger` with the CLI plugin for automatic DTO/controller introspection. Manual decorators only for auth, tags, and error responses.

### Setup
- Install `@nestjs/swagger`
- Enable CLI plugin in `nest-cli.json` to auto-generate schemas from DTOs and controller return types
- `SwaggerModule.setup('api/docs', ...)` in `main.ts` — docs at `/api/docs`
- `DocumentBuilder` with `.addBearerAuth()` for JWT auth in Swagger UI

### Per-controller decoration
- `@ApiTags('Module Name')` — groups endpoints in sidebar
- `@ApiBearerAuth()` — on protected controllers
- `@ApiResponse()` — only for non-200 error responses (401, 403, 404, 409)

### What the CLI plugin handles automatically
- DTO property types, optionality, and validation constraints from `class-validator`
- Controller return types for success responses
- `@Query()` parameters

## Sentry Integration

### Approach
Use `@sentry/nestjs` (official SDK) with errors + performance tracing.

### Setup
- Install `@sentry/nestjs` and `@sentry/profiling-node`
- Create `src/instrument.ts` — initialized before app via `--import` flag in start scripts
- `Sentry.init()` with DSN, `tracesSampleRate`, `profilesSampleRate`

### Integration points
- **`src/instrument.ts`** — Top-level init, auto-instruments Prisma and HTTP
- **`app.module.ts`** — Import `SentryModule.forRoot()`
- **`main.ts`** — Add `SentryGlobalFilter` as global exception filter
- **User context** — Interceptor/middleware calls `Sentry.setUser()` with JWT user (id, email, role)

### Auto-traced
- HTTP requests (transactions with route names)
- Prisma queries (spans)
- Outbound HTTP to Paystack (spans)
- Unhandled exceptions (error events with stack trace + request context)

### Environment variables
- `SENTRY_DSN` — Project DSN
- `SENTRY_ENVIRONMENT` — Optional, defaults to `development`

### Out of scope
- Custom breadcrumbs (auto-instrumentation sufficient)
- Source maps upload (add later for prod)
- Tunnel/proxy (direct DSN for MVP)
