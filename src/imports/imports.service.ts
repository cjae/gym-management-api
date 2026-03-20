import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { parse } from 'csv-parse/sync';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import * as path from 'path';
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
const MAX_FILENAME_LENGTH = 255;
const STALE_JOB_MINUTES = 30;
const VALID_GENDERS = Object.values(Gender);
const VALID_PAYMENT_METHODS: string[] = [
  PaymentMethod.MPESA_OFFLINE,
  PaymentMethod.BANK_TRANSFER,
  PaymentMethod.COMPLIMENTARY,
];
const CSV_INJECTION_CHARS = /^[=+\-@]+/;
const SANITIZE_EXEMPT_FIELDS = new Set(['email', 'phone', 'payment_reference']);

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

  private sanitizeFileName(name: string): string {
    // Strip path components and truncate
    const basename = path.basename(name);
    return basename.slice(0, MAX_FILENAME_LENGTH);
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
    const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
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

    // Sanitize string values (exempt email, phone, payment_reference)
    return records.map((row) => {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(row)) {
        sanitized[key] =
          typeof value === 'string' && !SANITIZE_EXEMPT_FIELDS.has(key)
            ? this.sanitize(value)
            : typeof value === 'string'
              ? value.trim()
              : value;
      }
      return sanitized as CsvRow;
    });
  }

  async importMembers(
    file: Express.Multer.File,
    adminId: string,
    adminEmail: string,
  ) {
    const rows = await this.validateAndParseCsv(file.buffer);
    const safeFileName = this.sanitizeFileName(file.originalname);

    // Atomically check for active job and create new one using a transaction
    const job = await this.prisma.$transaction(async (tx) => {
      const activeJob = await tx.importJob.findFirst({
        where: { initiatedById: adminId, status: 'PROCESSING' },
      });
      if (activeJob) {
        throw new BadRequestException(
          'You already have an import in progress. Please wait for it to complete.',
        );
      }

      return tx.importJob.create({
        data: {
          type: 'MEMBERS',
          status: 'PROCESSING',
          fileName: safeFileName,
          totalRows: rows.length,
          initiatedById: adminId,
        },
      });
    });

    // Kick off background processing
    setImmediate(() => {
      this.processImport(job.id, rows, adminEmail).catch((error) => {
        this.logger.error(
          `Import job ${job.id} crashed: ${error.message}`,
          error.stack,
        );
        this.prisma.importJob
          .update({
            where: { id: job.id },
            data: { status: 'FAILED', completedAt: new Date() },
          })
          .catch(() => {});
        this.emailService
          .sendImportReportEmail(adminEmail, {
            fileName: safeFileName,
            totalRows: rows.length,
            importedCount: 0,
            skippedCount: 0,
            errorCount: rows.length,
            errors: [
              {
                row: 0,
                field: 'system',
                message: 'Import failed due to an internal error',
              },
            ],
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

    // Pre-fetch subscription plans if any rows reference them (case-insensitive)
    const planNames = [
      ...new Set(
        rows.filter((r) => r.plan_name).map((r) => r.plan_name!.toLowerCase()),
      ),
    ];
    const plans =
      planNames.length > 0
        ? await this.prisma.subscriptionPlan.findMany({
            where: {
              name: { in: planNames, mode: 'insensitive' },
            },
          })
        : [];
    const planMap = new Map(plans.map((p) => [p.name.toLowerCase(), p]));

    // Pre-fetch existing payment references for uniqueness check
    const csvRefs = rows
      .map((r) => r.payment_reference)
      .filter((ref): ref is string => !!ref);
    const existingRefSet = new Set<string>();
    if (csvRefs.length > 0) {
      const existingPayments = await this.prisma.payment.findMany({
        where: { paystackReference: { in: csvRefs } },
        select: { paystackReference: true },
      });
      for (const p of existingPayments) {
        if (p.paystackReference) existingRefSet.add(p.paystackReference);
      }
    }

    // Track emails and payment references seen in this CSV to handle intra-CSV duplicates
    const seenEmails = new Set<string>();
    const seenRefs = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // 1-indexed + header row

      try {
        const email = row.email?.toLowerCase();

        // Validate email format
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          errors.push({
            row: rowNum,
            field: 'email',
            message: 'Invalid email format',
          });
          continue;
        }

        // Intra-CSV duplicate
        if (seenEmails.has(email)) {
          skipped.push({
            row: rowNum,
            email,
            reason: 'Duplicate email in CSV',
          });
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
          errors.push({
            row: rowNum,
            field: 'first_name',
            message: 'First name is required',
          });
          continue;
        }
        if (!row.last_name) {
          errors.push({
            row: rowNum,
            field: 'last_name',
            message: 'Last name is required',
          });
          continue;
        }

        // Validate gender if provided
        const gender = row.gender || undefined;
        if (gender && !VALID_GENDERS.includes(gender as Gender)) {
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
          plan = planMap.get(row.plan_name.toLowerCase());
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
          const endDate = new Date(
            row.subscription_end_date + 'T23:59:59+03:00',
          );
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

        // Validate payment_reference uniqueness
        if (row.payment_reference) {
          if (seenRefs.has(row.payment_reference)) {
            errors.push({
              row: rowNum,
              field: 'payment_reference',
              message: 'Duplicate payment reference in CSV',
            });
            continue;
          }
          if (existingRefSet.has(row.payment_reference)) {
            errors.push({
              row: rowNum,
              field: 'payment_reference',
              message: 'Payment reference already exists',
            });
            continue;
          }
          seenRefs.add(row.payment_reference);
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
              gender: (gender as Gender) || undefined,
              role: 'MEMBER',
              mustChangePassword: true,
              referralCode: generateReferralCode(),
            },
          });

          if (plan) {
            const startDate = new Date();
            const endDate = new Date(
              row.subscription_end_date! + 'T23:59:59+03:00',
            );
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
        this.logger.error(
          `Import row ${rowNum} failed: ${error.message}`,
          error.stack,
        );
        // Handle uniqueness collision with specific field identification
        if (error?.code === 'P2002') {
          const target = error?.meta?.target;
          if (Array.isArray(target) && target.includes('paystackReference')) {
            errors.push({
              row: rowNum,
              field: 'payment_reference',
              message: 'Payment reference already exists',
            });
          } else if (Array.isArray(target) && target.includes('referralCode')) {
            errors.push({
              row: rowNum,
              field: 'system',
              message:
                'Referral code collision — retry the import for this row',
            });
          } else {
            errors.push({
              row: rowNum,
              field: 'system',
              message: 'Uniqueness conflict — a duplicate record exists',
            });
          }
        } else {
          errors.push({
            row: rowNum,
            field: 'system',
            message: 'Failed to import row due to an internal error',
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

  @Cron(CronExpression.EVERY_10_MINUTES, { timeZone: 'Africa/Nairobi' })
  async cleanupStaleImportJobs() {
    const staleThreshold = new Date(Date.now() - STALE_JOB_MINUTES * 60 * 1000);

    const staleJobs = await this.prisma.importJob.updateMany({
      where: {
        status: 'PROCESSING',
        createdAt: { lt: staleThreshold },
      },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
      },
    });

    if (staleJobs.count > 0) {
      this.logger.warn(
        `Cleaned up ${staleJobs.count} stale PROCESSING import job(s)`,
      );
    }
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
