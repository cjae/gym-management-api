# Member Import Design

## Problem

Gyms migrating to this system need to import existing member records (names, contacts, active subscriptions) from spreadsheets rather than re-entering everything manually.

## Solution

A new `imports/` module with CSV upload, background processing, and email report on completion.

## Data Model

```prisma
enum ImportStatus {
  PROCESSING
  COMPLETED
  FAILED
}

enum ImportType {
  MEMBERS
}

model ImportJob {
  id             String       @id @default(uuid())
  type           ImportType
  status         ImportStatus @default(PROCESSING)
  fileName       String
  totalRows      Int          @default(0)
  importedCount  Int          @default(0)
  skippedCount   Int          @default(0)
  errorCount     Int          @default(0)
  errors         Json?        // Array of { row, field, message }
  skipped        Json?        // Array of { row, email, reason }
  initiatedById  String
  completedAt    DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  initiatedBy User @relation(fields: [initiatedById], references: [id])
}
```

## CSV Format

| Column | Required | Example | Notes |
|---|---|---|---|
| `email` | Yes | `jane@example.com` | Must be valid email, unique |
| `first_name` | Yes | `Jane` | |
| `last_name` | Yes | `Doe` | |
| `phone` | No | `+254712345678` | |
| `gender` | No | `MALE` / `FEMALE` / `NON_BINARY` / `PREFER_NOT_TO_SAY` | Must match enum |
| `plan_name` | No | `Monthly Premium` | Must match existing plan name exactly |
| `subscription_end_date` | No | `2026-04-15` | ISO date, required if `plan_name` is set |
| `payment_method` | No | `MPESA_OFFLINE` / `BANK_TRANSFER` / `COMPLIMENTARY` | Defaults to `COMPLIMENTARY`. Only offline methods allowed. |
| `payment_reference` | No | `TXN-12345` | Stored as `Payment.paystackReference` |
| `payment_note` | No | `Cash payment March` | Stored on subscription and payment `paymentNote` fields |

## API Endpoints

| Method | Path | Role | Description |
|---|---|---|---|
| `POST /imports/members` | ADMIN, SUPER_ADMIN | Upload CSV, validate headers, kick off background job |
| `GET /imports` | ADMIN, SUPER_ADMIN | List past import jobs (paginated) |
| `GET /imports/:id` | ADMIN, SUPER_ADMIN | Get job details including error/skip report |

## Request Flow

### Upload (`POST /imports/members`)

1. Receive multipart file upload via Multer `FileInterceptor`
2. Immediate validation (sync):
   - File is `.csv`, max 5MB
   - Required headers present (`email`, `first_name`, `last_name`)
   - Max 500 rows
   - If subscription columns present, validate all required subscription columns exist
3. Create `ImportJob` record (status `PROCESSING`)
4. Return `201` with job ID
5. Background processing begins (async)

### Background Processing

- Process rows sequentially via `setImmediate` to avoid blocking the event loop
- Each row in its own Prisma transaction:
  1. Validate row data
  2. Create `User` (role `MEMBER`, temp password, `mustChangePassword: true`)
  3. If plan columns present: create `MemberSubscription` (status `ACTIVE`, `startDate` = now) + `SubscriptionMember` + `Payment` (status `PAID`)
- If a row fails, log the error and continue (don't abort)
- No welcome emails sent during import — admin distributes credentials manually
- On completion: update `ImportJob` with results, email admin the report
- On unexpected crash: set status to `FAILED`, email admin

### Duplicate Handling

- Email already in DB: skip row, add to skipped report
- Duplicate email within CSV: first occurrence wins, rest skipped
- Member already has active subscription: import user, skip subscription, note in report
- Inactive plan referenced: treat as error for that row

## Email Report

New Handlebars template `import-report` sent to the initiating admin:

- Subject: "Import Complete: X members imported"
- Total rows, imported count, skipped count, error count
- Skipped list (email + reason)
- Error list (row number + error message)
- Link to admin dashboard if `ADMIN_URL` is set

## Security & Constraints

- **Roles:** ADMIN and SUPER_ADMIN only
- **File size:** Max 5MB (Multer limit)
- **Row cap:** 500 rows per import
- **Concurrency:** One active import per admin (reject if `PROCESSING` job exists)
- **Audit logging:** Covered by existing global audit interceptor
- **Passwords:** Random 12-char alphanumeric, bcrypt hashed
- **Payment methods:** Only `MPESA_OFFLINE`, `BANK_TRANSFER`, `COMPLIMENTARY` (online methods require Paystack)
- **CSV injection prevention:** Strip leading `=`, `+`, `-`, `@` from cell values

## Dependencies

- `csv-parse` (or `csv-parser`) — CSV parsing library
- `@nestjs/platform-express` Multer — already available for file uploads
- Existing `EmailService` — for the completion report
- Existing `PrismaService` — for all DB operations
