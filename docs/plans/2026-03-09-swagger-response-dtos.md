# Swagger Response DTOs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add response DTO classes with `@ApiProperty()` decorators to all controllers so Swagger UI shows response schemas.

**Architecture:** Create response DTO classes in each module's `dto/` folder (plus `src/common/dto/` for shared ones). Add `@ApiOkResponse({ type: Dto })` and `@ApiCreatedResponse({ type: Dto })` decorators to every controller method. No behavior changes — pure Swagger metadata.

**Tech Stack:** NestJS `@nestjs/swagger` (`@ApiProperty`, `@ApiOkResponse`, `@ApiCreatedResponse`)

---

### Task 1: Common Response DTOs

**Files:**
- Create: `src/common/dto/message-response.dto.ts`
- Create: `src/common/dto/paginated-response.dto.ts`

**Step 1: Create MessageResponseDto**

```typescript
// src/common/dto/message-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty({ example: 'Operation completed successfully' })
  message: string;
}
```

**Step 2: Create PaginatedResponseDto**

```typescript
// src/common/dto/paginated-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class PaginatedResponseDto<T> {
  data: T[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
```

---

### Task 2: Auth Response DTOs + Controller

**Files:**
- Create: `src/auth/dto/token-response.dto.ts`
- Modify: `src/auth/auth.controller.ts`

**Step 1: Create TokenResponseDto**

```typescript
// src/auth/dto/token-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...' })
  refreshToken: string;
}
```

**Step 2: Add `@ApiOkResponse` / `@ApiCreatedResponse` to auth controller**

- `register` → `@ApiCreatedResponse({ type: TokenResponseDto })`
- `login` → `@ApiOkResponse({ type: TokenResponseDto })`
- `forgotPassword` → `@ApiOkResponse({ type: MessageResponseDto })`
- `resetPassword` → `@ApiOkResponse({ type: MessageResponseDto })`
- `changePassword` → `@ApiOkResponse({ type: MessageResponseDto })`
- `logout` → `@ApiOkResponse({ type: MessageResponseDto })`

---

### Task 3: User Response DTOs + Controller

**Files:**
- Create: `src/users/dto/user-response.dto.ts`
- Create: `src/users/dto/paginated-users-response.dto.ts`
- Modify: `src/users/users.controller.ts`

**Step 1: Create UserResponseDto** (excludes password)

```typescript
// src/users/dto/user-response.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'admin@gym.co.ke' })
  email: string;

  @ApiPropertyOptional({ example: '+254700000000' })
  phone?: string;

  @ApiProperty({ example: 'John' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({ enum: ['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'MEMBER'] })
  role: string;

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] })
  status: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
```

**Step 2: Create PaginatedUsersResponseDto**

```typescript
// src/users/dto/paginated-users-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';

export class PaginatedUsersResponseDto {
  @ApiProperty({ type: [UserResponseDto] })
  data: UserResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
```

**Step 3: Add response decorators to users controller**

- `findAll` → `@ApiOkResponse({ type: PaginatedUsersResponseDto })`
- `findOne` → `@ApiOkResponse({ type: UserResponseDto })`
- `update` → `@ApiOkResponse({ type: UserResponseDto })`
- `remove` → `@ApiOkResponse({ type: UserResponseDto })`

---

### Task 4: Subscription Plan Response DTOs + Controller

**Files:**
- Create: `src/subscription-plans/dto/subscription-plan-response.dto.ts`
- Create: `src/subscription-plans/dto/paginated-plans-response.dto.ts`
- Modify: `src/subscription-plans/subscription-plans.controller.ts`

---

### Task 5: Subscription Response DTOs + Controller

**Files:**
- Create: `src/subscriptions/dto/subscription-response.dto.ts`
- Create: `src/subscriptions/dto/subscription-member-response.dto.ts`
- Modify: `src/subscriptions/subscriptions.controller.ts`

---

### Task 6: Payment Response DTOs + Controller

**Files:**
- Create: `src/payments/dto/payment-init-response.dto.ts`
- Create: `src/payments/dto/payment-response.dto.ts`
- Create: `src/payments/dto/paginated-payments-response.dto.ts`
- Create: `src/payments/dto/webhook-response.dto.ts`
- Modify: `src/payments/payments.controller.ts`

---

### Task 7: Attendance Response DTOs + Controller

**Files:**
- Create: `src/attendance/dto/check-in-response.dto.ts`
- Create: `src/attendance/dto/attendance-response.dto.ts`
- Create: `src/attendance/dto/streak-response.dto.ts`
- Create: `src/attendance/dto/leaderboard-entry-response.dto.ts`
- Modify: `src/attendance/attendance.controller.ts`

---

### Task 8: QR Code Response DTOs + Controller

**Files:**
- Create: `src/qr/dto/qr-code-response.dto.ts`
- Modify: `src/qr/qr.controller.ts`

---

### Task 9: Trainer Response DTOs + Controller

**Files:**
- Create: `src/trainers/dto/trainer-profile-response.dto.ts`
- Create: `src/trainers/dto/trainer-schedule-response.dto.ts`
- Create: `src/trainers/dto/trainer-assignment-response.dto.ts`
- Create: `src/trainers/dto/paginated-trainers-response.dto.ts`
- Modify: `src/trainers/trainers.controller.ts`

---

### Task 10: Legal Response DTOs + Controller

**Files:**
- Create: `src/legal/dto/legal-document-response.dto.ts`
- Create: `src/legal/dto/document-signature-response.dto.ts`
- Create: `src/legal/dto/paginated-documents-response.dto.ts`
- Modify: `src/legal/legal.controller.ts`

---

### Task 11: Salary Response DTOs + Controller

**Files:**
- Create: `src/salary/dto/salary-record-response.dto.ts`
- Modify: `src/salary/salary.controller.ts`

---

### Task 12: Analytics Response DTOs + Controller

**Files:**
- Create: `src/analytics/dto/dashboard-response.dto.ts`
- Create: `src/analytics/dto/revenue-trends-response.dto.ts`
- Create: `src/analytics/dto/attendance-trends-response.dto.ts`
- Create: `src/analytics/dto/subscription-trends-response.dto.ts`
- Create: `src/analytics/dto/member-trends-response.dto.ts`
- Modify: `src/analytics/analytics.controller.ts`

---

### Task 13: Verify

**Step 1:** Run `yarn build` — should compile with no errors
**Step 2:** Run `yarn start:dev`, visit `http://localhost:3000/api/docs`
**Step 3:** Verify response schemas appear for all endpoints
**Step 4:** Run `yarn test` — all existing tests should still pass

### Task 14: Commit

```bash
git add .
git commit -m "docs(swagger): add response DTOs to all controllers for Swagger UI"
```
