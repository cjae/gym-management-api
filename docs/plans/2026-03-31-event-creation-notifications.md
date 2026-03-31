# Event Creation Notifications — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Notify all MEMBER users when an admin creates a new event with `notifyMembers: true`.

**Architecture:** Add `notifyMembers` boolean to `CreateEventDto` (default `false`). After event creation, if flag is true, query all MEMBER users and create a targeted notification per member via existing `NotificationsService`. Follows the same fire-and-forget pattern used by `notifyEventUpdate()` and `notifyCancellation()`.

**Tech Stack:** NestJS 11, Prisma 6, class-validator, @nestjs/swagger, Jest + jest-mock-extended

---

### Task 1: Add `notifyMembers` field to CreateEventDto

**Files:**
- Modify: `src/events/dto/create-event.dto.ts`

**Step 1: Add the field**

Add after the `maxCapacity` field (line 62):

```typescript
  @ApiPropertyOptional({
    example: false,
    description: 'Send notification to all members about this event',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  notifyMembers?: boolean;
```

Import `IsBoolean` from `class-validator`.

**Step 2: Verify lint passes**

Run: `yarn lint`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/events/dto/create-event.dto.ts
git commit -m "feat(events): add notifyMembers flag to CreateEventDto"
```

---

### Task 2: Add `notifyNewEvent` method and call it from `create()`

**Files:**
- Modify: `src/events/events.service.ts`

**Step 1: Update `create()` method**

Replace the `create` method (lines 35-55) with:

```typescript
  async create(dto: CreateEventDto) {
    const eventDate = new Date(dto.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (eventDate < today) {
      throw new BadRequestException('Cannot create an event in the past');
    }

    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        date: eventDate,
        startTime: dto.startTime,
        endTime: dto.endTime,
        location: dto.location,
        maxCapacity: dto.maxCapacity ?? 50,
      },
    });

    if (dto.notifyMembers) {
      this.notifyNewEvent(event);
    }

    return event;
  }
```

**Step 2: Add `notifyNewEvent` private method**

Add after the `notifyCancellation` method (after line 381):

```typescript
  private async notifyNewEvent(event: {
    id: string;
    title: string;
    date: Date;
    startTime: string;
    location: string | null;
  }) {
    const members = await this.prisma.user.findMany({
      where: { role: 'MEMBER', deletedAt: null },
      select: { id: true },
    });

    const date = event.date.toISOString().split('T')[0];

    for (const member of members) {
      this.notificationsService
        .create({
          userId: member.id,
          title: `New Event: ${event.title}`,
          body: `${date} at ${event.startTime} — ${event.location || 'TBA'}`,
          type: NotificationType.EVENT_UPDATE,
          metadata: { eventId: event.id },
        })
        .catch((err) =>
          this.logger.error(
            `Failed to create new event notification: ${err.message}`,
          ),
        );
    }
  }
```

**Step 3: Verify lint + types pass**

Run: `yarn lint && npx tsc --noEmit`
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/events/events.service.ts
git commit -m "feat(events): notify all members on new event creation"
```

---

### Task 3: Add unit tests

**Files:**
- Modify: `src/events/events.service.spec.ts`

**Step 1: Add three tests inside the existing `describe('create', ...)` block**

Add after the existing "should throw BadRequestException for past date" test (after line 96):

```typescript
    it('should notify all members when notifyMembers is true', async () => {
      prisma.event.create.mockResolvedValue(mockEvent as any);
      prisma.user.findMany.mockResolvedValue([
        { id: 'member-1' },
        { id: 'member-2' },
      ] as any);

      await service.create({
        title: 'Outdoor Bootcamp',
        date: '2026-05-01',
        startTime: '09:00',
        endTime: '11:00',
        location: 'Uhuru Park',
        notifyMembers: true,
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { role: 'MEMBER', deletedAt: null },
        select: { id: true },
      });
      expect(notificationsService.create).toHaveBeenCalledTimes(2);
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'member-1',
          title: 'New Event: Outdoor Bootcamp',
          type: 'EVENT_UPDATE',
        }),
      );
    });

    it('should not notify members when notifyMembers is false', async () => {
      prisma.event.create.mockResolvedValue(mockEvent as any);

      await service.create({
        title: 'Outdoor Bootcamp',
        date: '2026-05-01',
        startTime: '09:00',
        endTime: '11:00',
        notifyMembers: false,
      });

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('should not block event creation if notification fails', async () => {
      prisma.event.create.mockResolvedValue(mockEvent as any);
      prisma.user.findMany.mockResolvedValue([{ id: 'member-1' }] as any);
      notificationsService.create.mockRejectedValue(
        new Error('Push failed'),
      );

      const result = await service.create({
        title: 'Outdoor Bootcamp',
        date: '2026-05-01',
        startTime: '09:00',
        endTime: '11:00',
        location: 'Uhuru Park',
        notifyMembers: true,
      });

      expect(result).toEqual(mockEvent);
    });
```

**Step 2: Run tests**

Run: `npx jest src/events/events.service.spec.ts`
Expected: All tests pass (existing + 3 new)

**Step 3: Run full test suite**

Run: `yarn test`
Expected: All 432+ tests pass

**Step 4: Commit**

```bash
git add src/events/events.service.spec.ts
git commit -m "test(events): add tests for new event notification"
```
