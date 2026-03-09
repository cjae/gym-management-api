# /me Endpoint & Image Uploads Design

## Problem

Users need a way to view and update their own profile. The User model needs `gender` and `displayPicture` fields. Image uploads should go through the API to keep Cloudinary credentials server-side.

## Schema Changes

New enum:

```prisma
enum Gender {
  MALE
  FEMALE
  NON_BINARY
  PREFER_NOT_TO_SAY
}
```

New optional fields on `User`:

```prisma
gender         Gender?
displayPicture String?
```

Both optional — existing users and new registrations don't require them.

## Endpoints

### `GET /api/v1/auth/me`

Returns the authenticated user's full profile. Any role can access. Uses `safeUserSelect` pattern (excludes password) plus `gender`, `displayPicture`, and `mustChangePassword`.

### `PATCH /api/v1/auth/me`

Self-update for the authenticated user. Updatable fields: `firstName`, `lastName`, `phone`, `gender`, `displayPicture`. No role/email/status changes.

### `POST /api/v1/uploads/image`

Accepts multipart file upload, uploads to Cloudinary, returns `{ url: "https://res.cloudinary.com/..." }`. Protected by `JwtAuthGuard` (any authenticated user).

Constraints:
- Max file size: 5MB
- Allowed types: `image/jpeg`, `image/png`, `image/webp`
- Cloudinary folder: `gym-management/avatars`

### Existing `PATCH /api/v1/users/:id`

Admin user update also supports `gender` and `displayPicture` via `UpdateUserDto` and `safeUserSelect`.

## New Module: Uploads

- `src/uploads/uploads.module.ts`
- `src/uploads/uploads.controller.ts`
- `src/uploads/uploads.service.ts`

Uses Cloudinary Node SDK. Multer for file handling (built into `@nestjs/platform-express`).

## Configuration

New config file: `src/common/config/cloudinary.config.ts` (follows existing `registerAs()` pattern).

New env vars:
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Added to `ConfigLoaderModule`.

## Dependencies

- `cloudinary` — Cloudinary Node SDK
- `multer` / `@types/multer` — already included with `@nestjs/platform-express`
