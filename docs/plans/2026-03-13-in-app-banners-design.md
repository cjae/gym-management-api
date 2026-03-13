# In-App Banners Design

## Overview

Admin-managed promotional banners displayed as a carousel in the mobile app. Admins create, schedule, and track banners from the admin dashboard; the mobile app fetches and displays active banners with analytics tracking.

## Requirements

- Rich promotional content: title, body, hero image, optional discount code
- Flexible CTA: none (informational), deep link (in-app screen), or external URL
- Carousel display: multiple banners auto-rotate, ordered by `displayOrder`
- Global targeting: all authenticated users see the same banners
- Scheduling with manual override: start/end dates + `isPublished` toggle
- Soft delete: `deletedAt` field, filtered from all queries
- Detailed analytics: total + unique impressions and taps, tap-through rate

## Data Model

### Banner

| Field         | Type             | Notes                                          |
|---------------|------------------|-------------------------------------------------|
| id            | UUID             | Primary key                                     |
| title         | String           | Admin-facing name + displayed on banner         |
| body          | String?          | Short promotional text (optional)               |
| imageUrl      | String           | Hero image (uploaded via Cloudinary)             |
| ctaType       | BannerCtaType    | `NONE`, `DEEP_LINK`, `EXTERNAL_URL`             |
| ctaTarget     | String?          | Deep link path or URL (null when `NONE`)        |
| ctaLabel      | String?          | Button text like "Book Now", "View Plans"       |
| discountCode  | String?          | Optional promo code to display                  |
| displayOrder  | Int              | Controls carousel position (lower = first)      |
| isPublished   | Boolean          | Manual override — admin can unpublish anytime   |
| startDate     | DateTime         | When banner becomes visible                     |
| endDate       | DateTime         | When banner auto-expires                        |
| deletedAt     | DateTime?        | Soft delete (null = active)                     |
| createdBy     | String (FK→User) | Admin who created it                            |
| createdAt     | DateTime         |                                                 |
| updatedAt     | DateTime         |                                                 |

### BannerInteraction

| Field     | Type                    | Notes                              |
|-----------|-------------------------|------------------------------------|
| id        | UUID                    | Primary key                        |
| bannerId  | FK→Banner               |                                    |
| userId    | FK→User                 |                                    |
| type      | BannerInteractionType   | `IMPRESSION`, `TAP`                |
| createdAt | DateTime                |                                    |

No unique constraint — every impression/tap is recorded. Unique counts aggregated at query time.

## API Endpoints

### Admin (ADMIN / SUPER_ADMIN)

| Method   | Path                       | Description                                                    |
|----------|----------------------------|----------------------------------------------------------------|
| POST     | /banners                   | Create a new banner                                            |
| GET      | /banners                   | List all banners (paginated, includes lightweight analytics)   |
| GET      | /banners/:id               | Get single banner with analytics summary                       |
| PATCH    | /banners/:id               | Update banner (content, schedule, publish/unpublish)           |
| DELETE   | /banners/:id               | Soft delete the banner                                         |
| GET      | /banners/:id/analytics     | Detailed analytics                                             |

### Mobile (any authenticated user)

| Method   | Path                       | Description                                                    |
|----------|----------------------------|----------------------------------------------------------------|
| GET      | /banners/active            | Active banners for carousel (isPublished + within date range)  |
| POST     | /banners/:id/interactions  | Log an impression or tap                                       |

### Active banner query logic

A banner is "active" when all three conditions are true:
- `isPublished = true`
- `startDate <= now`
- `endDate > now`
- `deletedAt IS NULL`

Results ordered by `displayOrder ASC`, hard-capped at 10 banners.

### Analytics response shape

```json
{
  "bannerId": "uuid",
  "title": "Summer Promo",
  "period": { "startDate": "...", "endDate": "..." },
  "impressions": { "total": 1250, "unique": 340 },
  "taps": { "total": 87, "unique": 62 },
  "tapThroughRate": 18.24
}
```

- Total = every recorded interaction
- Unique = distinct users
- Tap-through rate = (unique taps / unique impressions) * 100

The admin list endpoint includes a lightweight summary (total impressions + taps) per banner.

## Module Structure

```
src/banners/
├── banners.module.ts
├── banners.controller.ts
├── banners.service.ts
├── banners.service.spec.ts
├── dto/
│   ├── create-banner.dto.ts
│   ├── update-banner.dto.ts
│   ├── banner-response.dto.ts
│   ├── banner-analytics-response.dto.ts
│   └── create-banner-interaction.dto.ts
```

## Patterns

- Controller → Service → PrismaService (no repository layer)
- `JwtAuthGuard` + `RolesGuard` on admin endpoints
- `JwtAuthGuard` only on mobile endpoints
- `@CurrentUser()` decorator for interaction tracking
- Swagger decorators on all endpoints
- `PaginationQueryDto` for admin list
- Image upload via existing `/uploads` module — admin uploads image first, passes `imageUrl`
- No cron needed — active query filters by date at query time

## Approach

Standalone `banners/` module (Approach A). Banners are conceptually distinct from notifications — they're visual, promotional, carousel-based with analytics. Keeping them separate avoids muddying the notification model.
