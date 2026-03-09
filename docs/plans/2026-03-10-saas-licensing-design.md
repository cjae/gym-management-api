# SaaS Licensing & Remote Disable — Design

## Overview

Transform the gym management API into a white-label SaaS product. Each gym gets its own deployment (server + database). A central control plane (built separately) manages gym licenses. Each gym instance phones home daily to validate its license. Non-paying gyms can be remotely disabled.

## Key Decisions

| Decision | Choice |
|---|---|
| Deployment model | Separate deployment per gym (own server + DB) |
| Kill switch mechanism | License key phone-home |
| Unreachable server behavior | 7-day grace period |
| Control plane scope | Client-side only in this codebase; control plane is a separate project |
| SaaS pricing model | Tiered plans (configured per gym in control plane) |
| Lockout behavior | Full lockout — 503 on all endpoints |
| Phone-home frequency | Every 24 hours (3 AM daily cron) |
| Dev mode | No enforcement when `LICENSE_KEY` is unset |

## Database Schema

```prisma
enum LicenseStatus {
  ACTIVE
  SUSPENDED
  EXPIRED
}

model LicenseCache {
  id                String        @id @default("singleton")
  licenseKey        String
  status            LicenseStatus @default(ACTIVE)
  gymName           String?
  tierName          String?
  maxMembers        Int?
  expiresAt         DateTime?
  lastCheckedAt     DateTime?
  lastSuccessAt     DateTime?
  rawResponse       Json?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
}
```

- Singleton row (ID hardcoded to `"singleton"`).
- `lastSuccessAt` drives the 7-day grace period calculation.
- `maxMembers` enforced locally when registering new members.

## Module Structure

```
src/licensing/
├── licensing.module.ts          # Module registration
├── licensing.service.ts         # Phone-home logic + cache reads/writes
├── licensing.guard.ts           # Global guard — checks cached license
├── licensing.cron.ts            # Daily cron job to phone home
├── licensing.config.ts          # Config factory (registerAs pattern)
└── dto/
    └── license-response.dto.ts  # Shape of control plane API response
```

## LicenseService

- **`validateLicense()`** — Calls `POST {LICENSE_SERVER_URL}/api/v1/licenses/validate` with `{ licenseKey, currentMemberCount }`. Updates the `LicenseCache` row.
- **`getCachedLicense()`** — Reads the singleton row from DB. Returns status + whether grace period is exceeded.
- **`isActive()`** — Returns `true` if license is ACTIVE, or if SUSPENDED/EXPIRED but within the 7-day grace window from `lastSuccessAt`. Returns `true` when `lastSuccessAt` is null (dev mode / never validated).
- **`onModuleInit()`** — Validates license on app startup. No-op when `LICENSE_KEY` is unset.

## LicenseGuard

- Global guard registered via `APP_GUARD` in `AppModule`, ordered before `ThrottlerGuard`.
- Calls `licenseService.isActive()`.
- If inactive: throws `ServiceUnavailableException` — `"This gym's subscription is inactive. Contact your administrator."`
- Skips check for `GET /api/health`.

## LicenseCron

- Runs daily at 3 AM via `@Cron('0 3 * * *')`.
- Calls `licenseService.validateLicense()`.

## Phone-Home Protocol

### Request (gym → control plane)

```
POST {LICENSE_SERVER_URL}/api/v1/licenses/validate
Headers: X-License-Key: {LICENSE_KEY}
Body: {
  "currentMemberCount": 47,
  "appVersion": "1.0.0"
}
```

### Response (control plane → gym)

```json
{
  "status": "ACTIVE",
  "gymName": "FitZone Nairobi",
  "tierName": "Growth",
  "maxMembers": 100,
  "expiresAt": "2026-04-10T00:00:00Z"
}
```

### Error Handling

| Response | Action |
|---|---|
| 2xx | Update `LicenseCache` with new status, set `lastSuccessAt = now()`, set `lastCheckedAt = now()` |
| 401/403 | License revoked. Set status to `SUSPENDED`, update `lastCheckedAt` only |
| Network error / 5xx | Control plane down. Don't change cached status, update `lastCheckedAt` only. Grace period counts from `lastSuccessAt` |

### Grace Period Logic

```
isActive():
  if cachedStatus == ACTIVE → true
  if cachedStatus == SUSPENDED or EXPIRED:
    if (now - lastSuccessAt) <= 7 days → true (grace)
    else → false (locked out)
  if lastSuccessAt is null → true (dev mode)
```

## Member Limit Enforcement

When `maxMembers` is set in the cached license and a new user with role `MEMBER` is created, `UsersService` checks the current member count against `maxMembers`. Rejects with 403: `"Member limit reached for your subscription tier."`

## Integration with Existing Code

### Files modified

1. **`app.module.ts`** — Import `LicensingModule`, register `LicenseGuard` as global `APP_GUARD` before `ThrottlerGuard`.
2. **`prisma/schema.prisma`** — Add `LicenseCache` model and `LicenseStatus` enum.
3. **`src/users/users.service.ts`** — Add member count check against `maxMembers` in create-user flow.
4. **`src/common/config/`** — Add `licensing.config.ts`.
5. **`src/common/loaders/config.loader.module.ts`** — Register licensing config.
6. **`src/app.controller.ts`** — Add `GET /api/health` endpoint.

### Files NOT modified

- Auth module, controllers, other services, existing tests — guard is transparent when license is valid.

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `LICENSE_KEY` | Unique license key per gym instance | No (dev mode when unset) |
| `LICENSE_SERVER_URL` | Control plane base URL | No (dev mode when unset) |
