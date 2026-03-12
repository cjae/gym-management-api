# Backend Notifications Module — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a notifications module to the NestJS API with Prisma models, CRUD endpoints, push token management, and Expo Push API delivery. Hook notifications into existing billing, attendance, and subscription events.

**Architecture:** New `NotificationsModule` following the existing NestJS module pattern (controller → service → Prisma). Push delivery via Expo Push API (`https://exp.host/--/api/v2/push/send`). Notifications stored in DB and sent as push simultaneously.

**Repo:** `~/Documents/js/gym-management`

**Design Doc:** `docs/plans/2026-03-12-gym-mobile-design.md` (Notifications section)

---

## Phase 1: Prisma Models

### Task 1: Notification & PushToken Prisma Models

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add Notification and PushToken models**

Add the following to the end of `prisma/schema.prisma` (before the closing of the file):

```prisma
model Notification {
  id        String   @id @default(uuid())
  userId    String?
  title     String
  body      String
  type      String   // SUBSCRIPTION_EXPIRING, PAYMENT_REMINDER, STREAK_NUDGE, STATUS_CHANGE, GENERAL
  isRead    Boolean  @default(false)
  metadata  Json?
  createdAt DateTime @default(now())

  user User? @relation("UserNotifications", fields: [userId], references: [id])

  @@index([userId, createdAt])
}

model PushToken {
  id        String   @id @default(uuid())
  userId    String
  token     String   @unique
  platform  String   // ios, android
  createdAt DateTime @default(now())

  user User @relation("UserPushTokens", fields: [userId], references: [id])

  @@index([userId])
}
```

Also add the reverse relations on the `User` model:

```prisma
  notifications Notification[] @relation("UserNotifications")
  pushTokens    PushToken[]    @relation("UserPushTokens")
```

**Step 2: Generate migration**

```bash
npx prisma migrate dev --name add-notifications-and-push-tokens
```

**Step 3: Regenerate client**

```bash
npx prisma generate
```

**Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(notifications): add Notification and PushToken models"
```

---

## Phase 2: NestJS Module

### Task 2: Notifications NestJS Module

**Files:**
- Create: `src/notifications/notifications.module.ts`
- Create: `src/notifications/notifications.controller.ts`
- Create: `src/notifications/notifications.service.ts`
- Create: `src/notifications/dto/create-notification.dto.ts`
- Create: `src/notifications/dto/notification-response.dto.ts`
- Create: `src/notifications/dto/register-push-token.dto.ts`
- Create: `src/notifications/push-tokens.controller.ts`
- Modify: `src/app.module.ts` (add NotificationsModule to imports)

**Step 1: Create DTOs**

Create `src/notifications/dto/create-notification.dto.ts`:

```typescript
import { IsString, IsOptional, IsUUID, MaxLength, IsObject } from 'class-validator';

export class CreateNotificationDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsString()
  @MaxLength(1000)
  body: string;

  @IsString()
  @MaxLength(50)
  type: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
```

Create `src/notifications/dto/notification-response.dto.ts`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ format: 'uuid' })
  userId?: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ example: 'GENERAL' })
  type: string;

  @ApiProperty()
  isRead: boolean;

  @ApiPropertyOptional()
  metadata?: Record<string, unknown>;

  @ApiProperty()
  createdAt: Date;
}
```

Create `src/notifications/dto/register-push-token.dto.ts`:

```typescript
import { IsString, MaxLength } from 'class-validator';

export class RegisterPushTokenDto {
  @IsString()
  @MaxLength(200)
  token: string;

  @IsString()
  @MaxLength(10)
  platform: string; // ios, android
}
```

**Step 2: Create service**

Create `src/notifications/notifications.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateNotificationDto) {
    const notification = await this.prisma.notification.create({ data: dto });

    // Send push notification
    await this.sendPush(dto.userId ?? null, dto.title, dto.body, dto.metadata);

    return notification;
  }

  async findAllForUser(userId: string, page = 1, limit = 20) {
    const where = {
      OR: [{ userId }, { userId: null }], // User's notifications + broadcasts
    };

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        id,
        OR: [{ userId }, { userId: null }],
      },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        OR: [{ userId }, { userId: null }],
        isRead: false,
      },
      data: { isRead: true },
    });
  }

  async registerPushToken(userId: string, token: string, platform: string) {
    return this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async removePushToken(token: string) {
    return this.prisma.pushToken.deleteMany({ where: { token } });
  }

  private async sendPush(
    userId: string | null,
    title: string,
    body: string,
    metadata?: Record<string, unknown> | null,
  ) {
    try {
      let tokens: { token: string }[];

      if (userId) {
        tokens = await this.prisma.pushToken.findMany({
          where: { userId },
          select: { token: true },
        });
      } else {
        // Broadcast — get all push tokens
        tokens = await this.prisma.pushToken.findMany({
          select: { token: true },
        });
      }

      if (tokens.length === 0) return;

      const messages = tokens.map((t) => ({
        to: t.token,
        sound: 'default' as const,
        title,
        body,
        data: metadata ?? {},
      }));

      // Send via Expo Push API
      const chunks = this.chunkArray(messages, 100);
      for (const chunk of chunks) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chunk),
        });
      }
    } catch {
      // Silent fail — push is best-effort
    }
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
```

**Step 3: Create notifications controller**

Create `src/notifications/notifications.controller.ts`:

```typescript
import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ description: 'Notification created and pushed' })
  create(@Body() dto: CreateNotificationDto) {
    return this.notificationsService.create(dto);
  }

  @Get()
  @ApiOkResponse({ description: 'Paginated notifications for current user' })
  findAll(@CurrentUser('id') userId: string, @Query() query: PaginationQueryDto) {
    return this.notificationsService.findAllForUser(userId, query.page, query.limit);
  }

  @Patch(':id/read')
  @ApiOkResponse({ description: 'Notification marked as read' })
  markAsRead(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.notificationsService.markAsRead(id, userId);
  }

  @Patch('read-all')
  @ApiOkResponse({ description: 'All notifications marked as read' })
  markAllAsRead(@CurrentUser('id') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }
}
```

**Step 4: Create push tokens controller**

Create `src/notifications/push-tokens.controller.ts`:

```typescript
import { Controller, Post, Delete, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Push Tokens')
@ApiBearerAuth()
@Controller('push-tokens')
@UseGuards(JwtAuthGuard)
export class PushTokensController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  register(@CurrentUser('id') userId: string, @Body() dto: RegisterPushTokenDto) {
    return this.notificationsService.registerPushToken(userId, dto.token, dto.platform);
  }

  @Delete()
  remove(@Body('token') token: string) {
    return this.notificationsService.removePushToken(token);
  }
}
```

**Step 5: Create module**

Create `src/notifications/notifications.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { PushTokensController } from './push-tokens.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController, PushTokensController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

**Step 6: Register module in AppModule**

Add `NotificationsModule` to the imports array in `src/app.module.ts`.

**Step 7: Run tests and lint**

```bash
yarn test
yarn lint
```

**Step 8: Commit**

```bash
git add src/notifications/ src/app.module.ts
git commit -m "feat(notifications): add notifications module with push via Expo Push API"
```

---

## Phase 3: Event Hooks

### Task 3: Hook Notifications into Existing Events

**Files:**
- Modify: `src/attendance/attendance.service.ts` (streak nudge on 3/4 days)
- Modify: `src/attendance/attendance.module.ts` (import NotificationsModule)
- Modify: `src/subscriptions/subscriptions.service.ts` (status change notifications)
- Modify: `src/subscriptions/subscriptions.module.ts` (import NotificationsModule)
- Modify: `src/billing/billing.service.ts` (expiry + payment reminders)
- Modify: `src/billing/billing.module.ts` (import NotificationsModule)

**Step 1: Inject NotificationsService into AttendanceService**

Add to `AttendanceService` constructor:

```typescript
constructor(
  private prisma: PrismaService,
  private readonly eventEmitter: EventEmitter2,
  private readonly notificationsService: NotificationsService,
) {}
```

After the streak update in `checkIn()`, add:

```typescript
// Streak nudge: "One more day this week!"
if (streak.daysThisWeek === this.DAYS_REQUIRED_PER_WEEK - 1) {
  this.notificationsService.create({
    userId: memberId,
    title: 'Almost there!',
    body: `One more day this week to keep your ${streak.weeklyStreak}-week streak going!`,
    type: 'STREAK_NUDGE',
    metadata: { weeklyStreak: streak.weeklyStreak, daysThisWeek: streak.daysThisWeek },
  }).catch(() => {}); // Fire and forget
}
```

Update `AttendanceModule` imports to include `NotificationsModule`.

**Step 2: Add status change notification in SubscriptionsService**

After subscription status changes (freeze, unfreeze, cancel), add:

```typescript
await this.notificationsService.create({
  userId: subscription.primaryMemberId,
  title: 'Subscription Updated',
  body: `Your subscription has been ${newStatus.toLowerCase()}`,
  type: 'STATUS_CHANGE',
  metadata: { subscriptionId: subscription.id, status: newStatus },
});
```

Update `SubscriptionsModule` imports to include `NotificationsModule`.

**Step 3: Add expiry and payment reminders in BillingService**

In the daily billing cron, when finding subscriptions expiring in 7, 3, or 1 days:

```typescript
await this.notificationsService.create({
  userId: subscription.primaryMemberId,
  title: 'Subscription Expiring Soon',
  body: `Your ${subscription.plan.name} expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`,
  type: 'SUBSCRIPTION_EXPIRING',
  metadata: { subscriptionId: subscription.id, daysLeft },
});
```

For M-Pesa payment reminders:

```typescript
await this.notificationsService.create({
  userId: subscription.primaryMemberId,
  title: 'Payment Reminder',
  body: `Payment due for your ${subscription.plan.name} plan`,
  type: 'PAYMENT_REMINDER',
  metadata: { subscriptionId: subscription.id },
});
```

Update `BillingModule` imports to include `NotificationsModule`.

**Step 4: Run tests**

```bash
yarn test
```

Fix any failing tests by adding `NotificationsService` mock to test providers.

**Step 5: Commit**

```bash
git add src/
git commit -m "feat(notifications): hook notifications into attendance, subscriptions, billing"
```

---

## Phase 4: Verification

### Task 4: Backend Verification

**Step 1: Run full test suite**

```bash
yarn test
yarn lint
yarn build
```

**Step 2: Test notification endpoints manually**

```bash
# Register push token
curl -X POST http://localhost:3000/api/v1/push-tokens \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"token":"ExponentPushToken[test]","platform":"ios"}'

# Create notification (as admin)
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","body":"Hello!","type":"GENERAL"}'

# Get notifications
curl http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer <token>"
```

**Step 3: Commit any fixes**

```bash
git add .
git commit -m "fix: address issues found during backend verification"
```
