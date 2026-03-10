# Multi-Entrance QR Check-in Design

## Problem

A gym may have multiple entrance points (front door, side gate, parking entrance), each with its own screen displaying a QR code. When a member scans at a specific entrance, the check-in result banner (success/failure) should appear only on that entrance's screen — not on every screen in the gym.

## Approach

**Approach A: Entrance as a new entity, shared rotating QR code.**

The rotating QR code remains a single shared code in `GymQrCode`. Each entrance screen appends its own entrance UUID to the QR payload before displaying it. The backend splits the payload, validates the code, resolves the entrance, and routes the result to the correct screen via WebSocket rooms.

### Alternatives Considered

- **Unique QR code per entrance** — Each entrance gets its own rotating code. Over-engineered: N codes to rotate and validate, with no real benefit since the entrance ID in the payload is sufficient.
- **WebSocket rooms only, no model** — No `Entrance` entity, just arbitrary room names. No admin management, no persistence, no analytics. Fragile.

## Data Model

### New: `Entrance`

```prisma
model Entrance {
  id          String       @id @default(uuid())
  name        String       // e.g. "Front Door", "Side Gate"
  isActive    Boolean      @default(true)
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  attendances Attendance[]
}
```

### Updated: `Attendance`

Add optional `entranceId` FK:

```prisma
entranceId  String?
entrance    Entrance? @relation(fields: [entranceId], references: [id])
```

Nullable for backwards compatibility with existing attendance records.

### Unchanged: `GymQrCode`

Still one shared rotating code. No changes.

## QR Payload Format

The entrance screen fetches the active code via `GET /api/v1/qr/active` and constructs the QR payload:

```
{rotatingCode}:{entranceId}
```

Example: `a3f8b2c1e9...d4e5:550e8400-e29b-41d4-a716-446655440000`

Delimiter: `:` (colon). Smaller QR codes than JSON, scans more reliably.

**Backwards compatibility:** If the payload contains no `:`, treat it as the legacy format (no entrance, `entranceId` stays null on the attendance record).

## Check-in Flow

1. Member's phone scans QR code at an entrance screen.
2. Phone sends `POST /api/v1/attendance/check-in` with `{ qrCode: "code:entranceId" }`.
3. Backend splits on `:` — left is the rotating code, right is the entrance UUID.
4. Validates the rotating code against `GymQrCode` (existing logic).
5. Validates the entrance exists and `isActive: true`. Throws `BadRequestException` if not.
6. Records attendance with `entranceId` on the row.
7. Emits `check_in.result` event with `entranceId` included.

## Entrance Module (CRUD)

New `entrances/` module. Admin-only endpoints:

| Endpoint | Method | Role | Description |
|---|---|---|---|
| `/api/v1/entrances` | POST | ADMIN, SUPER_ADMIN | Create entrance |
| `/api/v1/entrances` | GET | ADMIN, SUPER_ADMIN | List all entrances |
| `/api/v1/entrances/:id` | GET | ADMIN, SUPER_ADMIN | Get single entrance |
| `/api/v1/entrances/:id` | PATCH | ADMIN, SUPER_ADMIN | Update name or isActive |
| `/api/v1/entrances/:id` | DELETE | ADMIN, SUPER_ADMIN | Delete entrance |

Follows existing module pattern: controller → service → Prisma.

## WebSocket Result Routing

### Room-based routing

1. Entrance screen connects to `/activity` WebSocket with JWT + `entranceId` in handshake query.
2. Gateway validates auth (existing logic) and joins the socket to room `entrance:{entranceId}`.
3. On `check_in.result` event:
   - If `entranceId` present: emit to room `entrance:{entranceId}` AND broadcast to all (admin dashboards still see everything).
   - If absent: broadcast to all (current behavior).
4. `qr.rotated` continues broadcasting to all — every screen needs to refresh.

### Updated CheckInResultEvent

```typescript
interface CheckInResultEvent {
  type: 'check_in_result'
  member: { id: string; firstName: string; lastName: string; displayPicture: string | null }
  success: boolean
  message: string
  entranceId?: string
  timestamp: string
}
```

## Scope

### In scope

- `Entrance` Prisma model + migration
- `Attendance` model: optional `entranceId` FK
- `entrances/` module (CRUD, admin-only)
- `CheckInDto` parsing: split on `:` to extract entrance ID
- `AttendanceService.checkIn()`: validate entrance, save on attendance record
- `ActivityGateway`: room-based routing for `check_in_result` events
- `CheckInResultEvent` interface: add `entranceId` field

### Out of scope (future)

- Per-entrance analytics endpoints
- Entrance-specific QR rotation schedules
- Entrance capacity limits
