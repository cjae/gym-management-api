/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { QrService } from './qr.service';
import { PrismaService } from '../prisma/prisma.service';

describe('QrService', () => {
  let service: QrService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockEventEmitter = { emit: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QrService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();
    service = module.get<QrService>(QrService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('generateCode', () => {
    it('should deactivate old codes and create a new one', async () => {
      const mockCode = { id: 'qr-1', code: 'abc123', isActive: true };
      prisma.gymQrCode.updateMany.mockResolvedValue({ count: 1 } as any);
      prisma.gymQrCode.create.mockResolvedValue(mockCode as any);

      const result = await service.generateCode();

      expect(prisma.gymQrCode.updateMany).toHaveBeenCalledWith({
        where: { isActive: true },
        data: { isActive: false },
      });
      expect(prisma.gymQrCode.create).toHaveBeenCalledWith({
        data: { code: expect.any(String), isActive: true },
      });
      expect(result).toEqual(mockCode);
    });
  });

  describe('rotateDailyCode', () => {
    it('should generate a new code and emit qr.rotated event', async () => {
      const mockCode = { id: 'qr-2', code: 'def456', isActive: true };
      prisma.gymQrCode.updateMany.mockResolvedValue({ count: 1 } as any);
      prisma.gymQrCode.create.mockResolvedValue(mockCode as any);

      await service.rotateDailyCode();

      expect(prisma.gymQrCode.updateMany).toHaveBeenCalled();
      expect(prisma.gymQrCode.create).toHaveBeenCalled();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('qr.rotated', {
        type: 'qr_rotated',
        timestamp: expect.any(String),
      });
    });
  });
});
