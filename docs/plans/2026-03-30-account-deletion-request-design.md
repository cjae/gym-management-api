# Account Deletion Request — Design

## Summary

Members can request account deletion. Admins review and approve/reject. Approval triggers existing soft-delete (`deletedAt`). Members can cancel their own pending request.

## Model: AccountDeletionRequest

| Field        | Type                                          | Notes                              |
|-------------|-----------------------------------------------|-------------------------------------|
| id          | UUID                                          | PK                                  |
| userId      | FK → User                                     | Unique constraint for PENDING status|
| reason      | String?                                       | Optional, max 500 chars             |
| status      | PENDING \| APPROVED \| REJECTED \| CANCELLED  | Default PENDING                     |
| reviewedById| FK → User?                                    | Admin who acted on request          |
| reviewedAt  | DateTime?                                     | When admin acted                    |
| createdAt   | DateTime                                      | @default(now())                     |
| updatedAt   | DateTime                                      | @updatedAt                          |

One PENDING request per user enforced at the application level (check before creating).

## Endpoints

### Member (auth module, JWT required)

| Method | Path                    | Description                     |
|--------|-------------------------|---------------------------------|
| POST   | /auth/delete-request    | Submit deletion request         |
| GET    | /auth/delete-request    | Check own request status        |
| DELETE | /auth/delete-request    | Cancel own PENDING request      |

### Admin (users module, ADMIN/SUPER_ADMIN)

| Method | Path                                       | Description                          |
|--------|-------------------------------------------|---------------------------------------|
| GET    | /users/deletion-requests                   | List requests (filterable by status, paginated) |
| PATCH  | /users/deletion-requests/:id/approve       | Approve → soft-deletes user           |
| PATCH  | /users/deletion-requests/:id/reject        | Reject (optional reason field on body)|

## Behavior

- Only one PENDING request per user at a time
- Submitting when PENDING already exists returns 409 Conflict
- Cancel only works on own PENDING request
- Approve sets `AccountDeletionRequest.status = APPROVED`, `reviewedById`, `reviewedAt`, and `User.deletedAt`
- Reject sets `AccountDeletionRequest.status = REJECTED`, `reviewedById`, `reviewedAt`
- No auto-approve cron
- No email notifications
