# Multi-Entrance QR Check-in — Frontend Integration Guide

## Overview

Gyms can now have multiple entrance points (e.g., "Front Door", "Side Gate", "Parking Entrance"), each with its own screen displaying a QR code. When a member scans at a specific entrance, the check-in result banner (success/failure with member photo) appears **only on that entrance's screen** — not on every screen.

The rotating QR code is still shared across all entrances. Each entrance screen appends its own entrance UUID to the QR payload before displaying it.

---

## New API Endpoints

### Entrances CRUD

All endpoints require JWT auth with `ADMIN` or `SUPER_ADMIN` role.

Base path: `/api/v1/entrances`

| Method | Path | Description | Request Body | Response |
|--------|------|-------------|-------------|----------|
| `POST` | `/api/v1/entrances` | Create an entrance | `{ "name": "Front Door" }` | `EntranceResponse` |
| `GET` | `/api/v1/entrances` | List all entrances (paginated) | Query: `?page=1&limit=20` | `{ data: EntranceResponse[], total, page, limit }` |
| `GET` | `/api/v1/entrances/:id` | Get single entrance | — | `EntranceResponse` |
| `PATCH` | `/api/v1/entrances/:id` | Update entrance | `{ "name"?: string, "isActive"?: boolean }` | `EntranceResponse` |
| `DELETE` | `/api/v1/entrances/:id` | Delete entrance | — | `EntranceResponse` |

**EntranceResponse:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Front Door",
  "isActive": true,
  "createdAt": "2026-03-10T12:00:00.000Z",
  "updatedAt": "2026-03-10T12:00:00.000Z"
}
```

**Validation:**
- `name` is required, string, max 100 characters, cannot be empty
- `isActive` is optional boolean (defaults to `true` on create)

---

## Updated Check-in Flow

### QR Code Payload Format

**Before (single entrance):**
```
a3f8b2c1e9d4...hexcode
```

**After (multi-entrance):**
```
a3f8b2c1e9d4...hexcode:550e8400-e29b-41d4-a716-446655440000
```

Format: `{rotatingCode}:{entranceId}` — separated by a colon. The entrance ID is a UUID.

**Backwards compatible:** Payloads without a colon (or where the part after the colon is not a valid UUID) are treated as legacy single-entrance check-ins.

### How the Entrance Screen Builds the QR Code

1. Fetch the active QR code: `GET /api/v1/qr/active` (returns `{ code: "hexstring", ... }`)
2. The screen knows its own `entranceId` (configured once during setup)
3. Concatenate: `${code}:${entranceId}`
4. Render this string as a QR code for members to scan

### How the Mobile App Checks In

No change to the mobile app's check-in call. It scans the QR code and sends whatever string it scanned:

```
POST /api/v1/attendance/check-in
Authorization: Bearer <member-jwt>

{ "qrCode": "a3f8b2c1...hexcode:550e8400-e29b-41d4-a716-446655440000" }
```

The backend parses the entrance ID from the payload automatically.

### Check-in Response

Same as before, unchanged:
```json
{
  "alreadyCheckedIn": false,
  "message": "Check-in successful",
  "streak": 5,
  "longestStreak": 12
}
```

---

## WebSocket Changes

### Connecting an Entrance Screen

Connect to the `/activity` WebSocket namespace with the entrance ID in the handshake query:

```typescript
import { io } from 'socket.io-client';

const socket = io('http://api-host/activity', {
  auth: { token: adminJwtToken },
  query: { entranceId: '550e8400-e29b-41d4-a716-446655440000' },
});
```

The server joins the socket to a room named `entrance:{entranceId}`. This enables targeted event routing.

### Events

#### `check_in_result` (broadcast to ALL connected clients)

Fires on every check-in attempt. **Admin dashboards** should listen to this to see all check-in results across all entrances.

```typescript
socket.on('check_in_result', (data) => {
  // data.entranceId tells you which entrance this came from (may be undefined for legacy)
});
```

Payload:
```json
{
  "type": "check_in_result",
  "member": {
    "id": "uuid",
    "firstName": "Jane",
    "lastName": "Smith",
    "displayPicture": "https://example.com/pic.jpg"
  },
  "success": true,
  "message": "Check-in successful",
  "entranceId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-03-10T08:30:00.000Z"
}
```

#### `check_in_result_entrance` (sent ONLY to the matching entrance room)

Same payload as `check_in_result`, but only delivered to sockets in the `entrance:{entranceId}` room. **Entrance screens** should listen to this event to show results only for their own entrance.

```typescript
// Entrance screen — only receives events for its own entrance
socket.on('check_in_result_entrance', (data) => {
  showResultBanner(data.member, data.success, data.message);
});
```

> **Important:** Entrance screens that connect with an `entranceId` will receive BOTH `check_in_result` (broadcast) and `check_in_result_entrance` (targeted). Listen to `check_in_result_entrance` only to avoid duplicate banners.

#### `qr_rotated` (broadcast to ALL — unchanged)

Fires when the daily QR code rotates. All screens should re-fetch the active code and rebuild their QR.

```typescript
socket.on('qr_rotated', (data) => {
  // Re-fetch GET /api/v1/qr/active and rebuild QR with entranceId appended
});
```

---

## Updated Attendance Responses

### `GET /api/v1/attendance/today` (admin only)

Now includes entrance information:

```json
[
  {
    "id": "uuid",
    "memberId": "uuid",
    "checkInDate": "2026-03-10",
    "checkInTime": "2026-03-10T08:30:00.000Z",
    "entranceId": "550e8400-e29b-41d4-a716-446655440000",
    "member": {
      "id": "uuid",
      "firstName": "Jane",
      "lastName": "Smith",
      "email": "jane@example.com"
    },
    "entrance": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Front Door"
    }
  }
]
```

`entrance` will be `null` for check-ins that occurred before this feature was deployed or without an entrance ID.

---

## Admin Dashboard Implementation Notes

### Entrance Management Page

Standard CRUD page for managing entrances:
- List view with name, active status, created date
- Create form: name field (required, max 100 chars)
- Edit: inline toggle for isActive, editable name
- Delete with confirmation (note: deleting an entrance nullifies the entrance reference on historical attendance records)

### Entrance Screen Setup

Each physical entrance screen needs to be configured with its `entranceId`. Options:
1. **URL parameter:** `https://admin.example.com/entrance-screen?entranceId=uuid`
2. **Local storage:** Admin selects the entrance once, stored in browser
3. **QR setup flow:** Admin scans a setup QR or enters the entrance ID manually

The screen then:
1. Connects to WebSocket with `entranceId` in query
2. Fetches active QR code from API
3. Renders `{code}:{entranceId}` as a QR code
4. Listens to `check_in_result_entrance` for result banners
5. Listens to `qr_rotated` to refresh the QR code

### Today's Attendance View

The `GET /api/v1/attendance/today` response now includes `entrance.name`. Consider adding a filter/group-by entrance in the attendance list view.

---

## Mobile App Implementation Notes

No changes required to the mobile app's check-in logic. The app scans whatever QR code is displayed and sends the full string to `POST /api/v1/attendance/check-in`. The backend handles parsing.

The only visible change: the QR code string is now longer (UUID appended after a colon).
