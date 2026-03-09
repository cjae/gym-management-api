# Refresh Token Rotation

## Summary

Add `POST /auth/refresh` endpoint with token rotation. Each refresh invalidates the old refresh token and issues a new access + refresh pair.

## Endpoint

`POST /api/v1/auth/refresh` — Basic Auth protected, rate-limited 30/min.

**Request**: `{ "refreshToken": "..." }`
**Response**: `{ "accessToken": "...", "refreshToken": "...", "mustChangePassword": false }`

## Flow

1. Frontend sends refresh token in request body
2. `JwtRefreshStrategy` validates token using `JWT_REFRESH_SECRET`
3. JTI checked against `InvalidatedToken` table (existing blocklist)
4. Old refresh token JTI invalidated in `InvalidatedToken`
5. New access + refresh token pair generated and returned

## Components

- `JwtRefreshStrategy` — Passport strategy, extracts token from body, validates with refresh secret
- `JwtRefreshAuthGuard` — guard wrapping the refresh strategy
- `RefreshTokenDto` — `{ refreshToken: string }` with validation
- `AuthController.refresh()` — new endpoint
- `AuthService.refreshToken()` — updated to accept and invalidate old JTI

## Security

- Token rotation: old refresh JTI invalidated on each use (single-use tokens)
- Stolen token detection: if attacker uses a rotated token, it's already invalidated
- Reuses existing `InvalidatedToken` table (7d TTL entries)
- Basic Auth required (same as login/register)
- Rate-limited to 30 req/min
