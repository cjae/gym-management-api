# Audit Logs Design

## Overview

Add audit logging for admin and super admin actions. Captures write operations (CREATE, UPDATE, DELETE) automatically via a global NestJS interceptor, plus auth events (login, logout, password reset) via explicit service calls.

## Decisions

| Decision | Choice |
|---|---|
| What to audit | Write operations + auth events |
| Who views logs | SUPER_ADMIN only |
| Data captured | Before + after diff (old/new JSON) |
| Storage | Same PostgreSQL database, keep forever |
| Mechanism | Global NestJS interceptor, auto-detect by HTTP method + user role |

## Data Model

```prisma
enum AuditAction {
  CREATE
  UPDATE
  DELETE
  LOGIN
  LOGIN_FAILED
  LOGOUT
  PASSWORD_RESET_REQUEST
  PASSWORD_RESET
  PASSWORD_CHANGE
}

model AuditLog {
  id         String      @id @default(uuid())
  userId     String?
  action     AuditAction
  resource   String
  resourceId String?
  oldData    Json?
  newData    Json?
  ipAddress  String?
  userAgent  String?
  route      String?
  metadata   Json?
  createdAt  DateTime    @default(now())

  user User? @relation(fields: [userId], references: [id])

  @@index([userId])
  @@index([resource, resourceId])
  @@index([action])
  @@index([createdAt])
}
```

- `userId` nullable for failed logins where user may not exist.
- `oldData`/`newData` store before/after state as JSON.
- Sensitive fields (password, paystackAuthorizationCode, token, signatureData) stripped before storing.
- Indexes on common query patterns: by user, by resource, by action, by date.

## Interceptor Design

### AuditInterceptor (global)

- Registered via `APP_INTERCEPTOR` provider.
- Auto-logs when: HTTP method is POST/PUT/PATCH/DELETE **and** user role is ADMIN or SUPER_ADMIN.
- For UPDATE/DELETE: fetches old data via `AuditLogService.fetchOldData()` before the handler executes.
- Resource name inferred from controller class name (e.g. `UsersController` -> `User`).
- Resource ID from `req.params.id`.
- Respects `@NoAudit()` decorator to opt out specific endpoints.
- Strips sensitive fields from request/response data before persisting.

### Sensitive field stripping

The following fields are always removed from `oldData`/`newData`:
- `password`
- `paystackAuthorizationCode`
- `token`
- `signatureData`

## Auth Event Logging

Manual `auditLogService.log()` calls in `AuthService`:

| Event | Action | Notes |
|---|---|---|
| Successful login | `LOGIN` | Any role |
| Failed login | `LOGIN_FAILED` | Attempted email in metadata, userId null |
| Logout | `LOGOUT` | After token invalidation |
| Forgot password | `PASSWORD_RESET_REQUEST` | Email in metadata |
| Reset password | `PASSWORD_RESET` | After successful reset |
| Change password | `PASSWORD_CHANGE` | Authenticated user |

## API Endpoints

### `GET /api/v1/audit-logs`

- **Auth**: SUPER_ADMIN only
- **Pagination**: Uses existing `PaginationQueryDto`
- **Query filters**:
  - `userId` — who performed the action
  - `action` — action type enum
  - `resource` — resource name string
  - `resourceId` — specific resource UUID
  - `startDate` / `endDate` — date range
  - `ipAddress` — IP address

Response includes user name/email (not full user object) alongside each log entry.

## Module Structure

### AuditLogModule (global)

- `AuditLogService` — log(), fetchOldData(), findAll()
- `AuditLogController` — GET endpoint for SUPER_ADMIN
- `AuditInterceptor` — registered as APP_INTERCEPTOR
- `@NoAudit()` decorator — opt-out for specific endpoints

### Changes to Existing Code

- `AuthService`: ~6 manual auditLogService.log() calls for auth events
- `User` model in schema.prisma: add `auditLogs AuditLog[]` relation
- `AppModule`: import AuditLogModule
- No changes to any other existing modules or controllers

## Resource-to-Prisma Mapping

The `fetchOldData()` method uses a map to look up the correct Prisma model:

```
User -> prisma.user
SubscriptionPlan -> prisma.subscriptionPlan
Subscription -> prisma.memberSubscription
Salary -> prisma.staffSalaryRecord
Trainer -> prisma.trainerProfile
Legal -> prisma.legalDocument
Entrance -> prisma.entrance
QrCode -> prisma.gymQrCode
```
