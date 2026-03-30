# Account Deletion Request Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow members to request account deletion, which admins review and approve/reject via the dashboard.

**Architecture:** New `AccountDeletionRequest` Prisma model with `DeletionRequestStatus` enum. Member endpoints live in `auth/` (self-service). Admin endpoints live in `users/` (user management). Approval triggers existing soft-delete (`deletedAt` on User).

**Tech Stack:** NestJS, Prisma, Jest + jest-mock-extended

---

### Task 1: Prisma Schema — Add DeletionRequestStatus Enum and AccountDeletionRequest Model

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add the enum and model to the schema**

Add after the existing enums (around line 45):

```prisma
enum DeletionRequestStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELLED
}
```

Add after the `User` model (after line 157):

```prisma
model AccountDeletionRequest {
  id           String                @id @default(uuid())
  userId       String
  user         User                  @relation(fields: [userId], references: [id])
  reason       String?
  status       DeletionRequestStatus @default(PENDING)
  reviewedById String?
  reviewedBy   User?                 @relation("DeletionRequestReviewer", fields: [reviewedById], references: [id])
  reviewedAt   DateTime?
  createdAt    DateTime              @default(now())
  updatedAt    DateTime              @updatedAt
}
```

Add to the `User` model (before the closing `}`):

```prisma
  deletionRequests         AccountDeletionRequest[]
  reviewedDeletionRequests AccountDeletionRequest[] @relation("DeletionRequestReviewer")
```

**Step 2: Generate migration**

Run: `npx prisma migrate dev --name add_account_deletion_request`
Expected: Migration created and applied successfully.

**Step 3: Verify Prisma client generation**

Run: `npx prisma generate`
Expected: Prisma Client generated successfully.

**Step 4: Commit**

```bash
git add prisma/
git commit -m "feat: add AccountDeletionRequest model and DeletionRequestStatus enum"
```

---

### Task 2: DTOs — Create Request/Response DTOs

**Files:**
- Create: `src/auth/dto/create-deletion-request.dto.ts`
- Create: `src/auth/dto/deletion-request-response.dto.ts`
- Create: `src/users/dto/deletion-requests-query.dto.ts`
- Create: `src/users/dto/reject-deletion-request.dto.ts`

**Step 1: Create the member submission DTO**

`src/auth/dto/create-deletion-request.dto.ts`:

```typescript
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDeletionRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
```

**Step 2: Create the response DTO**

`src/auth/dto/deletion-request-response.dto.ts`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DeletionRequestUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty()
  email: string;
}

export class DeletionRequestResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiPropertyOptional()
  reason?: string;

  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] })
  status: string;

  @ApiPropertyOptional()
  reviewedById?: string;

  @ApiPropertyOptional()
  reviewedAt?: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class DeletionRequestWithUserResponseDto extends DeletionRequestResponseDto {
  @ApiProperty({ type: DeletionRequestUserDto })
  user: DeletionRequestUserDto;
}

export class PaginatedDeletionRequestsResponseDto {
  @ApiProperty({ type: [DeletionRequestWithUserResponseDto] })
  data: DeletionRequestWithUserResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
```

**Step 3: Create the admin query DTO**

`src/users/dto/deletion-requests-query.dto.ts`:

```typescript
import { IsEnum, IsOptional } from 'class-validator';
import { DeletionRequestStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class DeletionRequestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(DeletionRequestStatus)
  status?: DeletionRequestStatus;
}
```

**Step 4: Create the reject DTO**

`src/users/dto/reject-deletion-request.dto.ts`:

```typescript
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectDeletionRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
```

**Step 5: Commit**

```bash
git add src/auth/dto/create-deletion-request.dto.ts src/auth/dto/deletion-request-response.dto.ts src/users/dto/deletion-requests-query.dto.ts src/users/dto/reject-deletion-request.dto.ts
git commit -m "feat: add DTOs for account deletion requests"
```

---

### Task 3: Auth Service — Member Deletion Request Methods

**Files:**
- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/auth.service.spec.ts`

**Step 1: Write the failing tests**

Add to `src/auth/auth.service.spec.ts` — new `describe('deletionRequest')` block:

```typescript
describe('requestDeletion', () => {
  it('should create a deletion request', async () => {
    prisma.accountDeletionRequest.findFirst.mockResolvedValue(null);
    prisma.accountDeletionRequest.create.mockResolvedValue({
      id: 'dr-1',
      userId: '1',
      reason: 'Moving away',
      status: 'PENDING',
      reviewedById: null,
      reviewedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await service.requestDeletion('1', { reason: 'Moving away' });
    expect(result.id).toBe('dr-1');
    expect(result.status).toBe('PENDING');
  });

  it('should throw ConflictException if pending request exists', async () => {
    prisma.accountDeletionRequest.findFirst.mockResolvedValue({
      id: 'dr-1',
      status: 'PENDING',
    } as any);

    await expect(
      service.requestDeletion('1', {}),
    ).rejects.toThrow(ConflictException);
  });
});

describe('getDeletionRequest', () => {
  it('should return the latest deletion request for user', async () => {
    prisma.accountDeletionRequest.findFirst.mockResolvedValue({
      id: 'dr-1',
      userId: '1',
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await service.getDeletionRequest('1');
    expect(result).toBeDefined();
    expect(result!.id).toBe('dr-1');
  });

  it('should return null if no deletion request exists', async () => {
    prisma.accountDeletionRequest.findFirst.mockResolvedValue(null);

    const result = await service.getDeletionRequest('1');
    expect(result).toBeNull();
  });
});

describe('cancelDeletionRequest', () => {
  it('should cancel a pending deletion request', async () => {
    prisma.accountDeletionRequest.findFirst.mockResolvedValue({
      id: 'dr-1',
      userId: '1',
      status: 'PENDING',
    } as any);
    prisma.accountDeletionRequest.update.mockResolvedValue({
      id: 'dr-1',
      status: 'CANCELLED',
    } as any);

    const result = await service.cancelDeletionRequest('1');
    expect(result.message).toContain('cancelled');
  });

  it('should throw NotFoundException if no pending request', async () => {
    prisma.accountDeletionRequest.findFirst.mockResolvedValue(null);

    await expect(
      service.cancelDeletionRequest('1'),
    ).rejects.toThrow(NotFoundException);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test -- --testPathPatterns=auth.service`
Expected: FAIL — methods not defined.

**Step 3: Implement the service methods**

Add to `src/auth/auth.service.ts` — import `NotFoundException` at the top (add to the existing `@nestjs/common` import), then add these methods before the `private` section:

```typescript
async requestDeletion(userId: string, dto: { reason?: string }) {
  const existing = await this.prisma.accountDeletionRequest.findFirst({
    where: { userId, status: 'PENDING' },
  });
  if (existing) {
    throw new ConflictException(
      'You already have a pending deletion request',
    );
  }

  return this.prisma.accountDeletionRequest.create({
    data: { userId, reason: dto.reason },
  });
}

async getDeletionRequest(userId: string) {
  return this.prisma.accountDeletionRequest.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

async cancelDeletionRequest(userId: string) {
  const request = await this.prisma.accountDeletionRequest.findFirst({
    where: { userId, status: 'PENDING' },
  });
  if (!request) {
    throw new NotFoundException('No pending deletion request found');
  }

  await this.prisma.accountDeletionRequest.update({
    where: { id: request.id },
    data: { status: 'CANCELLED' },
  });

  return { message: 'Deletion request cancelled successfully.' };
}
```

Also add `NotFoundException` to the imports from `@nestjs/common`.
Also import `CreateDeletionRequestDto` from `./dto/create-deletion-request.dto` (for type usage — or just use inline type as shown above).

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPatterns=auth.service`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "feat: add member deletion request service methods with tests"
```

---

### Task 4: Auth Controller — Member Endpoints

**Files:**
- Modify: `src/auth/auth.controller.ts`

**Step 1: Add the three endpoints to the auth controller**

Add imports at top:
```typescript
import { CreateDeletionRequestDto } from './dto/create-deletion-request.dto';
import { DeletionRequestResponseDto } from './dto/deletion-request-response.dto';
```

Add `Delete` to the `@nestjs/common` import.

Add these endpoints after the `logout` method:

```typescript
@Post('delete-request')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiCreatedResponse({
  type: DeletionRequestResponseDto,
  description: 'Deletion request submitted',
})
@ApiConflictResponse({ description: 'Pending request already exists' })
requestDeletion(
  @CurrentUser('id') userId: string,
  @Body() dto: CreateDeletionRequestDto,
) {
  return this.authService.requestDeletion(userId, dto);
}

@Get('delete-request')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiOkResponse({
  type: DeletionRequestResponseDto,
  description: 'Current deletion request status',
})
getDeletionRequest(@CurrentUser('id') userId: string) {
  return this.authService.getDeletionRequest(userId);
}

@Delete('delete-request')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiOkResponse({
  type: MessageResponseDto,
  description: 'Deletion request cancelled',
})
cancelDeletionRequest(@CurrentUser('id') userId: string) {
  return this.authService.cancelDeletionRequest(userId);
}
```

**Step 2: Verify lint passes**

Run: `yarn lint`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/auth/auth.controller.ts
git commit -m "feat: add member deletion request endpoints to auth controller"
```

---

### Task 5: Users Service — Admin Deletion Request Methods

**Files:**
- Modify: `src/users/users.service.ts`
- Modify: `src/users/users.service.spec.ts`

**Step 1: Write the failing tests**

Add to `src/users/users.service.spec.ts` — new describe blocks:

```typescript
describe('findAllDeletionRequests', () => {
  it('should return paginated deletion requests', async () => {
    const mockRequests = [
      {
        id: 'dr-1',
        userId: 'user-1',
        reason: 'Moving away',
        status: 'PENDING',
        reviewedById: null,
        reviewedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: 'user-1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@test.com',
        },
      },
    ];
    prisma.accountDeletionRequest.findMany.mockResolvedValue(mockRequests as any);
    prisma.accountDeletionRequest.count.mockResolvedValue(1);

    const result = await service.findAllDeletionRequests(1, 20);
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('should filter by status', async () => {
    prisma.accountDeletionRequest.findMany.mockResolvedValue([]);
    prisma.accountDeletionRequest.count.mockResolvedValue(0);

    await service.findAllDeletionRequests(1, 20, 'PENDING' as any);
    expect(prisma.accountDeletionRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING' },
      }),
    );
  });
});

describe('approveDeletionRequest', () => {
  it('should approve request and soft-delete user', async () => {
    prisma.accountDeletionRequest.findUnique.mockResolvedValue({
      id: 'dr-1',
      userId: 'user-1',
      status: 'PENDING',
    } as any);
    prisma.$transaction.mockResolvedValue([{}, {}] as any);

    const result = await service.approveDeletionRequest('dr-1', 'admin-1');
    expect(result.message).toContain('approved');
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('should throw NotFoundException if request not found', async () => {
    prisma.accountDeletionRequest.findUnique.mockResolvedValue(null);

    await expect(
      service.approveDeletionRequest('nonexistent', 'admin-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('should throw BadRequestException if request is not PENDING', async () => {
    prisma.accountDeletionRequest.findUnique.mockResolvedValue({
      id: 'dr-1',
      status: 'APPROVED',
    } as any);

    await expect(
      service.approveDeletionRequest('dr-1', 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('rejectDeletionRequest', () => {
  it('should reject a pending request', async () => {
    prisma.accountDeletionRequest.findUnique.mockResolvedValue({
      id: 'dr-1',
      status: 'PENDING',
    } as any);
    prisma.accountDeletionRequest.update.mockResolvedValue({
      id: 'dr-1',
      status: 'REJECTED',
    } as any);

    const result = await service.rejectDeletionRequest('dr-1', 'admin-1');
    expect(result.message).toContain('rejected');
  });

  it('should throw NotFoundException if request not found', async () => {
    prisma.accountDeletionRequest.findUnique.mockResolvedValue(null);

    await expect(
      service.rejectDeletionRequest('nonexistent', 'admin-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('should throw BadRequestException if request is not PENDING', async () => {
    prisma.accountDeletionRequest.findUnique.mockResolvedValue({
      id: 'dr-1',
      status: 'APPROVED',
    } as any);

    await expect(
      service.rejectDeletionRequest('dr-1', 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test -- --testPathPatterns=users.service`
Expected: FAIL — methods not defined.

**Step 3: Implement the service methods**

Add `BadRequestException` to the `@nestjs/common` import in `src/users/users.service.ts`. Import `DeletionRequestStatus` from `@prisma/client` (add to existing import).

Add these methods after `findBirthdays()`:

```typescript
async findAllDeletionRequests(
  page: number = 1,
  limit: number = 20,
  status?: DeletionRequestStatus,
) {
  const where = status ? { status } : {};
  const [data, total] = await Promise.all([
    this.prisma.accountDeletionRequest.findMany({
      where,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    this.prisma.accountDeletionRequest.count({ where }),
  ]);
  return { data, total, page, limit };
}

async approveDeletionRequest(requestId: string, reviewerId: string) {
  const request = await this.prisma.accountDeletionRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) {
    throw new NotFoundException('Deletion request not found');
  }
  if (request.status !== 'PENDING') {
    throw new BadRequestException('Request is not pending');
  }

  await this.prisma.$transaction([
    this.prisma.accountDeletionRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
    }),
    this.prisma.user.update({
      where: { id: request.userId },
      data: { deletedAt: new Date() },
    }),
  ]);

  return { message: 'Deletion request approved. User account has been deleted.' };
}

async rejectDeletionRequest(requestId: string, reviewerId: string) {
  const request = await this.prisma.accountDeletionRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) {
    throw new NotFoundException('Deletion request not found');
  }
  if (request.status !== 'PENDING') {
    throw new BadRequestException('Request is not pending');
  }

  await this.prisma.accountDeletionRequest.update({
    where: { id: requestId },
    data: {
      status: 'REJECTED',
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
  });

  return { message: 'Deletion request rejected.' };
}
```

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPatterns=users.service`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/users/users.service.ts src/users/users.service.spec.ts
git commit -m "feat: add admin deletion request service methods with tests"
```

---

### Task 6: Users Controller — Admin Endpoints

**Files:**
- Modify: `src/users/users.controller.ts`

**Step 1: Add the admin endpoints**

Add imports:
```typescript
import { DeletionRequestsQueryDto } from './dto/deletion-requests-query.dto';
import { RejectDeletionRequestDto } from './dto/reject-deletion-request.dto';
import {
  PaginatedDeletionRequestsResponseDto,
  DeletionRequestWithUserResponseDto,
} from '../auth/dto/deletion-request-response.dto';
import { MessageResponseDto } from '../common/dto/message-response.dto';
```

Add these endpoints before the `@Get(':id/profile')` route (to avoid `:id` param matching `deletion-requests`):

```typescript
@Get('deletion-requests')
@ApiOkResponse({ type: PaginatedDeletionRequestsResponseDto })
findAllDeletionRequests(@Query() query: DeletionRequestsQueryDto) {
  return this.usersService.findAllDeletionRequests(
    query.page,
    query.limit,
    query.status,
  );
}

@Patch('deletion-requests/:id/approve')
@ApiOkResponse({ type: MessageResponseDto, description: 'Request approved, user soft-deleted' })
@ApiNotFoundResponse({ description: 'Request not found' })
approveDeletionRequest(
  @Param('id') id: string,
  @CurrentUser('id') reviewerId: string,
) {
  return this.usersService.approveDeletionRequest(id, reviewerId);
}

@Patch('deletion-requests/:id/reject')
@ApiOkResponse({ type: MessageResponseDto, description: 'Request rejected' })
@ApiNotFoundResponse({ description: 'Request not found' })
rejectDeletionRequest(
  @Param('id') id: string,
  @CurrentUser('id') reviewerId: string,
  @Body() dto: RejectDeletionRequestDto,
) {
  return this.usersService.rejectDeletionRequest(id, reviewerId);
}
```

**Step 2: Verify lint passes**

Run: `yarn lint`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/users/users.controller.ts
git commit -m "feat: add admin deletion request endpoints to users controller"
```

---

### Task 7: Full Verification

**Step 1: Run lint**

Run: `yarn lint`
Expected: No errors.

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Run all tests**

Run: `yarn test`
Expected: All tests pass.

**Step 4: Verify Swagger**

Run: `yarn start:dev`
Check: `/api/docs` — confirm new endpoints appear under Auth and Users tags.

**Step 5: Final commit if any fixes needed**

---

### Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add account deletion to the auth module description**

In the `auth/` bullet, append: `Account deletion request flow: member submits via POST /auth/delete-request, can check status or cancel. Admin reviews via /users/deletion-requests endpoints.`

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add account deletion request to CLAUDE.md"
```
