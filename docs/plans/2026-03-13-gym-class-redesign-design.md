# GymClass Redesign — Design Document

**Date:** 2026-03-13
**Status:** Approved

## Problem

Schedules are currently owned by trainers (`TrainerSchedule` → `TrainerProfile`). In reality, gym classes exist independently — they represent time slots on the weekly timetable. Trainers are assigned to classes, and members enroll in them. This decoupling enables class schedule change notifications and cleaner data modeling.

## Design

### Schema

**`GymClass`** — standalone class entity:
- `id` (UUID), `title` (string), `description` (optional, max 500)
- `dayOfWeek` (int 0-6), `startTime` (HH:MM), `endTime` (HH:MM)
- `maxCapacity` (int, default 20)
- `trainerId` (optional FK → TrainerProfile) — null = unassigned
- `isActive` (bool, default true) — soft delete/disable
- `createdAt`, `updatedAt`

**`ClassEnrollment`** — member ↔ class join table:
- `id` (UUID), `classId` (FK → GymClass), `memberId` (FK → User)
- `enrolledAt` (datetime, default now)
- `@@unique([classId, memberId])`

**Removed:** `TrainerSchedule` model (replaced by `GymClass`).

**Modified:** `TrainerProfile` loses `schedules` relation, gains `classes GymClass[]` reverse relation.

### Time Overlap Validation

No two active classes can overlap on the same day. Enforced at the service level on create/update:
- Conflict exists when `startTime < existingEndTime AND endTime > existingStartTime` on the same `dayOfWeek`, excluding inactive classes and the class being updated.

### API Endpoints

All under `/api/v1/gym-classes`:

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/gym-classes` | POST | ADMIN/SUPER_ADMIN | Create a class |
| `/gym-classes` | GET | Any authenticated | List all active classes (paginated) |
| `/gym-classes/:id` | GET | Any authenticated | Get class with trainer & enrollments |
| `/gym-classes/:id` | PATCH | ADMIN/SUPER_ADMIN | Update class — notifies enrolled members on time change |
| `/gym-classes/:id` | DELETE | ADMIN/SUPER_ADMIN | Soft-delete — notifies enrolled members |
| `/gym-classes/:id/enroll` | POST | MEMBER | Self-enroll |
| `/gym-classes/:id/unenroll` | POST | MEMBER | Leave class |
| `/gym-classes/:id/enrollments` | GET | ADMIN/SUPER_ADMIN | List enrolled members |
| `/gym-classes/my` | GET | MEMBER | List my enrolled classes |

**Removed from trainers controller:** All schedule CRUD endpoints (`POST/GET/PATCH/DELETE` on `/trainers/:id/schedules`).

Trainer assignment to a class is done via PATCH on the class (setting `trainerId`).

### Notifications

**Two new email templates:**

1. **`class-updated.hbs`** — sent when `dayOfWeek`, `startTime`, or `endTime` changes. Contains class title, old and new day/time, trainer name.
2. **`class-cancelled.hbs`** — sent on soft-delete. Contains class title, scheduled day/time.

Emails sent fire-and-forget to all enrolled members. No notifications for trainer reassignment, title changes, or capacity changes.

### Module Structure

New `gym-classes/` module:
- `gym-classes.controller.ts`
- `gym-classes.service.ts`
- `gym-classes.module.ts` (imports PrismaModule, EmailModule)
- `dto/` — create, update, enroll DTOs + response DTOs
- `gym-classes.service.spec.ts`

### What Stays the Same

- `TrainerProfile` — unchanged (profiles, bio, specialization, availability)
- `TrainerAssignment` — unchanged (1:1 personal training member ↔ trainer)
- Trainers controller keeps: profile CRUD, assignment endpoints, `GET /trainers/my/trainer`

### Migration

`TrainerSchedule` table is dropped. Pre-launch, no data migration needed.
