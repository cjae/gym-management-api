import { Test, TestingModule } from '@nestjs/testing';
import { SalaryService } from './salary.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SalaryService', () => {
  let service: SalaryService;
  let prisma: PrismaService;

  const mockRecord = {
    id: 'salary-1',
    staffId: 'staff-1',
    month: 3,
    year: 2026,
    amount: 50000,
    currency: 'KES',
    status: 'PENDING',
    paidAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrisma = {
    staffSalaryRecord: {
      create: jest.fn().mockResolvedValue(mockRecord),
      findMany: jest.fn().mockResolvedValue([mockRecord]),
      update: jest.fn().mockResolvedValue({
        ...mockRecord,
        status: 'PAID',
        paidAt: new Date(),
      }),
      delete: jest.fn().mockResolvedValue(mockRecord),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalaryService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SalaryService>(SalaryService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a salary record', async () => {
      const result = await service.create({
        staffId: 'staff-1',
        month: 3,
        year: 2026,
        amount: 50000,
      });
      expect(result).toEqual(mockRecord);
    });
  });

  describe('findAll', () => {
    it('should return all salary records', async () => {
      const result = await service.findAll();
      expect(result).toEqual([mockRecord]);
    });

    it('should filter by month and year', async () => {
      await service.findAll({ month: 3, year: 2026 });
      expect(prisma.staffSalaryRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { month: 3, year: 2026 },
        }),
      );
    });
  });

  describe('findByStaff', () => {
    it('should return records for specific staff', async () => {
      const result = await service.findByStaff('staff-1');
      expect(result).toEqual([mockRecord]);
    });
  });

  describe('markAsPaid', () => {
    it('should mark a record as paid', async () => {
      const result = await service.markAsPaid('salary-1');
      expect(result.status).toBe('PAID');
    });
  });

  describe('remove', () => {
    it('should delete a salary record', async () => {
      const result = await service.remove('salary-1');
      expect(result).toEqual(mockRecord);
    });
  });
});
