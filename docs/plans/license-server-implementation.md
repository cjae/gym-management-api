# License Server Implementation Plan

Simple Node.js + Express + MongoDB backend that serves as the control plane for gym license validation and feature gating.

## Overview

The gym management API phones home daily to validate its license. This server stores license data in MongoDB, responds to validation requests, and controls which features each gym instance can access based on their tier.

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express
- **Database**: MongoDB (Mongoose ODM)
- **Auth**: API key for admin endpoints, license key header for validation

## Feature Gating

Each license tier includes a set of enabled features. The license server returns the feature list in the validate response, and the gym API caches and enforces it.

### Feature Keys

These map to modules/capabilities in the gym API:

| Feature Key | Description | Starter | Growth | Professional | Enterprise |
|---|---|---|---|---|---|
| `referrals` | Member referral system | - | Y | Y | Y |
| `discount-codes` | Promotional discount codes | - | Y | Y | Y |
| `gym-classes` | Class scheduling & enrollment | - | Y | Y | Y |
| `events` | One-off gym events | - | Y | Y | Y |
| `analytics` | Dashboard stats & trends | Basic | Y | Y | Y |
| `notifications` | In-app + push notifications | - | - | Y | Y |
| `banners` | In-app promotional banners | - | - | Y | Y |
| `multi-entrance` | Multiple gym entrances | - | - | Y | Y |
| `duo-subscriptions` | Shared duo subscriptions | - | - | Y | Y |
| `attendance-streaks` | Streak system & leaderboard | - | - | Y | Y |
| `salary` | Staff payroll management | - | - | - | Y |
| `audit-logs` | Admin action audit trail | - | - | - | Y |
| `custom-branding` | White-label / custom branding | - | - | - | Y |

> These are suggestions — adjust per business needs. The system is flexible: features are just string keys, so new ones can be added anytime without schema changes.

### How It Works

1. **License server** stores a `features` array on each license (list of enabled feature keys)
2. **Tier collection** defines default feature sets per tier — when creating a license, features auto-populate from the tier defaults (but can be overridden per license)
3. **Validate response** includes the `features` array
4. **Gym API** caches features in `LicenseCache` and exposes a `hasFeature(key)` method
5. **Gym API guard/decorator** blocks requests to gated endpoints when the feature isn't enabled

## Endpoint: `POST /api/v1/licenses/validate`

This is the only endpoint the gym API calls. Everything else is admin tooling.

**Request Headers:**
```
X-License-Key: <license-key-string>
```

**Request Body:**
```json
{
  "currentMemberCount": 45,
  "appVersion": "1.0.0"
}
```

**Response (200 OK):**
```json
{
  "status": "ACTIVE",
  "gymName": "FitLife Nairobi",
  "tierName": "Growth",
  "maxMembers": 100,
  "expiresAt": "2027-01-15T00:00:00.000Z",
  "features": ["referrals", "discount-codes", "gym-classes", "events", "analytics"]
}
```

**Error Responses:**
- `401 Unauthorized` — license key not found or invalid (gym API treats this as SUSPENDED)
- `403 Forbidden` — license explicitly suspended (gym API treats this as SUSPENDED)

**Validation Logic:**
1. Look up license by `licenseKey` in MongoDB
2. If not found → 401
3. If found but `status === "SUSPENDED"` → 403 with `{ status: "SUSPENDED" }`
4. If found but `expiresAt < now` → 200 with `{ status: "EXPIRED", ...rest }`
5. If found and valid → 200 with `{ status: "ACTIVE", ...rest, features }`
6. Update `lastValidatedAt` and `lastMemberCount` on the license document

## MongoDB Schemas

### `Tier` Collection

Defines the default feature set and limits for each pricing tier. Used as a template when creating licenses.

```typescript
{
  name: string,              // Unique. e.g., "Starter", "Growth", "Professional", "Enterprise"
  displayName: string,       // Human-friendly name
  maxMembers: number | null, // null = unlimited
  features: string[],        // Default feature keys for this tier
  sortOrder: number,         // For ordering in admin UI (0 = lowest tier)
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:**
- `name`: unique index

### `License` Collection

```typescript
{
  licenseKey: string,        // Unique, indexed. The key the gym instance sends.
  gymName: string,           // Human-readable gym name
  status: "ACTIVE" | "SUSPENDED" | "EXPIRED",  // Manual override status
  tier: ObjectId,            // Reference to Tier collection
  tierName: string,          // Denormalized tier name (for fast responses without populate)
  maxMembers: number | null, // Override from tier default, null = unlimited
  features: string[],        // Active feature keys — initialized from tier defaults, can be overridden per license
  expiresAt: Date,           // License expiration date
  ownerEmail: string,        // Gym owner contact email
  ownerName: string,         // Gym owner name
  lastValidatedAt: Date | null,
  lastMemberCount: number | null,
  lastAppVersion: string | null,
  notes: string | null,      // Internal admin notes
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:**
- `licenseKey`: unique index
- `status`: regular index
- `expiresAt`: regular index

**On create:** If `features` is not provided, copy from the referenced Tier's `features` array. Same for `maxMembers`. This lets you override per-license (e.g., give one gym an extra feature without upgrading their whole tier).

### `ValidationLog` Collection (Optional, nice to have)

Logs every validation call for audit/analytics.

```typescript
{
  licenseKey: string,
  memberCount: number,
  appVersion: string,
  responseStatus: string,    // ACTIVE, EXPIRED, SUSPENDED
  ipAddress: string,
  timestamp: Date
}
```

**Index:** `{ licenseKey: 1, timestamp: -1 }` (compound)

Set a TTL index on `timestamp` to auto-delete after 90 days:
```typescript
ValidationLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
```

## Admin Endpoints

Protected by `X-Admin-Key` header (static API key from env var `ADMIN_API_KEY`).

### Licenses

#### `POST /api/v1/licenses`
Create a new license. Auto-generate `licenseKey` (UUID v4 or nanoid). Requires a `tier` reference. If `features` or `maxMembers` not provided, inherit from the tier.

#### `GET /api/v1/licenses`
List all licenses. Support query filters: `?status=ACTIVE&search=fitlife&tierName=Growth`

#### `GET /api/v1/licenses/:id`
Get a single license by MongoDB `_id`. Populate tier details.

#### `PATCH /api/v1/licenses/:id`
Update license fields. Supports:
- Standard fields: `gymName`, `expiresAt`, `status`, `ownerEmail`, `ownerName`, `notes`
- Tier change: `tier` (updates tierName, optionally resets features/maxMembers to new tier defaults)
- Feature overrides: `features` (set the full array), `addFeatures` (append to existing), `removeFeatures` (remove from existing)
- `maxMembers` override

#### `DELETE /api/v1/licenses/:id`
Soft-delete by setting status to SUSPENDED.

#### `GET /api/v1/licenses/:id/logs`
Get recent validation logs for a specific license. Paginated.

### Tiers

#### `POST /api/v1/tiers`
Create a new tier with name, maxMembers, features, sortOrder.

#### `GET /api/v1/tiers`
List all tiers, sorted by `sortOrder`.

#### `GET /api/v1/tiers/:id`
Get a single tier.

#### `PATCH /api/v1/tiers/:id`
Update tier fields. **Does not retroactively update existing licenses** — tier changes only apply to new licenses. To bulk-update, use a dedicated endpoint or script.

#### `DELETE /api/v1/tiers/:id`
Delete a tier. Reject if any licenses reference it.

### Stats

#### `GET /api/v1/stats`
Dashboard stats: total licenses, active/expired/suspended counts, total members across all gyms, licenses per tier.

## Project Structure

```
license-server/
├── src/
│   ├── index.ts              # Entry point, Express app setup
│   ├── config.ts             # Env var loading (PORT, MONGODB_URI, ADMIN_API_KEY)
│   ├── middleware/
│   │   └── admin-auth.ts     # X-Admin-Key middleware
│   ├── models/
│   │   ├── license.model.ts
│   │   ├── tier.model.ts
│   │   └── validation-log.model.ts
│   ├── routes/
│   │   ├── validate.routes.ts   # POST /api/v1/licenses/validate
│   │   ├── license.routes.ts    # Admin license CRUD
│   │   └── tier.routes.ts       # Admin tier CRUD
│   ├── services/
│   │   ├── license.service.ts
│   │   ├── tier.service.ts
│   │   └── validation-log.service.ts
│   └── utils/
│       └── generate-key.ts      # License key generation
├── seed.ts                      # Seed tiers + test license
├── .env.example
├── package.json
├── tsconfig.json
└── Dockerfile
```

## Environment Variables

```env
PORT=4000
MONGODB_URI=mongodb://localhost:27017/license-server
ADMIN_API_KEY=your-secret-admin-key
NODE_ENV=development
```

## Key Implementation Notes

1. **License key generation**: Use `nanoid` or `crypto.randomUUID()`. Format doesn't matter — the gym API treats it as an opaque string.

2. **The gym API sends the license key in the `X-License-Key` header**, not in the body. Make sure the validate endpoint reads from headers.

3. **Status logic**: The `status` field on the License document is a manual override. Even if `expiresAt` hasn't passed, an admin can set `status: "SUSPENDED"` to immediately block a gym. The validate endpoint should check both:
   - If `status === "SUSPENDED"` → return 403 regardless of expiry
   - If `expiresAt < now` → return `status: "EXPIRED"` in the response body (200 OK, not an error code)
   - Otherwise → return `status: "ACTIVE"`

4. **The response shape must match exactly** what the gym API expects:
   ```typescript
   {
     status: "ACTIVE" | "SUSPENDED" | "EXPIRED",
     gymName?: string,
     tierName?: string,
     maxMembers?: number,
     expiresAt?: string,   // ISO 8601
     features?: string[]   // NEW — list of enabled feature keys
   }
   ```

5. **Features in response**: Always include the `features` array in the validate response, even for EXPIRED status (the gym API caches it). For SUSPENDED (403 response), features are irrelevant since the gym API blocks everything.

6. **CORS**: Not needed — the gym API calls this server-to-server, not from a browser.

7. **Rate limiting**: Not critical for MVP since only gym servers call this, but a basic rate limit (100 req/min) on the validate endpoint is good practice.

8. **No auth on validate endpoint** — the license key itself serves as authentication. If the key doesn't exist, return 401.

9. **Feature overrides**: The `features` array on a License can diverge from its Tier's defaults. This allows granting/revoking individual features per gym without changing their tier. When updating a license's tier, prompt whether to reset features to the new tier's defaults or keep existing overrides.

## Seed Data

The seed script should create default tiers and a test license:

```typescript
// Tiers
const tiers = [
  {
    name: "starter",
    displayName: "Starter",
    maxMembers: 50,
    features: [],
    sortOrder: 0,
  },
  {
    name: "growth",
    displayName: "Growth",
    maxMembers: 200,
    features: ["referrals", "discount-codes", "gym-classes", "events", "analytics"],
    sortOrder: 1,
  },
  {
    name: "professional",
    displayName: "Professional",
    maxMembers: 500,
    features: [
      "referrals", "discount-codes", "gym-classes", "events", "analytics",
      "notifications", "banners", "multi-entrance",
      "duo-subscriptions", "attendance-streaks"
    ],
    sortOrder: 2,
  },
  {
    name: "enterprise",
    displayName: "Enterprise",
    maxMembers: null,  // unlimited
    features: [
      "referrals", "discount-codes", "gym-classes", "events", "analytics",
      "notifications", "banners", "multi-entrance",
      "duo-subscriptions", "attendance-streaks", "salary", "audit-logs",
      "custom-branding"
    ],
    sortOrder: 3,
  },
];

// Test license (references "growth" tier)
{
  licenseKey: "test-license-key-001",
  gymName: "FitLife Dev",
  status: "ACTIVE",
  tier: growthTierId,
  tierName: "Growth",
  maxMembers: 200,
  features: ["referrals", "discount-codes", "gym-classes", "events", "analytics"],
  expiresAt: new Date("2027-12-31"),
  ownerEmail: "dev@example.com",
  ownerName: "Dev User"
}
```

Then set these env vars in the gym API's `.env`:
```
LICENSE_KEY=test-license-key-001
LICENSE_SERVER_URL=http://localhost:4000
```

## Changes Required in Gym API (Separate Task)

After the license server is built, the gym API needs these updates:

### 1. Update `LicenseResponseDto`
Add `features` field:
```typescript
export class LicenseResponseDto {
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  gymName?: string;
  tierName?: string;
  maxMembers?: number;
  expiresAt?: string;
  features?: string[];  // NEW
}
```

### 2. Update Prisma `LicenseCache` model
Add a `features` JSON field to cache the feature list:
```prisma
model LicenseCache {
  // ... existing fields ...
  features  Json?    // String array stored as JSON
}
```

### 3. Update `LicensingService`
- Cache `features` from the validate response
- Add `hasFeature(key: string): Promise<boolean>` method
- Add `getFeatures(): Promise<string[]>` method
- In dev mode (unconfigured), `hasFeature()` returns `true` for all features

### 4. Add `@RequiresFeature()` decorator
Custom decorator that sets metadata on a controller or handler:
```typescript
// Usage on a controller
@RequiresFeature('referrals')
@Controller('referrals')
export class ReferralsController { ... }

// Usage on a specific endpoint
@RequiresFeature('salary')
@Post()
createSalary() { ... }
```

### 5. Add `FeatureGuard`
A global guard (like `LicenseGuard`) that:
1. Reads `@RequiresFeature` metadata from the handler/controller
2. If no feature required → allow
3. Calls `licensingService.hasFeature(key)`
4. If feature not enabled → throw `ForbiddenException('This feature is not available on your current plan. Contact your administrator to upgrade.')`

### 6. Apply `@RequiresFeature` to gated modules
Add the decorator to controllers of gated modules (referrals, discount-codes, gym-classes, events, etc.)

## Deployment

Dockerize with a simple Dockerfile. Deploy anywhere that runs Node.js + has MongoDB access (Railway, Render, Fly.io, or a VPS with MongoDB Atlas).

## Future Enhancements (Not MVP)

- Web dashboard for managing licenses (React admin panel)
- Stripe integration for license billing
- Email notifications for expiring licenses
- Webhook notifications when a gym goes over member limits
- License usage analytics and reporting
- Feature usage tracking (which features each gym actually uses)
