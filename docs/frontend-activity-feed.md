# Activity Feed WebSocket — Frontend Integration Guide

## Connection

The API exposes a Socket.IO WebSocket at the `/activity` namespace. Only authenticated **ADMIN** and **SUPER_ADMIN** users can connect.

```ts
import { io } from "socket.io-client";

const socket = io(`${API_BASE_URL}/activity`, {
  auth: { token: jwtAccessToken },
});
```

- `API_BASE_URL` — the base URL of the API (e.g. `http://localhost:3000`)
- `token` — the JWT access token from login/refresh. Pass it in `auth`, **not** as a query param.

### Connection lifecycle

```ts
socket.on("connect", () => {
  console.log("Connected to activity feed");
});

socket.on("disconnect", (reason) => {
  // The server disconnects clients with invalid/expired tokens
  // or non-admin roles. Handle reconnection with a fresh token.
  console.log("Disconnected:", reason);
});

socket.on("connect_error", (err) => {
  // Token rejected or server unreachable
  console.error("Connection error:", err.message);
});
```

The server will **force-disconnect** the client if:
- No token is provided
- The token is invalid or expired
- The token's JTI has been invalidated (user logged out)
- The user's role is not ADMIN or SUPER_ADMIN

On token refresh, disconnect and reconnect with the new token:

```ts
socket.auth = { token: newAccessToken };
socket.disconnect().connect();
```

## Listening for events

There is a single event name: **`activity`**. All activity types come through this one event.

```ts
socket.on("activity", (event: ActivityEvent) => {
  // Prepend to your feed list
});
```

### ActivityEvent payload

```ts
interface ActivityEvent {
  type: "registration" | "check_in" | "payment" | "subscription";
  description: string;       // Human-readable, e.g. "Jane Doe checked in"
  timestamp: string;          // ISO 8601, e.g. "2026-03-09T14:30:00.000Z"
  metadata?: {
    memberId?: string;        // UUID of the member involved
    amount?: number;          // Payment amount in KES (payment events only)
    planName?: string;        // Subscription plan name (subscription events only)
    status?: string;          // e.g. "PAID", "FAILED", "ACTIVE", "CANCELLED"
    [key: string]: unknown;
  };
}
```

### Event types and when they fire

| Type | Triggered when | Key metadata |
|---|---|---|
| `registration` | New user registers | `memberId` |
| `check_in` | Member scans QR to check in | `memberId` |
| `payment` | Paystack webhook confirms charge success or failure | `amount`, `status` (`PAID` or `FAILED`) |
| `subscription` | Subscription created or cancelled | `planName`, `status` (`ACTIVE` or `CANCELLED`) |

### Example payloads

```json
{
  "type": "registration",
  "description": "Jane Doe registered as a new member",
  "timestamp": "2026-03-09T10:15:00.000Z",
  "metadata": { "memberId": "a1b2c3d4-..." }
}
```

```json
{
  "type": "payment",
  "description": "Payment of KES 5,000 received",
  "timestamp": "2026-03-09T11:00:00.000Z",
  "metadata": { "amount": 5000, "status": "PAID" }
}
```

## Suggested UI approach

1. Maintain a local array of `ActivityEvent` items, newest first.
2. On each `activity` event, prepend to the array and cap at ~50 items.
3. Use `type` to render an icon/color (e.g. green for check-in, blue for registration).
4. Display `description` as the primary text and format `timestamp` as relative time ("2 min ago").
5. The feed is admin-only — hide it from non-admin routes.

## Dependencies

Install the Socket.IO client:

```bash
npm install socket.io-client
# or
yarn add socket.io-client
```

The server uses Socket.IO v4, so use `socket.io-client` v4.x.

## Notes

- There is no historical activity endpoint — the feed is real-time only. Past events are not replayed on connect.
- CORS is configured for the `ADMIN_URL` origin (defaults to `http://localhost:3001`).
- The WebSocket path follows Socket.IO defaults (`/socket.io/`), so no custom `path` option is needed — just set the namespace via the URL.
