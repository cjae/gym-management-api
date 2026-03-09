# QR Attendance Real-Time Check-In Design

**Date**: 2026-03-10
**Status**: Approved

## Overview

Redesign the QR attendance flow so that a daily auto-generated QR code is displayed on a screen at the gym entrance. Members scan it with the mobile app to check in. Both the app and the entrance screen receive instant feedback (success/error) with the entrance screen showing a banner with the member's name, photo, and subscription status, accompanied by audio chimes.

## Architecture

```
Member Phone                    API                         Admin Entrance Screen
     |                          |                                |
     |--- POST /check-in ------>|                                |
     |                          |-- validate QR                  |
     |                          |-- validate subscription        |
     |                          |-- record attendance            |
     |<-- REST response --------|                                |
     |   (success/error,        |-- WS emit: check_in_result -->|
     |    streak info)          |   (name, photo, status)        |
     |                          |                                |-- show banner
     |                          |                                |-- play chime
```

- Mobile app gets feedback via REST response (no WebSocket needed on mobile for this flow).
- Admin entrance screen connects via Socket.IO on the existing `/activity` namespace.
- QR code displayed on a dedicated admin page (`/entrance` route in the admin app).
- Banner overlay: member name + photo + green/red status, slides in from top, fades after ~3 seconds.

## Daily QR Rotation

- Cron job at midnight (`0 0 * * *`) in `QrService` generates a new random hex token.
- Reuses existing `generateQrCode()` logic — deactivates all previous codes, creates new active one.
- Emits a `qr.rotated` WebSocket event so the entrance screen auto-refreshes the displayed QR code.
- Admins can still manually regenerate via `POST /qr/generate` if needed.

## QR Code Format

Simple random hex token (64 chars via `crypto.randomBytes(32)`). The mobile app sends this token to the API with its JWT. A raw token is meaningless without an authenticated app session, so photographing the QR code is not exploitable.

## API Contract

### Check-in Endpoint (no changes)

```
POST /api/v1/attendance/check-in
Body: { "qrCode": "abc123hex..." }
Auth: Bearer JWT

// Success (200)
{
  "alreadyCheckedIn": false,
  "message": "Check-in successful",
  "streak": 5,
  "longestStreak": 12
}

// Inactive subscription (403)
{
  "statusCode": 403,
  "message": "No active subscription found"
}

// Invalid QR (400)
{
  "statusCode": 400,
  "message": "Invalid or expired QR code"
}
```

### New WebSocket Event: `check_in_result`

Emitted on the `/activity` namespace to all connected admin clients on both successful and failed check-ins (inactive subscription). Separate from the existing `activity` event.

```typescript
{
  type: 'check_in_result',
  member: {
    id: string,
    firstName: string,
    lastName: string,
    displayPicture: string | null
  },
  success: boolean,
  message: string,       // "Check-in successful" or "No active subscription"
  timestamp: string      // ISO 8601
}
```

### New WebSocket Event: `qr.rotated`

Emitted when the daily cron (or manual regeneration) creates a new QR code. The entrance screen refetches the active QR via `GET /api/v1/qr/active`.

```typescript
{
  type: 'qr_rotated',
  timestamp: string      // ISO 8601
}
```

## Entrance Screen WebSocket Events

| Event | Purpose |
|-------|---------|
| `check_in_result` | Show success/error banner with member info + chime |
| `qr_rotated` | Refresh the displayed QR code |
| `connect` | On initial load, fetch active QR via REST `GET /qr/active` |

## Implementation Changes (API)

### 1. Daily QR Cron Job
- Add `@Cron('0 0 * * *')` method to `QrService`.
- Calls existing `generateQrCode()` internally.
- Emits `qr.rotated` event via `EventEmitter2`.

### 2. Check-in Result Event Emission
- On successful check-in: emit `check_in_result` with `success: true` (in addition to existing `activity.check_in`).
- On failed subscription validation: emit `check_in_result` with `success: false` before throwing the 403. Requires looking up the member's name and photo before rejecting.
- Invalid QR code: no event emitted (no member context available).

### 3. ActivityGateway Enhancement
- Add `@OnEvent('check_in.result')` handler that broadcasts `check_in_result` to connected clients.
- Add `@OnEvent('qr.rotated')` handler that broadcasts `qr_rotated` to connected clients.

## Entrance Screen (Admin App)

- New route: `/entrance`
- Full-screen layout with centered QR code (rendered client-side from the token string).
- Banner component slides down from top on `check_in_result` events:
  - **Success**: green background, member name + photo + "Active", success chime.
  - **Error**: red background, member name + photo + "Inactive", error chime.
  - Auto-dismisses after 3 seconds with fade animation.
- Member with no photo: show default avatar placeholder.
- Audio chime files bundled as static assets in the admin app.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| QR rotates at midnight while screen is open | `qr_rotated` event triggers refetch, no user action needed |
| Member scans old QR (just after midnight) | Existing validation rejects it (400). No entrance banner (no member context) |
| Same member scans twice in one day | Idempotent — `alreadyCheckedIn: true`. Entrance screen still shows success banner |
| Entrance screen loses WebSocket | Socket.IO auto-reconnects. QR stays visible. Missed banners are acceptable |
| No active QR code (first deploy) | Entrance screen shows "No active QR code" message. Admin can manually generate |
| Member has no display picture | Banner shows name with default avatar placeholder |

## Out of Scope

- Mobile app WebSocket connection for check-in flow
- Historical replay of check-in results on entrance screen
- Removing manual QR regeneration
- Changes to the existing activity feed
- Mobile app UX for scanning (deferred)
