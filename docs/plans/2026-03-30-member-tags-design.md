# Member Tags & Segmentation — Design

## Overview

Member tagging system that combines automatic behavioral tags (computed daily) with manual admin-applied tags. Enables gyms to segment members by engagement patterns (dormant, at-risk, active) and custom categories (VIP, corporate).

Informational only for v1 — no automated notifications or actions triggered by tag changes.

## Data Model

### New Enums

- `TagSource`: `SYSTEM | MANUAL`

### New Models

**Tag**
- `id` (UUID, PK)
- `name` (String, unique) — e.g. "at-risk", "dormant", "VIP"
- `description` (String, optional)
- `source` (TagSource) — SYSTEM or MANUAL
- `color` (String, optional) — hex color for admin UI
- `createdAt`, `updatedAt`
- Relation: `members` → MemberTag[]

**MemberTag**
- `id` (UUID, PK)
- `memberId` (FK → User)
- `tagId` (FK → Tag)
- `assignedAt` (DateTime)
- `assignedBy` (String, optional) — admin userId for MANUAL, null for SYSTEM
- Unique constraint: `@@unique([memberId, tagId])`

### GymSettings Additions

New fields on existing GymSettings singleton:

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `newMemberDays` | Int | 14 | "new-member" if joined within X days |
| `activeDays` | Int | 7 | "active" if checked in within X days |
| `inactiveDays` | Int | 14 | "inactive" if no check-in in X+ days |
| `dormantDays` | Int | 30 | "dormant" if no check-in in X+ days |
| `atRiskDays` | Int | 14 | "at-risk" if active sub + no check-in in X+ days |
| `loyalStreakWeeks` | Int | 4 | "loyal" if weekly streak >= X weeks |

## Auto-Tag Rules

Daily cron job at 2:00 AM Africa/Nairobi. Full refresh: delete all SYSTEM MemberTag rows, recompute and insert.

| Tag | Rule |
|-----|------|
| `new-member` | `user.createdAt >= now - newMemberDays` AND role = MEMBER |
| `active` | Has Attendance where `checkInDate >= now - activeDays` |
| `inactive` | No Attendance where `checkInDate >= now - inactiveDays` |
| `dormant` | No Attendance where `checkInDate >= now - dormantDays` |
| `at-risk` | Has ACTIVE subscription AND no Attendance where `checkInDate >= now - atRiskDays` |
| `expired` | Has EXPIRED subscription, no ACTIVE subscription |
| `loyal` | Streak.weeklyStreak >= loyalStreakWeeks |
| `frozen` | Has subscription with status FROZEN |

System tags are auto-created on first cron run if they don't exist.

## Endpoints

### Tag Management (ADMIN+)

- `GET /tags` — list all tags, filterable by `?source=SYSTEM|MANUAL`
- `POST /tags` — create manual tag (`{ name, description?, color? }`)
- `PATCH /tags/:id` — update manual tag (blocks SYSTEM tags)
- `DELETE /tags/:id` — delete manual tag + MemberTag rows (SUPER_ADMIN only, blocks SYSTEM tags)

### Tag Assignment (ADMIN+)

- `POST /tags/:tagId/members` — assign manual tag to members (`{ memberIds: string[] }`)
- `DELETE /tags/:tagId/members/:memberId` — remove manual tag from member

### Tag Summary (ADMIN+)

- `GET /tags/summary` — counts per tag, e.g. `{ "at-risk": 12, "dormant": 5 }`

### Integration with GET /users

- New query param: `?tags=at-risk,dormant` — filters users who have ALL specified tags
- New field in user response: `tags: [{ name, source, color }]`

## Feature Gating

Gated behind `member-tags` feature key via `@RequiresFeature('member-tags')`. Follows existing licensing pattern.

## Module Structure

Standard NestJS module: `src/member-tags/`
- `member-tags.module.ts`
- `member-tags.controller.ts`
- `member-tags.service.ts`
- `dto/` — CreateTagDto, UpdateTagDto, AssignTagDto, TagQueryDto
- `member-tags.service.spec.ts`

## Scope Exclusions (v1)

- No automated notifications on tag change
- No tag-based targeting for broadcasts (future enhancement)
- No tag history/audit trail
- No bulk manual tag operations beyond assign
