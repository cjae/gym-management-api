# Member Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow ADMIN/SUPER_ADMIN to import existing gym members (and their subscriptions) via CSV upload, processed in the background with an email report on completion.

**Architecture:** New `imports/` module following the standard controller-service-Prisma pattern. CSV parsed with `csv-parse`. File upload via Multer `FileInterceptor`. Background processing via `setImmediate` after returning 201. Email report sent to admin on completion.

**Tech Stack:** NestJS, Prisma, csv-parse, Multer (built-in), bcrypt, Handlebars email templates.

**Design doc:** `docs/plans/2026-03-15-member-import-design.md`

---

### Task 1: Install csv-parse dependency

**Files:**
- Modify: `package.json`

**Step 1: Install csv-parse**

Run: `yarn add csv-parse`

**Step 2: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore: add csv-parse dependency for member import"
```

---

### Task 2: Add ImportJob model to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add enums and model to schema**

Add at the end of `prisma/schema.prisma`:

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
  errors         Json?
  skipped        Json?
  initiatedById  String
  completedAt    DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  initiatedBy User @relation(fields: [initiatedById], references: [id])
}
```

Also add to the `User` model relations:

```prisma
importJobs ImportJob[]
```

**Step 2: Generate migration**

Run: `npx prisma migrate dev --name add-import-job`

**Step 3: Verify Prisma client generated**

Run: `npx prisma generate`

**Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(imports): add ImportJob model and migration"
```

---

### Task 3: Create imports module scaffold

**Files:**
- Create: `src/imports/imports.module.ts`
- Create: `src/imports/imports.controller.ts`
- Create: `src/imports/imports.service.ts`
- Modify: `src/app.module.ts`

**Step 1: Create the module**

`src/imports/imports.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ImportsService } from './imports.service';
import { ImportsController } from './imports.controller';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
```

**Step 2: Create empty service**

`src/imports/imports.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}
}
```

**Step 3: Create empty controller**

`src/imports/imports.controller.ts`:

```typescript
import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ImportsService } from './imports.service';

@ApiTags('Imports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}
}
```

**Step 4: Register in AppModule**

Add `ImportsModule` to the imports array in `src/app.module.ts`:

```typescript
import { ImportsModule } from './imports/imports.module';
// Add ImportsModule to the imports array
```

**Step 5: Verify it compiles**

Run: `yarn build`

**Step 6: Commit**

```bash
git add src/imports/ src/app.module.ts
git commit -m "feat(imports): scaffold imports module with controller and service"
```

---

### Task 4: Create DTOs for import

**Files:**
- Create: `src/imports/dto/import-members.dto.ts`

**Step 1: Create the response DTO**

`src/imports/dto/import-members.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class ImportJobResponseDto {
  @ApiProperty({ example: 'uuid-here' })
  id: string;

  @ApiProperty({ example: 'MEMBERS' })
  type: string;

  @ApiProperty({ example: 'PROCESSING' })
  status: string;

  @ApiProperty({ example: 'members.csv' })
  fileName: string;

  @ApiProperty({ example: 150 })
  totalRows: number;

  @ApiProperty({ example: '2026-03-15T10:00:00.000Z' })
  createdAt: Date;
}

export class ImportJobDetailResponseDto extends ImportJobResponseDto {
  @ApiProperty({ example: 140 })
  importedCount: number;

  @ApiProperty({ example: 5 })
  skippedCount: number;

  @ApiProperty({ example: 5 })
  errorCount: number;

  @ApiProperty({
    example: [{ row: 3, email: 'jane@example.com', reason: 'Email already exists' }],
    nullable: true,
  })
  skipped: any;

  @ApiProperty({
    example: [{ row: 7, field: 'email', message: 'Invalid email format' }],
    nullable: true,
  })
  errors: any;

  @ApiProperty({ example: '2026-03-15T10:05:00.000Z', nullable: true })
  completedAt: Date | null;
}
```

**Step 2: Commit**

```bash
git add src/imports/dto/
git commit -m "feat(imports): add import job response DTOs"
```

---

### Task 5: Implement CSV parsing and validation in the service

**Files:**
- Modify: `src/imports/imports.service.ts`

**Step 1: Write the failing test**

Create `src/imports/imports.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ImportsService } from './imports.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('ImportsService', () => {
  let service: ImportsService;
  let prisma: DeepMockProxy<PrismaClient>;
  let emailService: DeepMockProxy<EmailService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EmailService, useValue: mockDeep<EmailService>() },
      ],
    }).compile();

    service = module.get<ImportsService>(ImportsService);
    prisma = module.get(PrismaService);
    emailService = module.get(EmailService);

    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateAndParseCsv', () => {
    it('should reject file without required headers', async () => {
      const buffer = Buffer.from('name,phone\nJane,+254712345678');

      await expect(
        service.validateAndParseCsv(buffer),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject file with more than 500 rows', async () => {
      const header = 'email,first_name,last_name';
      const rows = Array.from({ length: 501 }, (_, i) =>
        `user${i}@example.com,First${i},Last${i}`,
      ).join('\n');
      const buffer = Buffer.from(`${header}\n${rows}`);

      await expect(
        service.validateAndParseCsv(buffer),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject file with no data rows', async () => {
      const buffer = Buffer.from('email,first_name,last_name\n');

      await expect(
        service.validateAndParseCsv(buffer),
      ).rejects.toThrow(BadRequestException);
    });

    it('should parse valid CSV with required columns only', async () => {
      const buffer = Buffer.from(
        'email,first_name,last_name\njane@example.com,Jane,Doe',
      );

      const result = await service.validateAndParseCsv(buffer);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          email: 'jane@example.com',
          first_name: 'Jane',
          last_name: 'Doe',
        }),
      );
    });

    it('should require subscription_end_date when plan_name is present', async () => {
      const buffer = Buffer.from(
        'email,first_name,last_name,plan_name\njane@example.com,Jane,Doe,Monthly',
      );

      await expect(
        service.validateAndParseCsv(buffer),
      ).rejects.toThrow(BadRequestException);
    });

    it('should strip CSV injection characters', async () => {
      const buffer = Buffer.from(
        'email,first_name,last_name\njane@example.com,=Jane,+Doe',
      );

      const result = await service.validateAndParseCsv(buffer);

      expect(result[0].first_name).toBe('Jane');
      expect(result[0].last_name).toBe('Doe');
    });
  });

  describe('importMembers', () => {
    const mockFile = {
      buffer: Buffer.from(
        'email,first_name,last_name\njane@example.com,Jane,Doe',
      ),
      originalname: 'members.csv',
    } as Express.Multer.File;

    const adminUser = { id: 'admin-1', email: 'admin@gym.com' };

    it('should reject if admin has an active PROCESSING job', async () => {
      prisma.importJob.findFirst.mockResolvedValue({
        id: 'job-1',
        status: 'PROCESSING',
      } as any);

      await expect(
        service.importMembers(mockFile, adminUser.id, adminUser.email),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create an import job and return it', async () => {
      prisma.importJob.findFirst.mockResolvedValue(null);
      prisma.importJob.create.mockResolvedValue({
        id: 'job-1',
        type: 'MEMBERS',
        status: 'PROCESSING',
        fileName: 'members.csv',
        totalRows: 1,
        importedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        initiatedById: adminUser.id,
        errors: null,
        skipped: null,
        completedAt: null,
      });

      const result = await service.importMembers(
        mockFile,
        adminUser.id,
        adminUser.email,
      );

      expect(result.status).toBe('PROCESSING');
      expect(prisma.importJob.create).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated import jobs', async () => {
      prisma.importJob.findMany.mockResolvedValue([]);
      prisma.importJob.count.mockResolvedValue(0);

      const result = await service.findAll(1, 20);

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException for non-existent job', async () => {
      prisma.importJob.findUnique.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow();
    });

    it('should return the import job', async () => {
      const mockJob = {
        id: 'job-1',
        type: 'MEMBERS',
        status: 'COMPLETED',
        fileName: 'members.csv',
        totalRows: 10,
        importedCount: 8,
        skippedCount: 2,
        errorCount: 0,
        errors: null,
        skipped: [],
        initiatedById: 'admin-1',
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.importJob.findUnique.mockResolvedValue(mockJob);

      const result = await service.findOne('job-1');

      expect(result).toEqual(mockJob);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=imports`
Expected: FAIL — service methods don't exist yet

**Step 3: Implement the service**

`src/imports/imports.service.ts`:

```typescript
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { parse } from 'csv-parse/sync';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { generateReferralCode } from '../common/utils/referral-code.util';
import { Gender, PaymentMethod, SubscriptionStatus } from '@prisma/client';

interface CsvRow {
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  gender?: string;
  plan_name?: string;
  subscription_end_date?: string;
  payment_method?: string;
  payment_reference?: string;
  payment_note?: string;
}

const REQUIRED_HEADERS = ['email', 'first_name', 'last_name'];
const SUBSCRIPTION_HEADERS = ['plan_name', 'subscription_end_date'];
const MAX_ROWS = 500;
const VALID_GENDERS = Object.values(Gender);
const VALID_PAYMENT_METHODS: string[] = [
  PaymentMethod.MPESA_OFFLINE,
  PaymentMethod.BANK_TRANSFER,
  PaymentMethod.COMPLIMENTARY,
];
const CSV_INJECTION_CHARS = /^[=+\-@]/;

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  private sanitize(value: string): string {
    return value.replace(CSV_INJECTION_CHARS, '').trim();
  }

  async validateAndParseCsv(buffer: Buffer): Promise<CsvRow[]> {
    let records: CsvRow[];
    try {
      records = parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch {
      throw new BadRequestException('Invalid CSV format');
    }

    if (records.length === 0) {
      throw new BadRequestException('CSV file contains no data rows');
    }

    if (records.length > MAX_ROWS) {
      throw new BadRequestException(
        `CSV exceeds maximum of ${MAX_ROWS} rows (found ${records.length})`,
      );
    }

    // Check required headers
    const headers = Object.keys(records[0]);
    const missingHeaders = REQUIRED_HEADERS.filter(
      (h) => !headers.includes(h),
    );
    if (missingHeaders.length > 0) {
      throw new BadRequestException(
        `Missing required columns: ${missingHeaders.join(', ')}`,
      );
    }

    // If any subscription column is present, all required subscription columns must be present
    const hasAnySubscriptionCol = SUBSCRIPTION_HEADERS.some((h) =>
      headers.includes(h),
    );
    if (hasAnySubscriptionCol) {
      const missingSubHeaders = SUBSCRIPTION_HEADERS.filter(
        (h) => !headers.includes(h),
      );
      if (missingSubHeaders.length > 0) {
        throw new BadRequestException(
          `When importing subscriptions, these columns are required: ${missingSubHeaders.join(', ')}`,
        );
      }
    }

    // Sanitize all string values
    return records.map((row) => {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(row)) {
        sanitized[key] =
          typeof value === 'string' ? this.sanitize(value) : value;
      }
      return sanitized as CsvRow;
    });
  }

  async importMembers(
    file: Express.Multer.File,
    adminId: string,
    adminEmail: string,
  ) {
    // Check for active import by this admin
    const activeJob = await this.prisma.importJob.findFirst({
      where: { initiatedById: adminId, status: 'PROCESSING' },
    });
    if (activeJob) {
      throw new BadRequestException(
        'You already have an import in progress. Please wait for it to complete.',
      );
    }

    const rows = await this.validateAndParseCsv(file.buffer);

    const job = await this.prisma.importJob.create({
      data: {
        type: 'MEMBERS',
        fileName: file.originalname,
        totalRows: rows.length,
        initiatedById: adminId,
      },
    });

    // Kick off background processing
    setImmediate(() => {
      this.processImport(job.id, rows, adminEmail).catch((error) => {
        this.logger.error(`Import job ${job.id} crashed: ${error.message}`);
        this.prisma.importJob
          .update({
            where: { id: job.id },
            data: { status: 'FAILED', completedAt: new Date() },
          })
          .catch(() => {});
        this.emailService
          .sendImportReportEmail(adminEmail, {
            fileName: file.originalname,
            totalRows: rows.length,
            importedCount: 0,
            skippedCount: 0,
            errorCount: rows.length,
            errors: [{ row: 0, field: 'system', message: error.message }],
            skipped: [],
            failed: true,
          })
          .catch(() => {});
      });
    });

    return job;
  }

  private async processImport(
    jobId: string,
    rows: CsvRow[],
    adminEmail: string,
  ) {
    const errors: { row: number; field: string; message: string }[] = [];
    const skipped: { row: number; email: string; reason: string }[] = [];
    let importedCount = 0;

    // Pre-fetch all existing emails for duplicate detection
    const emails = rows.map((r) => r.email.toLowerCase());
    const existingUsers = await this.prisma.user.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    });
    const existingEmailSet = new Set(
      existingUsers.map((u) => u.email.toLowerCase()),
    );

    // Pre-fetch subscription plans if any rows reference them
    const planNames = [
      ...new Set(rows.filter((r) => r.plan_name).map((r) => r.plan_name!)),
    ];
    const plans =
      planNames.length > 0
        ? await this.prisma.subscriptionPlan.findMany({
            where: { name: { in: planNames } },
          })
        : [];
    const planMap = new Map(plans.map((p) => [p.name, p]));

    // Track emails seen in this CSV to handle intra-CSV duplicates
    const seenEmails = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // 1-indexed + header row

      try {
        const email = row.email?.toLowerCase();

        // Validate email format
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          errors.push({ row: rowNum, field: 'email', message: 'Invalid email format' });
          continue;
        }

        // Intra-CSV duplicate
        if (seenEmails.has(email)) {
          skipped.push({ row: rowNum, email, reason: 'Duplicate email in CSV' });
          continue;
        }
        seenEmails.add(email);

        // DB duplicate
        if (existingEmailSet.has(email)) {
          skipped.push({ row: rowNum, email, reason: 'Email already exists' });
          continue;
        }

        // Validate required fields
        if (!row.first_name) {
          errors.push({ row: rowNum, field: 'first_name', message: 'First name is required' });
          continue;
        }
        if (!row.last_name) {
          errors.push({ row: rowNum, field: 'last_name', message: 'Last name is required' });
          continue;
        }

        // Validate gender if provided
        if (row.gender && !VALID_GENDERS.includes(row.gender as Gender)) {
          errors.push({
            row: rowNum,
            field: 'gender',
            message: `Invalid gender. Must be one of: ${VALID_GENDERS.join(', ')}`,
          });
          continue;
        }

        // Validate subscription fields
        let plan: (typeof plans)[0] | undefined;
        if (row.plan_name) {
          plan = planMap.get(row.plan_name);
          if (!plan) {
            errors.push({
              row: rowNum,
              field: 'plan_name',
              message: `Plan "${row.plan_name}" not found`,
            });
            continue;
          }
          if (!plan.isActive) {
            errors.push({
              row: rowNum,
              field: 'plan_name',
              message: `Plan "${row.plan_name}" is inactive`,
            });
            continue;
          }
          if (!row.subscription_end_date) {
            errors.push({
              row: rowNum,
              field: 'subscription_end_date',
              message: 'End date required when plan_name is specified',
            });
            continue;
          }
          const endDate = new Date(row.subscription_end_date);
          if (isNaN(endDate.getTime())) {
            errors.push({
              row: rowNum,
              field: 'subscription_end_date',
              message: 'Invalid date format (use YYYY-MM-DD)',
            });
            continue;
          }
          if (endDate <= new Date()) {
            errors.push({
              row: rowNum,
              field: 'subscription_end_date',
              message: 'Subscription end date must be in the future',
            });
            continue;
          }
        }

        // Validate payment method if provided
        if (
          row.payment_method &&
          !VALID_PAYMENT_METHODS.includes(row.payment_method)
        ) {
          errors.push({
            row: rowNum,
            field: 'payment_method',
            message: `Invalid payment method. Must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`,
          });
          continue;
        }

        // Generate temp password
        const tempPassword = randomBytes(9).toString('base64url').slice(0, 12);
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        // Create user + subscription + payment in a transaction
        await this.prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email,
              password: hashedPassword,
              firstName: row.first_name,
              lastName: row.last_name,
              phone: row.phone || undefined,
              gender: (row.gender as Gender) || undefined,
              role: 'MEMBER',
              mustChangePassword: true,
              referralCode: generateReferralCode(),
            },
          });

          if (plan) {
            const startDate = new Date();
            const endDate = new Date(row.subscription_end_date!);
            const paymentMethod =
              (row.payment_method as PaymentMethod) ||
              PaymentMethod.COMPLIMENTARY;
            const amount =
              paymentMethod === PaymentMethod.COMPLIMENTARY ? 0 : plan.price;

            const subscription = await tx.memberSubscription.create({
              data: {
                primaryMemberId: user.id,
                planId: plan.id,
                startDate,
                endDate,
                status: SubscriptionStatus.ACTIVE,
                paymentMethod,
                autoRenew: false,
                nextBillingDate: endDate,
                paymentNote: row.payment_note || undefined,
                members: {
                  create: { memberId: user.id },
                },
              },
            });

            await tx.payment.create({
              data: {
                subscriptionId: subscription.id,
                amount,
                paymentMethod,
                status: 'PAID',
                paystackReference: row.payment_reference || undefined,
                paymentNote: row.payment_note || undefined,
              },
            });
          }
        });

        importedCount++;
      } catch (error: any) {
        // Handle referralCode uniqueness collision
        if (error?.code === 'P2002') {
          errors.push({
            row: rowNum,
            field: 'system',
            message: 'Uniqueness conflict — retry the import for this row',
          });
        } else {
          errors.push({
            row: rowNum,
            field: 'system',
            message: error.message || 'Unknown error',
          });
        }
      }
    }

    // Update job with results
    const job = await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        importedCount,
        skippedCount: skipped.length,
        errorCount: errors.length,
        errors: errors.length > 0 ? errors : undefined,
        skipped: skipped.length > 0 ? skipped : undefined,
        completedAt: new Date(),
      },
    });

    // Email the admin the report
    this.emailService
      .sendImportReportEmail(adminEmail, {
        fileName: job.fileName,
        totalRows: job.totalRows,
        importedCount,
        skippedCount: skipped.length,
        errorCount: errors.length,
        errors,
        skipped,
        failed: false,
      })
      .catch(() => {});

    this.logger.log(
      `Import job ${jobId} completed: ${importedCount} imported, ${skipped.length} skipped, ${errors.length} errors`,
    );
  }

  async findAll(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.importJob.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.importJob.count(),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Import job with id ${id} not found`);
    }
    return job;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=imports`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/imports/imports.service.ts src/imports/imports.service.spec.ts
git commit -m "feat(imports): implement CSV parsing, validation, and background import processing"
```

---

### Task 6: Add sendImportReportEmail to EmailService

**Files:**
- Modify: `src/email/email.service.ts`
- Create: `src/email/templates/import-report.hbs`

**Step 1: Add the method to EmailService**

Add to `src/email/email.service.ts` after the last `send*Email` method:

```typescript
async sendImportReportEmail(
  to: string,
  report: {
    fileName: string;
    totalRows: number;
    importedCount: number;
    skippedCount: number;
    errorCount: number;
    errors: { row: number; field: string; message: string }[];
    skipped: { row: number; email: string; reason: string }[];
    failed: boolean;
  },
): Promise<void> {
  const subject = report.failed
    ? `Import Failed: ${report.fileName}`
    : `Import Complete: ${report.importedCount} members imported`;

  await this.sendEmail(to, subject, 'import-report', {
    ...report,
    hasErrors: report.errors.length > 0,
    hasSkipped: report.skipped.length > 0,
    adminUrl: this.adminUrl,
  });
}
```

**Step 2: Create the email template**

`src/email/templates/import-report.hbs`:

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f0f0f0;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    {{> header}}

    <div style="padding: 32px 24px;">
      {{#if failed}}
      <h2 style="color: #d32f2f; margin: 0 0 16px 0;">Import Failed</h2>
      <p style="color: #555555; line-height: 1.6; margin: 0 0 24px 0;">
        The import of <strong>{{fileName}}</strong> failed during processing.
      </p>
      {{else}}
      <h2 style="color: #333333; margin: 0 0 16px 0;">Import Complete</h2>
      <p style="color: #555555; line-height: 1.6; margin: 0 0 24px 0;">
        The import of <strong>{{fileName}}</strong> has finished processing.
      </p>
      {{/if}}

      <div style="background-color: #f5f5f5; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="color: #555555; margin: 0 0 8px 0;"><strong>Total Rows:</strong> {{totalRows}}</p>
        <p style="color: #2e7d32; margin: 0 0 8px 0;"><strong>Imported:</strong> {{importedCount}}</p>
        <p style="color: #f57c00; margin: 0 0 8px 0;"><strong>Skipped:</strong> {{skippedCount}}</p>
        <p style="color: #d32f2f; margin: 0;"><strong>Errors:</strong> {{errorCount}}</p>
      </div>

      {{#if hasSkipped}}
      <h3 style="color: #f57c00; margin: 0 0 12px 0;">Skipped Rows</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 0 0 24px 0; font-size: 14px;">
        <tr style="background-color: #f5f5f5;">
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">Row</th>
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">Email</th>
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">Reason</th>
        </tr>
        {{#each skipped}}
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">{{this.row}}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">{{this.email}}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">{{this.reason}}</td>
        </tr>
        {{/each}}
      </table>
      {{/if}}

      {{#if hasErrors}}
      <h3 style="color: #d32f2f; margin: 0 0 12px 0;">Errors</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 0 0 24px 0; font-size: 14px;">
        <tr style="background-color: #f5f5f5;">
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">Row</th>
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">Field</th>
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">Message</th>
        </tr>
        {{#each errors}}
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">{{this.row}}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">{{this.field}}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">{{this.message}}</td>
        </tr>
        {{/each}}
      </table>
      {{/if}}

      {{> button url=adminUrl text="Go to Dashboard"}}
    </div>

    {{> footer}}
  </div>
</body>
</html>
```

**Step 3: Commit**

```bash
git add src/email/email.service.ts src/email/templates/import-report.hbs
git commit -m "feat(imports): add import report email template and service method"
```

---

### Task 7: Implement controller endpoints

**Files:**
- Modify: `src/imports/imports.controller.ts`

**Step 1: Write the controller spec**

Create `src/imports/imports.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';

describe('ImportsController', () => {
  let controller: ImportsController;
  let service: DeepMockProxy<ImportsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImportsController],
      providers: [
        { provide: ImportsService, useValue: mockDeep<ImportsService>() },
      ],
    }).compile();

    controller = module.get<ImportsController>(ImportsController);
    service = module.get(ImportsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('importMembers', () => {
    it('should call service.importMembers with file and admin id', async () => {
      const mockFile = {
        buffer: Buffer.from('test'),
        originalname: 'test.csv',
      } as Express.Multer.File;

      service.importMembers.mockResolvedValue({
        id: 'job-1',
        type: 'MEMBERS',
        status: 'PROCESSING',
        fileName: 'test.csv',
        totalRows: 1,
      } as any);

      const result = await controller.importMembers(
        mockFile,
        'admin-1',
        'admin@gym.com',
      );

      expect(service.importMembers).toHaveBeenCalledWith(
        mockFile,
        'admin-1',
        'admin@gym.com',
      );
      expect(result.status).toBe('PROCESSING');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=imports.controller`
Expected: FAIL — controller method doesn't exist

**Step 3: Implement the controller**

`src/imports/imports.controller.ts`:

```typescript
import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ImportsService } from './imports.service';
import {
  ImportJobResponseDto,
  ImportJobDetailResponseDto,
} from './dto/import-members.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Imports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ description: 'Insufficient role' })
@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('members')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({
    description: 'Import job created and processing in background',
    type: ImportJobResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid CSV format, missing headers, or active import exists',
  })
  async importMembers(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^text\/csv|application\/vnd\.ms-excel$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
  ) {
    return this.importsService.importMembers(file, adminId, adminEmail);
  }

  @Get()
  @ApiOkResponse({ description: 'Paginated list of import jobs', type: [ImportJobResponseDto] })
  findAll(@Query() query: PaginationQueryDto) {
    return this.importsService.findAll(query.page, query.limit);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Import job details with error/skip report', type: ImportJobDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Import job not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.importsService.findOne(id);
  }
}
```

**Step 4: Run all tests**

Run: `yarn test -- --testPathPattern=imports`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/imports/
git commit -m "feat(imports): add controller with upload, list, and detail endpoints"
```

---

### Task 8: Full build and lint check

**Step 1: Run lint**

Run: `yarn lint`
Expected: No errors

**Step 2: Run full build**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Run all tests**

Run: `yarn test`
Expected: All tests pass (existing + new)

**Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(imports): lint and build fixes"
```
