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

      await expect(service.validateAndParseCsv(buffer)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject file with more than 500 rows', async () => {
      const header = 'email,first_name,last_name';
      const rows = Array.from(
        { length: 501 },
        (_, i) => `user${i}@example.com,First${i},Last${i}`,
      ).join('\n');
      const buffer = Buffer.from(`${header}\n${rows}`);

      await expect(service.validateAndParseCsv(buffer)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject file with no data rows', async () => {
      const buffer = Buffer.from('email,first_name,last_name\n');

      await expect(service.validateAndParseCsv(buffer)).rejects.toThrow(
        BadRequestException,
      );
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

      await expect(service.validateAndParseCsv(buffer)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should strip all leading CSV injection characters', async () => {
      const buffer = Buffer.from(
        'email,first_name,last_name\njane@example.com,=+Jane,-@Doe',
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

      // Mock dependencies used by background processImport
      prisma.user.findMany.mockResolvedValue([]);
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.user.create.mockResolvedValue({ id: 'user-1' } as any);
      prisma.importJob.update.mockResolvedValue({} as any);
      emailService.sendImportReportEmail.mockResolvedValue(undefined);

      const result = await service.importMembers(
        mockFile,
        adminUser.id,
        adminUser.email,
      );

      expect(result.status).toBe('PROCESSING');
      expect(prisma.importJob.create).toHaveBeenCalled();
    });

    it('should sanitize path traversal in file names', async () => {
      const maliciousFile = {
        buffer: Buffer.from(
          'email,first_name,last_name\njane@example.com,Jane,Doe',
        ),
        originalname: '../../../etc/passwd',
      } as Express.Multer.File;

      prisma.importJob.findFirst.mockResolvedValue(null);
      prisma.importJob.create.mockResolvedValue({
        id: 'job-1',
        type: 'MEMBERS',
        status: 'PROCESSING',
        fileName: 'passwd',
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

      prisma.user.findMany.mockResolvedValue([]);
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.importJob.update.mockResolvedValue({} as any);
      emailService.sendImportReportEmail.mockResolvedValue(undefined);

      await service.importMembers(
        maliciousFile,
        adminUser.id,
        adminUser.email,
      );

      expect(prisma.importJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fileName: 'passwd',
          }),
        }),
      );
    });
  });

  describe('cleanupStaleImportJobs', () => {
    it('should mark stale PROCESSING jobs as FAILED', async () => {
      prisma.importJob.updateMany.mockResolvedValue({ count: 2 });

      await service.cleanupStaleImportJobs();

      expect(prisma.importJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PROCESSING',
            createdAt: expect.objectContaining({ lt: expect.any(Date) }),
          }),
          data: expect.objectContaining({
            status: 'FAILED',
          }),
        }),
      );
    });

    it('should do nothing when no stale jobs exist', async () => {
      prisma.importJob.updateMany.mockResolvedValue({ count: 0 });

      await service.cleanupStaleImportJobs();

      expect(prisma.importJob.updateMany).toHaveBeenCalled();
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
