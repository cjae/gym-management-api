# Swagger Docs + Sentry Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Swagger API docs at `/api/docs` and Sentry error + performance tracking to the gym management API.

**Architecture:** Swagger uses `@nestjs/swagger` with manual `@ApiProperty()` on DTOs and `@ApiTags`/`@ApiBearerAuth`/`@ApiResponse` on controllers. Sentry uses `@sentry/nestjs` with `instrument.ts` loaded first in `main.ts`, `SentryModule.forRoot()` in `app.module.ts`, and `SentryGlobalFilter` for exception capture.

**Tech Stack:** `@nestjs/swagger`, `@sentry/nestjs`, `@sentry/profiling-node`

---

### Task 1: Install Swagger dependencies and configure

**Files:**
- Modify: `package.json`
- Modify: `nest-cli.json`
- Modify: `src/main.ts`

**Step 1: Install @nestjs/swagger**

Run: `yarn add @nestjs/swagger`

**Step 2: Configure nest-cli.json with Swagger plugin**

Replace `nest-cli.json` with:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "plugins": [
      {
        "name": "@nestjs/swagger",
        "options": {
          "classValidatorShim": true,
          "introspectComments": true
        }
      }
    ]
  }
}
```

**Step 3: Add Swagger setup to main.ts**

Update `src/main.ts` to:

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: [process.env.ADMIN_URL || 'http://localhost:3001'], credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Gym Management API')
    .setDescription('API for gym management platform — subscriptions, attendance, payments, trainers, and more.')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
```

**Step 4: Verify Swagger UI loads**

Run: `yarn start:dev`
Open: `http://localhost:3000/api/docs`
Expected: Swagger UI with all endpoints listed (undecorated, but present)

**Step 5: Commit**

```bash
git add package.json yarn.lock nest-cli.json src/main.ts
git commit -m "feat: add Swagger setup with DocumentBuilder and CLI plugin"
```

---

### Task 2: Add Swagger decorators to Auth module

**Files:**
- Modify: `src/auth/auth.controller.ts`
- Modify: `src/auth/dto/register.dto.ts`
- Modify: `src/auth/dto/login.dto.ts`

**Step 1: Add `@ApiProperty()` to RegisterDto**

Update `src/auth/dto/register.dto.ts` — add `@ApiProperty()` to each field, `@ApiPropertyOptional()` for optional fields. Import from `@nestjs/swagger`.

```typescript
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  lastName: string;

  @ApiPropertyOptional({ example: '+254700000000' })
  @IsOptional()
  @IsString()
  phone?: string;
}
```

**Step 2: Add `@ApiProperty()` to LoginDto**

Update `src/auth/dto/login.dto.ts`:

```typescript
import { IsEmail, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  password: string;
}
```

**Step 3: Add Swagger decorators to AuthController**

Update `src/auth/auth.controller.ts`:

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiConflictResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @ApiConflictResponse({ description: 'Email already registered' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
```

**Step 4: Verify in Swagger UI**

Run: `yarn start:dev`
Open: `http://localhost:3000/api/docs`
Expected: Auth section shows register/login with request body schemas and error responses

**Step 5: Commit**

```bash
git add src/auth/
git commit -m "feat: add Swagger decorators to auth module"
```

---

### Task 3: Add Swagger decorators to Users module

**Files:**
- Modify: `src/users/users.controller.ts`
- Modify: `src/users/dto/update-user.dto.ts`

**Step 1: Add `@ApiPropertyOptional()` to UpdateUserDto**

Read `src/users/dto/update-user.dto.ts` first, then add `@ApiPropertyOptional()` to each field.

**Step 2: Add Swagger decorators to UsersController**

```typescript
import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiNotFoundResponse } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @ApiNotFoundResponse({ description: 'User not found' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiNotFoundResponse({ description: 'User not found' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @ApiNotFoundResponse({ description: 'User not found' })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
```

**Step 3: Commit**

```bash
git add src/users/
git commit -m "feat: add Swagger decorators to users module"
```

---

### Task 4: Add Swagger decorators to Subscription Plans module

**Files:**
- Modify: `src/subscription-plans/subscription-plans.controller.ts`
- Modify: `src/subscription-plans/dto/create-plan.dto.ts`
- Modify: `src/subscription-plans/dto/update-plan.dto.ts`

**Step 1: Add `@ApiProperty()` to CreatePlanDto and UpdatePlanDto**

Read both DTOs first, then add `@ApiProperty()` / `@ApiPropertyOptional()` with examples to each field.

**Step 2: Add Swagger decorators to SubscriptionPlansController**

Add `@ApiTags('Subscription Plans')`, `@ApiBearerAuth()`, and `@ApiNotFoundResponse()` on `:id` endpoints.

**Step 3: Commit**

```bash
git add src/subscription-plans/
git commit -m "feat: add Swagger decorators to subscription-plans module"
```

---

### Task 5: Add Swagger decorators to Subscriptions module

**Files:**
- Modify: `src/subscriptions/subscriptions.controller.ts`
- Modify: `src/subscriptions/dto/create-subscription.dto.ts`
- Modify: `src/subscriptions/dto/add-duo-member.dto.ts`

**Step 1: Add `@ApiProperty()` to both DTOs**

Read both DTOs first, add `@ApiProperty()` with examples.

**Step 2: Add Swagger decorators to SubscriptionsController**

Add `@ApiTags('Subscriptions')`, `@ApiBearerAuth()`. Add error responses per endpoint:
- `addDuoMember`: `@ApiNotFoundResponse`, `@ApiForbiddenResponse`, `@ApiBadRequestResponse`
- `cancel`: `@ApiNotFoundResponse`, `@ApiForbiddenResponse`

**Step 3: Commit**

```bash
git add src/subscriptions/
git commit -m "feat: add Swagger decorators to subscriptions module"
```

---

### Task 6: Add Swagger decorators to Payments module

**Files:**
- Modify: `src/payments/payments.controller.ts`

**Step 1: Add Swagger decorators to PaymentsController**

Add `@ApiTags('Payments')`. Per-endpoint:
- `initialize`: `@ApiBearerAuth()`, `@ApiBadRequestResponse({ description: 'Subscription not found' })`
- `webhook`: `@ApiExcludeEndpoint()` (webhooks should not appear in public docs) OR `@ApiHeader({ name: 'x-paystack-signature' })`
- `history`: `@ApiBearerAuth()`

Decision: Include webhook in docs with `@ApiHeader` so admins can see the contract.

```typescript
import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiBadRequestResponse, ApiHeader } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('initialize/:subscriptionId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiBadRequestResponse({ description: 'Subscription not found' })
  initialize(
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('email') email: string,
  ) {
    return this.paymentsService.initializePayment(subscriptionId, email);
  }

  @Post('webhook')
  @ApiHeader({ name: 'x-paystack-signature', description: 'HMAC SHA512 signature from Paystack' })
  @ApiBadRequestResponse({ description: 'Invalid signature' })
  webhook(
    @Body() body: any,
    @Headers('x-paystack-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(body, signature);
  }

  @Get('history')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  history(@CurrentUser('id') memberId: string) {
    return this.paymentsService.getPaymentHistory(memberId);
  }
}
```

**Step 2: Commit**

```bash
git add src/payments/
git commit -m "feat: add Swagger decorators to payments module"
```

---

### Task 7: Add Swagger decorators to Attendance module

**Files:**
- Modify: `src/attendance/attendance.controller.ts`
- Modify: `src/attendance/dto/check-in.dto.ts`

**Step 1: Add `@ApiProperty()` to CheckInDto**

Read DTO first, add `@ApiProperty({ example: '...' })`.

**Step 2: Add Swagger decorators to AttendanceController**

Add `@ApiTags('Attendance')`, `@ApiBearerAuth()`. Error responses:
- `checkIn`: `@ApiBadRequestResponse({ description: 'Invalid or expired QR code' })`, `@ApiForbiddenResponse({ description: 'No active subscription' })`

**Step 3: Commit**

```bash
git add src/attendance/
git commit -m "feat: add Swagger decorators to attendance module"
```

---

### Task 8: Add Swagger decorators to QR, Trainers, Legal, Salary modules

**Files:**
- Modify: `src/qr/qr.controller.ts`
- Modify: `src/trainers/trainers.controller.ts`
- Modify: `src/trainers/dto/create-trainer-profile.dto.ts`
- Modify: `src/trainers/dto/create-schedule.dto.ts`
- Modify: `src/trainers/dto/assign-member.dto.ts`
- Modify: `src/legal/legal.controller.ts`
- Modify: `src/legal/dto/create-document.dto.ts`
- Modify: `src/legal/dto/sign-document.dto.ts`
- Modify: `src/salary/salary.controller.ts`
- Modify: `src/salary/dto/create-salary-record.dto.ts`

**Step 1: Read all DTOs and controllers listed above**

**Step 2: Add `@ApiProperty()` / `@ApiPropertyOptional()` to all DTOs**

Each DTO gets `@ApiProperty()` with example values on every field. Optional fields get `@ApiPropertyOptional()`.

**Step 3: Add controller decorators**

- **QrController**: `@ApiTags('QR Codes')`, `@ApiBearerAuth()`
- **TrainersController**: `@ApiTags('Trainers')`, `@ApiBearerAuth()`
- **LegalController**: `@ApiTags('Legal Documents')`, `@ApiBearerAuth()`. Sign endpoint: `@ApiNotFoundResponse`, `@ApiConflictResponse({ description: 'Document already signed' })`
- **SalaryController**: `@ApiTags('Salary')`, `@ApiBearerAuth()`. findAll: `@ApiQuery({ name: 'month', required: false })`, `@ApiQuery({ name: 'year', required: false })`

**Step 4: Commit**

```bash
git add src/qr/ src/trainers/ src/legal/ src/salary/
git commit -m "feat: add Swagger decorators to qr, trainers, legal, salary modules"
```

---

### Task 9: Verify all Swagger docs render correctly

**Step 1: Start dev server**

Run: `yarn start:dev`

**Step 2: Open Swagger UI**

Open: `http://localhost:3000/api/docs`

**Step 3: Verify checklist**

- [ ] All 11 tags visible in sidebar (Auth, Users, Subscription Plans, Subscriptions, Payments, Attendance, QR Codes, Trainers, Legal Documents, Salary, plus default)
- [ ] Auth endpoints show request body schemas with examples
- [ ] Protected endpoints show lock icon (Bearer auth)
- [ ] Error responses (401, 403, 404, 409) documented where applicable
- [ ] Salary `GET` shows month/year query params
- [ ] Payments webhook shows `x-paystack-signature` header
- [ ] "Try it out" works for auth/register with example data

**Step 4: Run existing tests to ensure nothing is broken**

Run: `yarn test`
Expected: All 39 tests pass

**Step 5: Commit (if any fixes needed)**

---

### Task 10: Install Sentry dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install Sentry packages**

Run: `yarn add @sentry/nestjs @sentry/profiling-node`

**Step 2: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore: add sentry dependencies"
```

---

### Task 11: Create Sentry instrument.ts and wire into main.ts

**Files:**
- Create: `src/instrument.ts`
- Modify: `src/main.ts`

**Step 1: Create `src/instrument.ts`**

```typescript
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || 'development',
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  profileSessionSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});
```

**Step 2: Import instrument.ts at top of main.ts**

Add `import './instrument';` as the **very first line** of `src/main.ts`, before all other imports. The file should now start with:

```typescript
// Import this first!
import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  // ... existing code unchanged
}
bootstrap();
```

**Step 3: Commit**

```bash
git add src/instrument.ts src/main.ts
git commit -m "feat: add Sentry instrumentation file and import in main.ts"
```

---

### Task 12: Wire SentryModule and SentryGlobalFilter into app.module.ts

**Files:**
- Modify: `src/app.module.ts`

**Step 1: Update app.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SubscriptionPlansModule } from './subscription-plans/subscription-plans.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PaymentsModule } from './payments/payments.module';
import { AttendanceModule } from './attendance/attendance.module';
import { QrModule } from './qr/qr.module';
import { TrainersModule } from './trainers/trainers.module';
import { LegalModule } from './legal/legal.module';
import { SalaryModule } from './salary/salary.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    SubscriptionPlansModule,
    SubscriptionsModule,
    PaymentsModule,
    AttendanceModule,
    QrModule,
    TrainersModule,
    LegalModule,
    SalaryModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    AppService,
  ],
})
export class AppModule {}
```

Key points:
- `SentryModule.forRoot()` must be the **first** import in the imports array
- `SentryGlobalFilter` must be the **first** provider (before any other exception filters)

**Step 2: Commit**

```bash
git add src/app.module.ts
git commit -m "feat: wire SentryModule and SentryGlobalFilter into app module"
```

---

### Task 13: Add Sentry user context middleware

**Files:**
- Create: `src/sentry/sentry-user.interceptor.ts`
- Create: `src/sentry/sentry.module.ts`
- Modify: `src/app.module.ts`

**Step 1: Create the interceptor**

Create `src/sentry/sentry-user.interceptor.ts`:

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import * as Sentry from '@sentry/nestjs';

@Injectable()
export class SentryUserInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (user) {
      Sentry.setUser({
        id: user.sub,
        email: user.email,
        role: user.role,
      });
    }
    return next.handle();
  }
}
```

**Step 2: Create the module**

Create `src/sentry/sentry.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SentryUserInterceptor } from './sentry-user.interceptor';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: SentryUserInterceptor,
    },
  ],
})
export class SentryUserModule {}
```

**Step 3: Add SentryUserModule to app.module.ts imports**

Add `SentryUserModule` to the imports array in `src/app.module.ts` (after `SentryModule.forRoot()`).

```typescript
import { SentryUserModule } from './sentry/sentry.module';

// In @Module imports:
imports: [
  SentryModule.forRoot(),
  SentryUserModule,
  PrismaModule,
  // ... rest unchanged
],
```

**Step 4: Commit**

```bash
git add src/sentry/ src/app.module.ts
git commit -m "feat: add Sentry user context interceptor"
```

---

### Task 14: Verify Sentry integration and run tests

**Step 1: Run all tests**

Run: `yarn test`
Expected: All tests pass (Sentry init is a no-op when `SENTRY_DSN` is not set)

**Step 2: Start dev server**

Run: `yarn start:dev`
Expected: No errors on startup. Sentry logs a warning about missing DSN (expected in dev without DSN).

**Step 3: Verify Swagger still works**

Open: `http://localhost:3000/api/docs`
Expected: All docs still render correctly

**Step 4: Commit (if any fixes needed)**

---

### Task 15: Update CLAUDE.md with new setup info

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add Swagger and Sentry sections to CLAUDE.md**

Add under Environment Variables:
- `SENTRY_DSN` — Sentry project DSN (optional in dev, required in prod)
- `SENTRY_ENVIRONMENT` — defaults to `development`

Add a new section:

```markdown
## API Documentation

Swagger UI at `/api/docs`. Uses `@nestjs/swagger` CLI plugin (configured in `nest-cli.json`) for automatic DTO introspection. Controllers use `@ApiTags`, `@ApiBearerAuth`, and `@ApiResponse` decorators for grouping, auth, and error docs.

## Error Tracking

Sentry via `@sentry/nestjs`. `src/instrument.ts` must be imported first in `main.ts`. `SentryModule.forRoot()` in `app.module.ts`. `SentryGlobalFilter` catches all unhandled exceptions. `SentryUserInterceptor` tags errors with JWT user context. No-op when `SENTRY_DSN` is unset.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Swagger and Sentry info"
```
