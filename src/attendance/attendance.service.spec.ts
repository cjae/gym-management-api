import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('AttendanceService', () => {
  let service: AttendanceService;

  const mockPrisma = {
    gymQrCode: { findFirst: jest.fn() },
    subscriptionMember: { findFirst: jest.fn() },
    attendance: { findUnique: jest.fn(), create: jest.fn() },
    streak: { upsert: jest.fn(), findUnique: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<AttendanceService>(AttendanceService);
    jest.clearAllMocks();
  });

  it('should reject invalid QR code', async () => {
    mockPrisma.gymQrCode.findFirst.mockResolvedValue(null);
    await expect(
      service.checkIn('member-1', { qrCode: 'invalid' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject member without active subscription', async () => {
    mockPrisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    });
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue(null);
    await expect(
      service.checkIn('member-1', { qrCode: 'valid' }),
    ).rejects.toThrow(ForbiddenException);
  });
});
