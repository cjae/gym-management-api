# Control Plane — Design

## Overview

A centralized service you own and operate that manages gym licenses, tiers, and billing status. Each gym deployment phones home to this service daily. You use the admin dashboard to onboard gyms, assign tiers, and suspend non-paying gyms.

Separate repo at `~/Documents/js/gym-control-plane`.

## Key Decisions

| Decision | Choice |
|---|---|
| Tech stack | NestJS + Prisma + PostgreSQL (API), Next.js (dashboard) |
| Repo structure | Single repo, two packages: `api/` and `dashboard/` |
| Billing model | Manual for MVP (toggle gym status by hand, automate later) |
| License keys | Random UUIDs, auto-generated on gym creation |
| Auth | Admin JWT auth for dashboard; license key header for phone-home |
| Dashboard | Simple Next.js app with 5 pages |

## Database Schema

```prisma
enum GymStatus {
  ACTIVE
  SUSPENDED
  EXPIRED
}

model Tier {
  id          String   @id @default(uuid())
  name        String   @unique
  maxMembers  Int
  priceKes    Float
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  gyms Gym[]
}

model Gym {
  id            String    @id @default(uuid())
  name          String
  licenseKey    String    @unique @default(uuid())
  status        GymStatus @default(ACTIVE)
  tierId        String
  ownerName     String
  ownerEmail    String
  ownerPhone    String?
  expiresAt     DateTime?
  notes         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  tier          Tier      @relation(fields: [tierId], references: [id])
  healthChecks  HealthCheck[]
}

model HealthCheck {
  id               String   @id @default(uuid())
  gymId            String
  memberCount      Int
  appVersion       String?
  ipAddress        String?
  checkedAt        DateTime @default(now())

  gym Gym @relation(fields: [gymId], references: [id])
}

model AdminUser {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- **Gym** — One record per gym deployment. `licenseKey` auto-generated as UUID.
- **Tier** — Defines pricing and member limits. Gyms reference a tier.
- **HealthCheck** — Logs every phone-home call for visibility into gym activity.
- **AdminUser** — Your login for the dashboard. Simple email+password.

## API Endpoints

### Public (no auth — called by gym instances)

- `POST /api/v1/licenses/validate` — Phone-home endpoint. Looks up gym by `X-License-Key`, logs health check, returns status/tier info. Returns 403 if key invalid or gym suspended/expired.

### Admin (JWT auth — dashboard)

**Gyms:**
- `GET /api/v1/gyms` — List all gyms with tier, status, last health check, member count
- `GET /api/v1/gyms/:id` — Gym detail with recent health check history
- `POST /api/v1/gyms` — Create gym (auto-generates license key)
- `PATCH /api/v1/gyms/:id` — Update gym (name, tier, owner info, notes)
- `PATCH /api/v1/gyms/:id/status` — Enable/disable a gym
- `POST /api/v1/gyms/:id/regenerate-key` — Regenerate license key

**Tiers:**
- `GET /api/v1/tiers` — List all tiers
- `POST /api/v1/tiers` — Create tier
- `PATCH /api/v1/tiers/:id` — Update tier

**Auth:**
- `POST /api/v1/auth/login` — Login, returns JWT
- `GET /api/v1/auth/me` — Current admin profile

**Dashboard:**
- `GET /api/v1/dashboard` — Aggregate stats: total gyms, active/suspended count, total members, gyms not checked in 7+ days

## Phone-Home Endpoint Logic

```
POST /api/v1/licenses/validate
Header: X-License-Key: <uuid>
Body: { currentMemberCount: 47, appVersion: "1.0.0" }
```

1. Look up `Gym` by `licenseKey` (include `Tier`)
2. If not found → return 403
3. Log a `HealthCheck` record (gymId, memberCount, appVersion, IP address)
4. If gym status is SUSPENDED or EXPIRED → return 403
5. If gym status is ACTIVE → return 200:

```json
{
  "status": "ACTIVE",
  "gymName": "FitZone Nairobi",
  "tierName": "Growth",
  "maxMembers": 100,
  "expiresAt": "2026-04-10T00:00:00Z"
}
```

Health checks are logged even for suspended gyms (step 3 before step 4) so you can see they're still running.

## Dashboard Pages

1. **Login** — Email + password form
2. **Dashboard (home)** — Summary cards (total gyms, active/suspended count, total members). Alert list for gyms not checked in 7+ days.
3. **Gyms list** — Table: name, tier, status badge, member count, last check-in. Search/filter by name and status.
4. **Gym detail** — Gym info, owner contact, license key (masked/copyable), tier, status. Actions: Suspend, Activate, Regenerate Key. Health check history (last 30 days).
5. **Tiers** — Simple CRUD table: name, max members, price. Inline edit.

## Project Structure

```
gym-control-plane/
├── api/                          # NestJS backend
│   ├── src/
│   │   ├── prisma/               # PrismaService (global)
│   │   ├── auth/                 # Admin JWT auth (login, guards)
│   │   ├── gyms/                 # Gym CRUD + status toggle
│   │   ├── tiers/                # Tier CRUD
│   │   ├── licenses/             # Phone-home validate endpoint
│   │   ├── dashboard/            # Aggregate stats endpoint
│   │   └── common/config/        # Typed config factories
│   ├── prisma/
│   │   └── schema.prisma
│   └── package.json
├── dashboard/                    # Next.js frontend
│   ├── src/
│   │   ├── app/                  # App router pages
│   │   │   ├── login/
│   │   │   ├── dashboard/
│   │   │   ├── gyms/
│   │   │   ├── gyms/[id]/
│   │   │   └── tiers/
│   │   ├── components/           # Shared UI components
│   │   └── lib/                  # API client, auth helpers
│   └── package.json
└── README.md
```

Two separate packages in one repo. Each has its own `package.json`, runs independently. No monorepo tooling needed.
