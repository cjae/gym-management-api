# Force Password Change for Seeded Admins

## Problem

Seeded admin and super-admin accounts use a shared default password (`password123`). Users should be forced to set their own password on first login.

## Scope

Applies only to ADMIN and SUPER_ADMIN seeded users. Trainers and members are out of scope — members sign up via their own app, and trainers can't log into the admin dashboard.

## Design

### Schema

Add `mustChangePassword Boolean @default(false)` to the `User` model. Default is `false` so existing users and newly registered users are unaffected.

### Seed

Set `mustChangePassword: true` for the super-admin and both admin users.

### Auth Changes

- **`login()`** — query `mustChangePassword` from the user record and include it in the response alongside `accessToken` and `refreshToken`.
- **`changePassword()`** — after a successful password change, set `mustChangePassword: false`.
- **`resetPassword()`** — after a successful password reset, set `mustChangePassword: false`.

### Login Response

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "mustChangePassword": true
}
```

### Frontend Behavior

The admin frontend checks `mustChangePassword` in the login response. If `true`, redirect to a change-password screen before showing the dashboard.
