# Gym Management Platform — MVP Design

## Overview

A gym management platform for the Kenyan market with three components:
- **API** (NestJS + PostgreSQL + Prisma) — core backend
- **Mobile App** (Expo/React Native) — member-facing
- **Admin Dashboard** (Next.js) — staff-facing

## Roles

- **Super Admin** — full access including payroll
- **Admin** — member management, attendance, trainers, subscriptions
- **Trainer** — view own schedule and assigned members
- **Member** — mobile app user

## Data Model

### User
- `id`, `email`, `password` (hashed), `phone`, `firstName`, `lastName`
- `role`: SUPER_ADMIN | ADMIN | TRAINER | MEMBER
- `status`: ACTIVE | INACTIVE | SUSPENDED
- `createdAt`, `updatedAt`

### Subscription Plan
- `id`, `name`, `price`, `currency` (KES), `durationDays`, `description`
- `maxMembers` (1 = solo, 2 = duo)
- `isActive`

### Member Subscription
- `id`, `primaryMemberId`, `planId`, `startDate`, `endDate`
- `status`: ACTIVE | EXPIRED | CANCELLED
- `paystackReference`, `paymentStatus`

### Subscription Member (join table)
- `id`, `subscriptionId`, `memberId`
- Links 1-2 members to one subscription (duo plan support)

### Attendance
- `id`, `memberId`, `checkInDate` (unique per member per day), `checkInTime`

### Streak
- `id`, `memberId`, `currentStreak`, `longestStreak`, `lastCheckInDate`

### Trainer Profile
- `id`, `userId`, `specialization`, `bio`, `availability` (JSON)

### Trainer Schedule
- `id`, `trainerId`, `title`, `dayOfWeek`, `startTime`, `endTime`, `maxCapacity`

### Trainer Assignment
- `id`, `trainerId`, `memberId`, `startDate`, `endDate`, `notes`

### Legal Document
- `id`, `title`, `content`, `version`, `isRequired`

### Document Signature
- `id`, `memberId`, `documentId`, `signatureData` (base64), `signedAt`, `ipAddress`

### Staff Salary Record (Super Admin only)
- `id`, `staffId`, `month`, `year`, `amount`, `currency`
- `status`: PENDING | PAID
- `paidAt`, `notes`

## QR Check-in Flow

1. Admin generates a gym QR code (signed token or rotating code)
2. Member scans QR with mobile app -> calls `POST /attendance/check-in`
3. Backend validates QR, checks member has active subscription (direct or via duo)
4. If valid: record attendance (idempotent per day), return success + streak info
5. If invalid/no sub: return error with reason

## API Modules

| Module | Key Endpoints | Access |
|---|---|---|
| Auth | register, login, refresh | Public |
| Users | CRUD, role management | Admin+ |
| Subscription Plans | CRUD plans | Admin+ |
| Member Subscriptions | subscribe, cancel, add duo member, status | Member (own), Admin+ (all) |
| Payments | Paystack initiate, webhook, history | Member (own), Admin+ (all) |
| Attendance | check-in (QR), history, streaks | Member (own), Admin+ (all) |
| Leaderboard | top streaks, top attendance | All authenticated |
| Trainers | profiles, schedules, availability | All authenticated |
| Trainer Assignments | assign/unassign members | Admin+ |
| Legal Documents | CRUD docs, sign, signing status | Admin+ (manage), Member (sign) |
| Staff Salary | CRUD salary records, mark paid | Super Admin only |

## Mobile App Screens

- Login / Register
- Legal Docs (view + draw signature)
- Home (subscription status, streak, quick check-in)
- QR Scanner (camera-based, success/error result)
- Subscription (view plans, pay via Paystack, manage duo member)
- Attendance History (calendar view)
- Leaderboard (top streakers, member rank)
- Trainer (assigned trainer profile, schedule)
- Profile (edit info, change password)

## Admin Dashboard Pages

- Dashboard (overview stats)
- Members (list, search, view/edit, subscription status)
- Subscriptions (plans CRUD, active subscriptions, duo linkages)
- Attendance (today's check-ins, reports)
- Trainers (roster, schedules, assignments)
- Legal Docs (manage documents, signing status)
- Staff & Payroll (Super Admin only — staff list, salary records)
- QR Management (generate/rotate entrance QR)
- Settings (Super Admin — gym info, admin accounts)

## Tech Stack

- **API**: NestJS + Prisma + PostgreSQL
- **Mobile**: Expo (React Native)
- **Admin**: Next.js
- **Auth**: JWT (access + refresh tokens)
- **Payments**: Paystack (M-Pesa support for Kenya)

## Project Structure — Separate Repos

```
gym-management/    — NestJS API + Prisma + PostgreSQL (this repo)
gym-admin/         — Next.js admin dashboard (separate repo)
gym-mobile/        — Expo mobile app (separate repo)
```

Each project is independent. The API is the source of truth. Admin and mobile are clients that consume the API. Types are defined in each project as needed.

## Authentication

- Email + password for all users
- JWT-based with access + refresh tokens
- Role-based guards: @Roles('SUPER_ADMIN'), @Roles('ADMIN'), etc.
- Ownership guards for member-specific data

## Gamification

- Streak counter: consecutive days attended, resets on missed day
- Milestone badges at 7, 30, 100 days
- Leaderboard: top attendees visible to all members
