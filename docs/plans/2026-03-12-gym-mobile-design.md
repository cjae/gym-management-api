# Gym Mobile App — MVP Design

**Date**: 2026-03-12
**Status**: Approved
**Repo**: `~/Documents/js/gym-mobile`

## Overview

Expo React Native mobile app for gym members. iOS + Android from a single codebase. Connects to the existing NestJS API at `/api/v1/...`.

## Tech Stack

- **Framework**: Expo SDK 52+, Expo Router (file-based navigation)
- **State**: TanStack Query (server state) + Zustand (auth/client state)
- **Styling**: NativeWind v4 (Tailwind CSS for React Native)
- **HTTP**: Axios with interceptors (token refresh, Basic Auth)
- **Key Expo packages**: expo-camera (QR), expo-secure-store (tokens), expo-notifications (push)
- **Other**: react-native-webview (Paystack checkout), react-native-signature-canvas (legal signing)

## MVP Scope

**In scope:**
- Auth (login, register, forgot password)
- Legal document onboarding gate (view + sign)
- QR check-in (camera scanner)
- Home dashboard (streak card, subscription status)
- Subscription management (browse plans, pay via Paystack WebView, freeze/cancel)
- Attendance history
- Profile (edit info, change password, avatar upload, logout)
- Push notifications + in-app notification list

**Out of scope (post-MVP):**
- Leaderboard
- Trainer profiles/schedules
- Duo member management
- Password reset (deep link flow)

## Project Structure

```
gym-mobile/
├── app/
│   ├── _layout.tsx                   # Providers, fonts, notification handler
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   └── forgot-password.tsx
│   ├── (app)/
│   │   ├── _layout.tsx              # Tab navigator + notification badge
│   │   ├── (tabs)/
│   │   │   ├── index.tsx            # Home (streak, subscription, scan button)
│   │   │   ├── scan.tsx             # QR scanner
│   │   │   └── profile.tsx          # Profile, change password, logout
│   │   ├── legal/
│   │   │   ├── index.tsx            # Unsigned docs gate
│   │   │   └── sign/[id].tsx        # Doc + signature pad
│   │   ├── subscription/
│   │   │   ├── plans.tsx
│   │   │   ├── my.tsx               # My subs (freeze/cancel)
│   │   │   └── payment.tsx          # Paystack WebView
│   │   ├── attendance/
│   │   │   └── history.tsx
│   │   └── notifications.tsx        # Notification list
├── src/
│   ├── api/
│   │   ├── client.ts               # Axios instance, interceptors, token refresh
│   │   ├── auth.ts                  # Auth query/mutation hooks
│   │   ├── subscriptions.ts
│   │   ├── attendance.ts
│   │   ├── payments.ts
│   │   ├── legal.ts
│   │   └── notifications.ts
│   ├── stores/
│   │   └── auth.ts                  # Zustand: tokens, user state, push token
│   ├── hooks/
│   │   └── useNotifications.ts      # Push registration + foreground handling
│   ├── components/                  # Shared UI components
│   └── lib/                         # Utilities, constants
├── assets/
├── tailwind.config.js
└── app.json
```

## Auth Flow

1. App opens → check `expo-secure-store` for access + refresh tokens
2. No tokens → show `(auth)` group (login/register)
3. Has tokens → validate with `GET /auth/me`
   - `mustChangePassword: true` → force password change screen
   - Unsigned legal docs (`GET /legal/unsigned`) → gate to legal signing before main app
   - Otherwise → `(app)` tabs
4. **Token refresh**: Axios interceptor catches 401, calls `POST /auth/refresh` with refresh token, retries original request. If refresh fails → clear tokens, redirect to login.
5. **Basic Auth**: Login, register, and forgot-password requests include HTTP Basic Auth header (credentials from app config).
6. **Logout**: `POST /auth/logout` → clear secure store, remove push token (`DELETE /push-tokens`)

## Key Flows

### QR Check-in
1. Scan tab opens camera via `expo-camera` barcode scanner
2. On barcode detected → `POST /attendance/check-in` with `{ qrCode }`
3. Success → show streak card (weeklyStreak, daysThisWeek/4 progress)
4. Already checked in → friendly "You're good for today" message
5. No active subscription → prompt to subscribe

### Subscription Management
1. Browse plans → `GET /subscription-plans` (active only)
2. Select plan → `POST /subscriptions` (creates PENDING subscription)
3. Redirect to `payment.tsx` → WebView loads Paystack checkout URL from `POST /payments/initialize/:subscriptionId`
4. On WebView success callback → navigate back, subscription activates via webhook
5. My subscriptions: view status, freeze/unfreeze, cancel

### Legal Onboarding Gate
1. After login, `GET /legal/unsigned` → if required docs exist, block app access
2. Show doc list → tap to view content
3. Sign via `react-native-signature-canvas` → `POST /legal/sign` with base64 signature
4. All docs signed → proceed to main app

### Profile
- View/edit: firstName, lastName, phone, gender via `PATCH /auth/me`
- Avatar upload: `POST /uploads/image` (multipart, max 5MB)
- Change password: `PATCH /auth/change-password`
- Logout

## Notifications

### Backend Addition (new module in API repo)

**Models:**

```prisma
model Notification {
  id        String   @id @default(uuid())
  userId    String?  // null = broadcast to all members
  title     String
  body      String
  type      String   // SUBSCRIPTION_EXPIRING, PAYMENT_REMINDER, STREAK_NUDGE, STATUS_CHANGE, GENERAL
  isRead    Boolean  @default(false)
  metadata  Json?    // e.g., { subscriptionId, daysLeft }
  createdAt DateTime @default(now())

  user User? @relation(fields: [userId], references: [id])
}

model PushToken {
  id        String   @id @default(uuid())
  userId    String
  token     String   @unique  // Expo push token
  platform  String   // ios, android
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id])
}
```

**API endpoints:**
- `POST /notifications` — ADMIN+ creates notification (userId = targeted, null = broadcast)
- `GET /notifications` — MEMBER gets their notifications + broadcasts (paginated, newest first)
- `PATCH /notifications/:id/read` — mark as read
- `PATCH /notifications/read-all` — mark all as read
- `POST /push-tokens` — register Expo push token (on login/app open)
- `DELETE /push-tokens` — remove push token (on logout)

**Push delivery:**
- Expo Push API (`expo-server-sdk`) sends push notifications from backend
- Triggered by: billing cron (expiry/payment reminders), subscription status change events, streak check-in events, admin broadcast
- Same notification stored in DB + sent as push

**Notification types:**
| Type | Trigger | Example |
|------|---------|---------|
| SUBSCRIPTION_EXPIRING | Billing cron (7d, 3d, 1d before expiry) | "Your membership expires in 3 days" |
| PAYMENT_REMINDER | Billing cron (M-Pesa users) | "Payment due for your Monthly Solo plan" |
| STREAK_NUDGE | Check-in event (3/4 days hit) | "One more day this week to keep your streak!" |
| STATUS_CHANGE | Subscription status change | "Your subscription is now active" |
| GENERAL | Admin creates via dashboard | "Gym closed on public holiday March 15" |

### Mobile Side
- `expo-notifications` for push token registration + foreground/background handling
- Bell icon on Home tab header with unread badge count (`GET /notifications?isRead=false` count)
- Notification list screen: pull to refresh, tap to mark read, swipe to dismiss
- Tapping a notification deep-links to relevant screen (e.g., SUBSCRIPTION_EXPIRING → my subscriptions)

## API Endpoints Used (Member Role)

| Feature | Endpoints |
|---------|-----------|
| Auth | POST /auth/login, /register, /forgot-password, /refresh, /logout, GET /auth/me, PATCH /auth/me, /auth/change-password |
| Legal | GET /legal, /legal/unsigned, POST /legal/sign |
| Attendance | POST /attendance/check-in, GET /attendance/history, /attendance/streak |
| Subscriptions | GET /subscription-plans, /subscriptions/my, POST /subscriptions, PATCH /subscriptions/:id/cancel, /freeze, /unfreeze |
| Payments | POST /payments/initialize/:id, GET /payments/history |
| Profile | POST /uploads/image |
| Notifications | GET /notifications, PATCH /notifications/:id/read, /notifications/read-all, POST /push-tokens, DELETE /push-tokens |
